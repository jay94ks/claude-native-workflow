import { getDb } from "./db.js";

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

export async function deletePushHookPrompt(id: string, projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.pushHookPrompt.findUnique({ where: { id } });
  if (!row || row.projectId !== projectId) {
    throw new Error("push hook 프롬프트를 찾을 수 없거나 이 프로젝트 소유가 아닙니다");
  }
  await db.pushHookPrompt.delete({ where: { id } });
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

async function transitionQueueEntry(id: string, allowedFrom: string[], to: string): Promise<void> {
  const db = getDb();
  const row = await db.pushHookQueueEntry.findUnique({ where: { id } });
  if (!row) throw new Error(`큐 항목을 찾을 수 없습니다: ${id}`);
  if (!allowedFrom.includes(row.status)) {
    throw new Error(`상태가 ${allowedFrom.join("|")}일 때만 가능합니다(현재: ${row.status})`);
  }
  await db.pushHookQueueEntry.update({ where: { id }, data: { status: to } });
}

export async function acknowledgeQueueEntry(id: string): Promise<void> {
  await transitionQueueEntry(id, ["pending"], "acknowledged");
}

export async function completeQueueEntry(id: string): Promise<void> {
  await transitionQueueEntry(id, ["pending", "acknowledged"], "done");
}
