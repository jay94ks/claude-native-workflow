import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { allowedNextStatuses } from "./docTypes.js";
import { resyncDocumentIndex, getDocument } from "./documents.js";
import { getKanbanCardByTrackingCode } from "./kanban.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { isSuperAdmin } from "./auth.js";

const QUESTION_TYPE_CODE = "QU";

export type QuestionTargetType = "document" | "source" | "kanbanCard";
export type QuestionKind = "approval" | "answer";

export interface QuestionOptionDetail {
  label: string;
  detail: string | null;
}

export interface QuestionDetail {
  trackingCode: string;
  projectId: string;
  targetType: string;
  targetKey: string;
  ordinal: number;
  kind: string; // "approval" | "answer"
  text: string;
  askedBy: string;
  status: string; // open(AI 질의, 설계자 답변 대기) | pending(설계자 답변 완료, AI 확인 대기) | resolved(AI 확인 완료) | withdrawn(질의를 낸 본인이 철회 - open일 때만 가능)
  refs: string[];
  options: QuestionOptionDetail[];
}

export interface AnswerDetail {
  decision: string | null; // "approved" | "rejected" - kind="approval"일 때만
  body: string | null;
  answeredBy: string;
  answeredAt: Date;
}

async function assertTargetExists(projectId: string, targetType: string, targetKey: string): Promise<void> {
  if (targetType === "document") {
    const doc = await getDocument(targetKey);
    if (!doc || doc.projectId !== projectId) throw new Error(`대상 문서를 찾을 수 없습니다: ${targetKey}`);
  } else if (targetType === "kanbanCard") {
    const card = await getKanbanCardByTrackingCode(targetKey);
    if (!card || card.projectId !== projectId) throw new Error(`대상 카드를 찾을 수 없습니다: ${targetKey}`);
  } else if (targetType !== "source") {
    throw new Error(`알 수 없는 대상 종류입니다: ${targetType}`);
  }
}

/** 질의는 AI가 등록하고 설계자가 답변하는 것 - kind로 "승인 요청"
 * (approval)과 "답변 요청"(answer)을 구분한다. refTrackingCodes는
 * AI가 판단에 참고한 문서들을 구조적으로 태깅한다(DocumentLink와
 * 같은 조인 테이블 패턴 - 대상 종류와 무관하게 근거는 항상 문서). */
export async function addQuestion(
  projectId: string,
  targetType: string,
  targetKey: string,
  kind: string,
  text: string,
  askedBy: string,
  refTrackingCodes?: string[],
  options?: { label: string; detail?: string }[],
): Promise<QuestionDetail> {
  if (kind !== "approval" && kind !== "answer") throw new Error(`kind는 approval/answer 중 하나여야 합니다: ${kind}`);
  if (!text.trim()) throw new Error("text가 필요합니다");
  await assertTargetExists(projectId, targetType, targetKey);
  const db = getDb();

  const refs = refTrackingCodes?.filter(Boolean) ?? [];
  for (const ref of refs) {
    const refDoc = await db.document.findUnique({ where: { trackingCode: ref } });
    if (!refDoc) throw new Error(`참고 문서를 찾을 수 없습니다: ${ref}`);
  }

  const opts = (options ?? []).filter((o) => o.label.trim());

  const count = await db.question.count({ where: { targetType, targetKey } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(projectId, QUESTION_TYPE_CODE, "question", (trackingCode) =>
    db.question.create({
      data: { projectId, targetType, targetKey, trackingCode, ordinal: count + 1, kind, text, askedBy, status: "open" },
    }),
  );

  if (refs.length > 0) {
    await db.questionReference.createMany({
      data: refs.map((trackingCode) => ({ questionId: row.id, trackingCode })),
    });
  }

  if (opts.length > 0) {
    await db.questionOption.createMany({
      data: opts.map((o, order) => ({ questionId: row.id, label: o.label, detail: o.detail ?? null, order })),
    });
  }

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "question",
    action: "create",
    id: row.id,
    trackingCode: row.trackingCode,
    targetType,
    targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return {
    trackingCode: row.trackingCode,
    projectId,
    targetType,
    targetKey,
    ordinal: row.ordinal,
    kind: row.kind,
    text: row.text,
    askedBy: row.askedBy,
    status: row.status,
    refs,
    options: opts.map((o) => ({ label: o.label, detail: o.detail ?? null })),
  };
}

/** document/kanbanCard는 둘 다 트래킹 코드가 전역 유일이라, 대상의
 * 트래킹 코드 하나만으로 프로젝트/대상 종류를 역산할 수 있다 - CLI의
 * 기존 2-인자 시그니처(`docs question <trackingCode> <text>`)를 안 깨고
 * 대상 종류를 자동 판별하는 데 쓴다. source 파일은 트래킹 코드가 없어
 * 이 경로로 못 들어오고 별도 진입점(addQuestion 직접 호출)을 쓴다. */
export async function resolveTargetByTrackingCode(
  trackingCode: string,
): Promise<{ projectId: string; targetType: "document" | "kanbanCard" } | null> {
  const db = getDb();
  const doc = await db.document.findUnique({ where: { trackingCode } });
  if (doc) return { projectId: doc.projectId, targetType: "document" };
  const card = await db.kanbanCard.findUnique({ where: { trackingCode } });
  if (card) return { projectId: card.projectId, targetType: "kanbanCard" };
  return null;
}

export async function addQuestionByTrackingCode(
  trackingCode: string,
  kind: string,
  text: string,
  askedBy: string,
  refs?: string[],
  options?: { label: string; detail?: string }[],
): Promise<QuestionDetail> {
  const target = await resolveTargetByTrackingCode(trackingCode);
  if (!target) throw new Error(`대상을 찾을 수 없습니다: ${trackingCode}`);
  return addQuestion(target.projectId, target.targetType, trackingCode, kind, text, askedBy, refs, options);
}

export interface QuestionWithAnswer extends QuestionDetail {
  answer: AnswerDetail | null;
}

interface QuestionRow {
  trackingCode: string;
  projectId: string;
  targetType: string;
  targetKey: string;
  ordinal: number;
  kind: string;
  text: string;
  askedBy: string;
  status: string;
  refs: { trackingCode: string }[];
  options: { label: string; detail: string | null }[];
  answer: { decision: string | null; body: string | null; answeredBy: string; answeredAt: Date } | null;
}

function mapQuestionRow(r: QuestionRow): QuestionWithAnswer {
  return {
    trackingCode: r.trackingCode,
    projectId: r.projectId,
    targetType: r.targetType,
    targetKey: r.targetKey,
    ordinal: r.ordinal,
    kind: r.kind,
    text: r.text,
    askedBy: r.askedBy,
    status: r.status,
    refs: r.refs.map((x) => x.trackingCode),
    options: r.options.map((o) => ({ label: o.label, detail: o.detail })),
    answer: r.answer
      ? { decision: r.answer.decision, body: r.answer.body, answeredBy: r.answer.answeredBy, answeredAt: r.answer.answeredAt }
      : null,
  };
}

/** 대상 하나의 전체 질문(open+pending+resolved) 스레드. */
export async function listQuestions(targetType: string, targetKey: string): Promise<QuestionWithAnswer[]> {
  const db = getDb();
  const rows = await db.question.findMany({
    where: { targetType, targetKey },
    include: { answer: true, refs: true, options: { orderBy: { order: "asc" } } },
    orderBy: { ordinal: "asc" },
  });
  return rows.map(mapQuestionRow);
}

export interface QuestionPage {
  items: QuestionWithAnswer[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 문서 탭 분리(질의/답변) + 소스 코드/칸반 카드 다이얼로그가 공유해서
 * 쓰는 페이지네이션+검색+최신순 목록 - CLI/MCP가 쓰는 listQuestions()
 * (ordinal asc, 배열)는 그대로 두고 웹 전용 자매 함수로 추가한다. */
export async function listQuestionsPaged(
  targetType: string,
  targetKey: string,
  opts: { page: number; pageSize: number; q?: string },
): Promise<QuestionPage> {
  const db = getDb();
  const safePage = Math.max(1, opts.page);
  const q = opts.q?.trim();
  const where = {
    targetType,
    targetKey,
    ...(q ? { OR: [{ text: { contains: q } }, { answer: { body: { contains: q } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.question.findMany({
      where,
      include: { answer: true, refs: true, options: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    db.question.count({ where }),
  ]);
  return {
    items: rows.map(mapQuestionRow),
    page: safePage,
    pageSize: opts.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
  };
}

export interface PendingQuestion extends QuestionDetail {
  targetLabel: string;
}

/** "미해결" 질의(open|pending) 목록 - 프로젝트 전체, 모든 대상 종류를
 * 섞어서 보여준다(각 행의 targetType/status로 호출부가 구분). */
export async function listPendingQuestions(projectId: string): Promise<PendingQuestion[]> {
  const db = getDb();
  const rows = await db.question.findMany({
    where: { status: { in: ["open", "pending"] }, projectId },
    include: { refs: true },
    orderBy: { createdAt: "asc" },
  });
  const results: PendingQuestion[] = [];
  for (const r of rows) {
    let targetLabel = r.targetKey;
    if (r.targetType === "document") {
      const doc = await getDocument(r.targetKey);
      if (doc) targetLabel = doc.title;
    } else if (r.targetType === "kanbanCard") {
      const card = await getKanbanCardByTrackingCode(r.targetKey);
      if (card) targetLabel = card.title;
    }
    results.push({
      trackingCode: r.trackingCode,
      projectId: r.projectId,
      targetType: r.targetType,
      targetKey: r.targetKey,
      ordinal: r.ordinal,
      kind: r.kind,
      text: r.text,
      askedBy: r.askedBy,
      status: r.status,
      refs: r.refs.map((x: { trackingCode: string }) => x.trackingCode),
      options: [],
      targetLabel,
    });
  }
  return results;
}

/** AI가 아직 확인(ack)하지 않은 답변 건수 - notices 배너가 씀. */
export async function countPendingQuestions(projectId: string): Promise<number> {
  const db = getDb();
  return db.question.count({ where: { status: "pending", projectId } });
}

export interface ReplyResult {
  question: QuestionDetail;
  answer: AnswerDetail;
  documentStatusTransitioned: string | null; // 자동 전이됐으면 새 상태 코드, 아니면 null
}

/** 질문 트래킹 코드로 그 질문이 속한 프로젝트를 구한다 - API 레이어가
 * 답변/ack 라우트의 인가(멤버 role)를 검사할 때 씀(경로에 projectId가
 * 없어 requireProjectRole 미들웨어를 못 쓰므로). */
export async function getQuestionProjectId(questionTrackingCode: string): Promise<string | null> {
  const db = getDb();
  const question = await db.question.findUnique({ where: { trackingCode: questionTrackingCode } });
  return question?.projectId ?? null;
}

/** Answer insert + Question.status를 "pending"으로 갱신 - kind에 따라
 * 필수 필드가 다르다(approval은 decision, answer는 body). targetType이
 * "document"이고 그 문서의 모든 질문이 open을 벗어나면, 다음 상태가
 * 정확히 하나뿐일 때만(모호하지 않을 때만) 자동으로 전이시킨다(source/
 * kanbanCard 대상은 DocStatus 워크플로우 자체가 없어 전이 개념이 없음). */
export async function answerQuestion(
  questionTrackingCode: string,
  input: { decision?: string; body?: string },
  answeredBy: string,
): Promise<ReplyResult> {
  const db = getDb();
  const question = await db.question.findUnique({ where: { trackingCode: questionTrackingCode } });
  if (!question) throw new Error(`질문을 찾을 수 없습니다: ${questionTrackingCode}`);
  if (question.status !== "open") {
    throw new Error(`이미 답변됐거나 처리된 질문입니다: ${questionTrackingCode}`);
  }

  if (question.kind === "approval") {
    if (input.decision !== "approved" && input.decision !== "rejected") {
      throw new Error("승인 요청에는 decision(approved|rejected)이 필요합니다");
    }
  } else if (!input.body || !input.body.trim()) {
    throw new Error("답변 요청에는 body(답변 내용)가 필요합니다");
  }

  const answerRow = await db.answer.create({
    data: { questionId: question.id, decision: input.decision ?? null, body: input.body ?? null, answeredBy },
  });
  const updatedQuestion = await db.question.update({
    where: { id: question.id },
    data: { status: "pending" },
  });
  const refRows = await db.questionReference.findMany({ where: { questionId: question.id } });
  const optionRows = await db.questionOption.findMany({ where: { questionId: question.id }, orderBy: { order: "asc" } });

  await realtimePublish(projectChangesTopic(question.projectId), {
    entity: "answer",
    action: "create",
    id: answerRow.id,
    trackingCode: questionTrackingCode,
    targetType: question.targetType,
    targetKey: question.targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  let documentStatusTransitioned: string | null = null;
  if (question.targetType === "document") {
    const remainingOpen = await db.question.count({
      where: { targetType: "document", targetKey: question.targetKey, status: "open" },
    });
    if (remainingOpen === 0) {
      const document = await db.document.findUnique({ where: { trackingCode: question.targetKey } });
      if (document) {
        const next = await allowedNextStatuses(document.docTypeId, document.statusId);
        if (next.length === 1) {
          await db.document.update({ where: { id: document.id }, data: { statusId: next[0].id } });
          documentStatusTransitioned = next[0].code;
          await resyncDocumentIndex(question.targetKey);
        }
      }
    }
  }

  return {
    question: {
      trackingCode: updatedQuestion.trackingCode,
      projectId: updatedQuestion.projectId,
      targetType: updatedQuestion.targetType,
      targetKey: updatedQuestion.targetKey,
      ordinal: updatedQuestion.ordinal,
      kind: updatedQuestion.kind,
      text: updatedQuestion.text,
      askedBy: updatedQuestion.askedBy,
      status: updatedQuestion.status,
      refs: refRows.map((x: { trackingCode: string }) => x.trackingCode),
      options: optionRows.map((o: { label: string; detail: string | null }) => ({ label: o.label, detail: o.detail })),
    },
    answer: { decision: answerRow.decision, body: answerRow.body, answeredBy: answerRow.answeredBy, answeredAt: answerRow.answeredAt },
    documentStatusTransitioned,
  };
}

/** AI가 pending(설계자 답변 완료) 질의를 확인 완료로 표시 - resolved로
 * 전이. pending이 아닌 상태(open/resolved)에서 호출하면 막힌다. */
export async function acknowledgeQuestion(questionTrackingCode: string): Promise<QuestionDetail> {
  const db = getDb();
  const question = await db.question.findUnique({ where: { trackingCode: questionTrackingCode } });
  if (!question) throw new Error(`질문을 찾을 수 없습니다: ${questionTrackingCode}`);
  if (question.status !== "pending") {
    throw new Error(`답변 대기 중이거나 이미 처리된 질의입니다: ${questionTrackingCode}`);
  }
  const updated = await db.question.update({ where: { id: question.id }, data: { status: "resolved" } });
  const refRows = await db.questionReference.findMany({ where: { questionId: question.id } });
  const optionRows = await db.questionOption.findMany({ where: { questionId: question.id }, orderBy: { order: "asc" } });
  return {
    trackingCode: updated.trackingCode,
    projectId: updated.projectId,
    targetType: updated.targetType,
    targetKey: updated.targetKey,
    ordinal: updated.ordinal,
    kind: updated.kind,
    text: updated.text,
    askedBy: updated.askedBy,
    status: updated.status,
    refs: refRows.map((x: { trackingCode: string }) => x.trackingCode),
    options: optionRows.map((o: { label: string; detail: string | null }) => ({ label: o.label, detail: o.detail })),
  };
}

/** 질의를 낸 본인(또는 superAdmin)이 "더 이상 유효하지 않다"고 표시 -
 * 아직 아무도 답변하지 않은(open) 질의만 철회할 수 있다(설계자가 이미
 * 답변을 남긴 pending 질의를 되돌리는 건 다른 성격의 동작이라 범위
 * 밖 - 그 경우는 ack로 마무리). withdrawn은 answerQuestion/
 * acknowledgeQuestion/listPendingQuestions의 기존 상태 화이트리스트
 * 밖이라 별도 가드 없이도 자동으로 배제된다. */
export async function withdrawQuestion(questionTrackingCode: string, requesterId: string): Promise<QuestionDetail> {
  const db = getDb();
  const question = await db.question.findUnique({ where: { trackingCode: questionTrackingCode } });
  if (!question) throw new Error(`질문을 찾을 수 없습니다: ${questionTrackingCode}`);
  if (question.askedBy !== requesterId && !(await isSuperAdmin(requesterId))) {
    throw new Error("본인이 등록한 질문만 철회할 수 있습니다");
  }
  if (question.status !== "open") {
    throw new Error(`아직 답변되지 않은 질문만 철회할 수 있습니다: ${questionTrackingCode}`);
  }
  const updated = await db.question.update({ where: { id: question.id }, data: { status: "withdrawn" } });
  const refRows = await db.questionReference.findMany({ where: { questionId: question.id } });
  const optionRows = await db.questionOption.findMany({ where: { questionId: question.id }, orderBy: { order: "asc" } });
  return {
    trackingCode: updated.trackingCode,
    projectId: updated.projectId,
    targetType: updated.targetType,
    targetKey: updated.targetKey,
    ordinal: updated.ordinal,
    kind: updated.kind,
    text: updated.text,
    askedBy: updated.askedBy,
    status: updated.status,
    refs: refRows.map((x: { trackingCode: string }) => x.trackingCode),
    options: optionRows.map((o: { label: string; detail: string | null }) => ({ label: o.label, detail: o.detail })),
  };
}
