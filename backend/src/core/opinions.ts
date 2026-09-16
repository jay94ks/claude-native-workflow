import { getDb } from "./db.js";
import { getDocument, transitionDocumentStatus } from "./documents.js";
import { getDocTypeById } from "./docTypes.js";
import { getPlanProjectId, getPlanByTrackingCode } from "./plans.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { sendOrAppendMessage } from "./messages.js";

// 코멘트(Comment, core/comments.ts)와 정반대 방향 채널 - 코멘트는
// "설계자들끼리만 공유되는 채널이라 CLI/MCP에 없다"는 게 원칙인데,
// 의견(Opinion)은 AI가 참고해야 하는 채널이라 그 반대다: 생성은 웹
// UI(설계자)에서만 하고(CLI/MCP에 생성 도구를 의도적으로 안 둠),
// 조회/확인 완료 처리는 CLI/MCP로 AI가 직접 한다. targetType은
// "document" | "plan" 두 가지만 다룬다(요청 범위 - questions.ts의
// document/kanbanCard/plan 검증과 같은 모양으로 만들어 필요해지면
// source/kanbanCard로 그대로 확장 가능).

export type OpinionTargetType = "document" | "plan";

export interface OpinionDetail {
  id: string;
  projectId: string;
  targetType: string;
  targetKey: string;
  body: string;
  authorId: string;
  status: string; // open | resolved(되돌리기 없음 - 필요하면 새 의견으로)
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** questions.ts의 assertTargetExists와 같은 모양(document/plan만
 * 다룬다는 점만 다름) - 대상이 실제로 존재하고 이 프로젝트 소속인지
 * 확인한다. */
async function assertTargetExists(projectId: string, targetType: string, targetKey: string): Promise<void> {
  if (targetType === "document") {
    const doc = await getDocument(targetKey);
    if (!doc || doc.projectId !== projectId) throw new Error(`대상 문서를 찾을 수 없습니다: ${targetKey}`);
  } else if (targetType === "plan") {
    const planProjectId = await getPlanProjectId(targetKey);
    if (!planProjectId || planProjectId !== projectId) throw new Error(`대상 계획을 찾을 수 없습니다: ${targetKey}`);
  } else {
    throw new Error(`알 수 없는 대상 종류입니다: ${targetType}`);
  }
}

export async function addOpinion(
  projectId: string,
  targetType: string,
  targetKey: string,
  body: string,
  authorId: string,
): Promise<OpinionDetail> {
  if (!body.trim()) throw new Error("body가 필요합니다");
  await assertTargetExists(projectId, targetType, targetKey);
  const db = getDb();
  const row = await db.opinion.create({ data: { projectId, targetType, targetKey, body, authorId } });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "opinion",
    action: "create",
    id: row.id,
    targetType,
    targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  if (targetType === "document") {
    await maybeNotifyDcOpinion(projectId, targetKey, body);
  }

  return row;
}

/** DC(결정 요구사항 및 요청) 문서에 새 의견이 달리면 (1) 상태를
 * review로 되돌리고(이미 review면 그대로 - "새 의견 = 다시 봐야
 * 함", 설계자 확인) (2) 확인 메시지를 보낸다 - 같은 문서를 가리키는
 * 아직 처리 안 된(대기 중) 알림이 있으면 새로 만들지 않고 이어붙인다
 * (sendOrAppendMessage, #dc-opinion-notice). DC가 아닌 문서거나
 * review 전이가 안 되는 상태여도(docType에 review가 없는 등) 의견
 * 저장 자체는 이미 끝났으니 조용히 넘어간다. */
async function maybeNotifyDcOpinion(projectId: string, documentTrackingCode: string, opinionBody: string): Promise<void> {
  const doc = await getDocument(documentTrackingCode);
  if (!doc) return;
  const docType = await getDocTypeById(doc.docTypeId);
  if (docType?.code.toLowerCase() !== "dc") return;

  if (doc.statusCode !== "review") {
    try {
      await transitionDocumentStatus(documentTrackingCode, "review");
    } catch {
      // docType에 review 상태가 없는 등 - 전이만 조용히 스킵.
    }
  }

  const snippet = opinionBody.length > 60 ? `${opinionBody.slice(0, 60)}...` : opinionBody;
  await sendOrAppendMessage(
    projectId,
    documentTrackingCode,
    `${documentTrackingCode}에 새 의견이 있습니다 - 확인해주세요: "${snippet}"`,
  );
}

export interface OpinionListFilter {
  targetType?: string;
  targetKey?: string;
  status?: "open" | "resolved" | "all";
}

export interface OpinionWithTargetLabel extends OpinionDetail {
  /** 대상(문서/계획)의 제목 - questions.ts의 targetLabel과 같은 이유로
   * 매번 대상을 또 조회하지 않게 목록 응답에 바로 얹는다. */
  targetLabel: string;
}

/** 기본값은 status:"open" - AI가 "확인할 게 있나" 물을 때 이미
 * 처리한 것까지 매번 다시 안 보게(message list의 active 관례와 같은
 * 이유). --status all로 전체 이력을 본다. */
export async function listOpinions(projectId: string, filter: OpinionListFilter = {}): Promise<OpinionWithTargetLabel[]> {
  const db = getDb();
  const status = filter.status ?? "open";
  const rows = await db.opinion.findMany({
    where: {
      projectId,
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.targetKey ? { targetKey: filter.targetKey } : {}),
      ...(status !== "all" ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const results: OpinionWithTargetLabel[] = [];
  for (const r of rows) {
    results.push({ ...r, targetLabel: await resolveOpinionTargetLabel(r.targetType, r.targetKey) });
  }
  return results;
}

/** 권한 확인용 - REST 라우트가 resolve 전에 이 의견이 속한
 * 프로젝트에서 editor 이상인지 확인할 때 쓴다(questions.ts의
 * getQuestionProjectId와 같은 패턴). */
export async function getOpinionProjectId(id: string): Promise<string | null> {
  const db = getDb();
  const row = await db.opinion.findUnique({ where: { id } });
  return row?.projectId ?? null;
}

/** open → resolved만 허용(되돌리기 없음 - CodeReviewFinding과 같은
 * 이유: 다시 의견을 내야 할 상황이면 새 의견으로 남기는 게 자연스럽다). */
export async function resolveOpinion(id: string, resolvedBy: string | null): Promise<OpinionDetail> {
  const db = getDb();
  const existing = await db.opinion.findUnique({ where: { id } });
  if (!existing) throw new Error(`의견을 찾을 수 없습니다: ${id}`);
  const row = await db.opinion.update({
    where: { id },
    data: { status: "resolved", resolvedBy, resolvedAt: new Date() },
  });

  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "opinion",
    action: "update",
    id,
    targetType: existing.targetType,
    targetKey: existing.targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return row;
}

/** 문서/계획 GET 응답의 notices 배너가 쓴다(#opinion-target-notice) -
 * "이 대상을 다시 열었을 때 자동으로 눈에 띄어야 한다"는 요청. */
export async function countOpenOpinionsForTarget(targetType: string, targetKey: string): Promise<number> {
  const db = getDb();
  return db.opinion.count({ where: { targetType, targetKey, status: "open" } });
}

/** comments.ts의 listRecentComments/questions.ts의 resolveTargetLabel과
 * 같은 이유의 targetLabel 조회 - listOpinions()가 항목마다 재사용한다. */
export async function resolveOpinionTargetLabel(targetType: string, targetKey: string): Promise<string> {
  if (targetType === "document") {
    const doc = await getDocument(targetKey);
    return doc?.title ?? targetKey;
  }
  if (targetType === "plan") {
    const plan = await getPlanByTrackingCode(targetKey);
    return plan?.title ?? targetKey;
  }
  return targetKey;
}
