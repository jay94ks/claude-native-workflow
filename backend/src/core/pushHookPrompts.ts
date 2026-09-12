import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";

// PushHookPrompt(트리거 설정) CRUD + PushHookQueueEntry(실제 트리거된
// 항목) 조회/상태 전이. 웹훅 수신 → 매칭 → 큐 적재 배관 자체는
// core/pushHooks.ts(Phase 2)가 이미 담당한다 - 여기는 그 설정을 만드는
// 쪽과, 큐를 소비하는 쪽(다음에 그 프로젝트를 여는 세션)만 다룬다.
// 서버는 큐 항목을 보고 클로드 세션을 직접 스폰하지 않는다(대기열
// 방식으로 확정된 설계) - ack/done은 그 세션이 스스로 호출한다.

export interface PushHookPrompt {
  id: string;
  projectId: string;
  triggerBranch: string | null;
  promptTemplate: string;
  createdAt: Date;
}

export async function createPushHookPrompt(
  projectId: string,
  input: { triggerBranch?: string; promptTemplate: string },
): Promise<PushHookPrompt> {
  if (!input.promptTemplate) throw new Error("promptTemplate이 필요합니다");
  const db = getDb();
  return db.pushHookPrompt.create({
    data: { projectId, triggerBranch: input.triggerBranch ?? null, promptTemplate: input.promptTemplate },
  });
}

export async function listPushHookPrompts(projectId: string): Promise<PushHookPrompt[]> {
  const db = getDb();
  return db.pushHookPrompt.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
}

export async function listPushHookPromptsPaged(projectId: string, page: number, pageSize: number): Promise<Page<PushHookPrompt>> {
  const db = getDb();
  return paginate(
    (args) => db.pushHookPrompt.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, ...args }),
    () => db.pushHookPrompt.count({ where: { projectId } }),
    page,
    pageSize,
  );
}

export async function deletePushHookPrompt(id: string, projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.pushHookPrompt.findUnique({ where: { id } });
  if (!row || row.projectId !== projectId) {
    throw new Error("push hook 프롬프트를 찾을 수 없거나 이 프로젝트 소유가 아닙니다");
  }
  await db.pushHookPrompt.delete({ where: { id } });
}

/** 트리거 브랜치/프롬프트 내용을 부분 갱신한다 - 넘긴 필드만 바꾸고
 * 나머지는 그대로 둔다. triggerBranch에 빈 문자열을 주면 브랜치 제한을
 * 해제(null - 모든 브랜치 매칭)한다 - create()가 이미 "안 넘기면 모든
 * 브랜치"이므로 그 대칭. deletePushHookPrompt()와 같은 조회+소유
 * 확인 패턴(다른 프로젝트 소유 리소스를 :projectId만 맞춰 건드리는
 * 사고 방지). */
export async function updatePushHookPrompt(
  id: string,
  projectId: string,
  input: { triggerBranch?: string; promptTemplate?: string },
): Promise<PushHookPrompt> {
  const db = getDb();
  const row = await db.pushHookPrompt.findUnique({ where: { id } });
  if (!row || row.projectId !== projectId) {
    throw new Error("push hook 프롬프트를 찾을 수 없거나 이 프로젝트 소유가 아닙니다");
  }
  if (input.promptTemplate !== undefined && !input.promptTemplate) {
    throw new Error("promptTemplate이 필요합니다");
  }
  const data: { triggerBranch?: string | null; promptTemplate?: string } = {};
  if (input.triggerBranch !== undefined) data.triggerBranch = input.triggerBranch === "" ? null : input.triggerBranch;
  if (input.promptTemplate !== undefined) data.promptTemplate = input.promptTemplate;
  return db.pushHookPrompt.update({ where: { id }, data });
}

export interface PushHookQueueEntry {
  id: string;
  pushHookPromptId: string;
  commitSha: string;
  status: string;
  triggeredAt: Date;
  promptTemplate: string;
  triggerBranch: string | null;
}

/** PushHookQueueEntry는 PushHookPrompt를 통해서만 프로젝트에 연결되므로
 * join해서 조회 - 응답에 promptTemplate/triggerBranch도 같이 담아
 * 반환한다(읽는 쪽이 프롬프트를 한 번 더 조회하지 않아도 되게). */
export async function listQueueEntries(projectId: string, status?: string): Promise<PushHookQueueEntry[]> {
  const db = getDb();
  const rows = await db.pushHookQueueEntry.findMany({
    where: {
      status: status ?? undefined,
      pushHookPrompt: { projectId },
    },
    include: { pushHookPrompt: true },
    orderBy: { triggeredAt: "desc" },
  });
  return (rows as Array<{
    id: string;
    pushHookPromptId: string;
    commitSha: string;
    status: string;
    triggeredAt: Date;
    pushHookPrompt: { promptTemplate: string; triggerBranch: string | null };
  }>).map((r) => ({
    id: r.id,
    pushHookPromptId: r.pushHookPromptId,
    commitSha: r.commitSha,
    status: r.status,
    triggeredAt: r.triggeredAt,
    promptTemplate: r.pushHookPrompt.promptTemplate,
    triggerBranch: r.pushHookPrompt.triggerBranch,
  }));
}

export async function listQueueEntriesPaged(
  projectId: string,
  status: string | undefined,
  page: number,
  pageSize: number,
): Promise<Page<PushHookQueueEntry>> {
  const db = getDb();
  const where = { status: status ?? undefined, pushHookPrompt: { projectId } };
  const result = await paginate(
    (args) => db.pushHookQueueEntry.findMany({ where, include: { pushHookPrompt: true }, orderBy: { triggeredAt: "desc" }, ...args }),
    () => db.pushHookQueueEntry.count({ where }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: (result.items as Array<{
      id: string;
      pushHookPromptId: string;
      commitSha: string;
      status: string;
      triggeredAt: Date;
      pushHookPrompt: { promptTemplate: string; triggerBranch: string | null };
    }>).map((r) => ({
      id: r.id,
      pushHookPromptId: r.pushHookPromptId,
      commitSha: r.commitSha,
      status: r.status,
      triggeredAt: r.triggeredAt,
      promptTemplate: r.pushHookPrompt.promptTemplate,
      triggerBranch: r.pushHookPrompt.triggerBranch,
    })),
  };
}

// queue entry는 PushHookPrompt를 통해서만 프로젝트에 연결되고(자기
// 자신은 projectId를 안 들고 있음) - 라우트가 :projectId/:id 두 경로
// 파라미터를 받으므로, id만으로 찾아 바로 전이시키면 :projectId
// 쪽의 requireProjectRole 검사가 사실상 무의미해진다(그 프로젝트의
// editor면 남의 프로젝트 id를 넣어도 통과 - 실측으로 재현 확인한
// 버그). deletePushHookPrompt()가 이미 하고 있는 "조회 후 projectId
// 일치 확인" 패턴을 여기도 그대로 적용한다.
async function transitionQueueEntry(id: string, projectId: string, allowedFrom: string[], to: string): Promise<void> {
  const db = getDb();
  const row = await db.pushHookQueueEntry.findUnique({ where: { id }, include: { pushHookPrompt: true } });
  if (!row || (row as { pushHookPrompt: { projectId: string } }).pushHookPrompt.projectId !== projectId) {
    throw new Error(`큐 항목을 찾을 수 없습니다: ${id}`);
  }
  if (!allowedFrom.includes(row.status)) {
    throw new Error(`상태가 ${allowedFrom.join("|")}일 때만 가능합니다(현재: ${row.status})`);
  }
  await db.pushHookQueueEntry.update({ where: { id }, data: { status: to } });
}

export async function acknowledgeQueueEntry(id: string, projectId: string): Promise<void> {
  await transitionQueueEntry(id, projectId, ["pending"], "acknowledged");
}

export async function completeQueueEntry(id: string, projectId: string): Promise<void> {
  await transitionQueueEntry(id, projectId, ["pending", "acknowledged"], "done");
}

const PUSH_HOOK_QUEUE_TTL_DAYS = 30;

/** pending 상태로 TTL_DAYS 넘게 방치된 큐 항목을 "expired"로 전이한다 -
 * 아무도 그 프로젝트를 다시 안 열어 영원히 pending으로 쌓이는 걸
 * 막는다(삭제 대신 상태만 바꿔 감사 기록은 남김 - 문서를 archived로
 * 보관하는 것과 같은 이 저장소의 소프트 정리 원칙). `acknowledged`는
 * 이미 사람/세션이 관여한 흔적이라 TTL 대상에서 제외 - 진행 중인
 * 작업을 임의로 만료 취급하면 안 된다. server.ts의 주기 워커가
 * 호출한다. */
export async function expireStalePushHookQueueEntries(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - PUSH_HOOK_QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.pushHookQueueEntry.updateMany({
    where: { status: "pending", triggeredAt: { lt: cutoff } },
    data: { status: "expired" },
  });
  return result.count;
}
