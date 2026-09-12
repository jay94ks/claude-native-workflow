import { getDb } from "./db.js";
import * as gitea from "./gitea.js";
import { requireGiteaWorkingRef } from "./gitRepos.js";
import { sendMessage } from "./messages.js";

// PR 오케스트레이션 - Gitea 호출 + PullRequestMeta 갱신 + 진행 메시지
// 발송을 한 동작으로 묶는다. gitea.ts(순수 API 바인딩, DB 접근 0)나
// gitRepos.ts(저장소 연결 생명주기)에 얹지 않고 codeRelations.ts/
// documentSourceLinks.ts처럼 독립 모듈로 분리한 이유도 같다 - 도메인당
// 파일 하나 원칙.

// 메시지 본문에 붙이는 태그 - Message 모델은 특정 엔티티에 묶는 FK가
// 없어서(project/author만 있음) 칸반 카드가 이미 쓰는 관례(본문에
// "[KB-XXXXXXXX] "를 직접 박아넣고 나중에 startsWith로 필터링)를 그대로
// 따른다. 끝에 공백을 둬서 "[PR#5] "가 "[PR#50] "의 접두사로 오인되지
// 않게 한다.
function prTag(index: number): string {
  return `[PR#${index}] `;
}

export interface PullRequestDetail extends gitea.PullRequestSummary {
  disposition: "merged" | "rejected" | null;
  lastMergeError: string | null;
}

interface MetaRow {
  disposition: string | null;
  lastMergeError: string | null;
}

async function getMeta(projectId: string, prIndex: number): Promise<MetaRow | null> {
  const db = getDb();
  return db.pullRequestMeta.findUnique({ where: { projectId_prIndex: { projectId, prIndex } } });
}

async function upsertMeta(projectId: string, prIndex: number, patch: { disposition?: string | null; lastMergeError?: string | null }): Promise<void> {
  const db = getDb();
  await db.pullRequestMeta.upsert({
    where: { projectId_prIndex: { projectId, prIndex } },
    update: patch,
    create: { projectId, prIndex, disposition: patch.disposition ?? null, lastMergeError: patch.lastMergeError ?? null },
  });
}

function toDetail(summary: gitea.PullRequestSummary, meta: MetaRow | null): PullRequestDetail {
  return {
    ...summary,
    disposition: (meta?.disposition as "merged" | "rejected" | null) ?? null,
    lastMergeError: meta?.lastMergeError ?? null,
  };
}

export async function getPullRequestDetail(projectId: string, index: number): Promise<PullRequestDetail> {
  const target = await requireGiteaWorkingRef(projectId);
  const [summary, meta] = await Promise.all([gitea.getPullRequest(target, index), getMeta(projectId, index)]);
  return toDetail(summary, meta);
}

/** 최신순(요구사항 7) - Gitea listPullRequests가 이미 반환하는 순서에
 * 의존하지 않고 이 계층에서 항상 createdAt desc로 확정 정렬한다.
 * PullRequestMeta는 배치 조회(findMany where in)로 병합 - 목록 화면도
 * 배지를 보여줄 수 있게. */
export async function listPullRequestsForProject(
  projectId: string,
  state: "open" | "closed" | "all" | undefined,
): Promise<PullRequestDetail[]> {
  const target = await requireGiteaWorkingRef(projectId);
  const summaries = await gitea.listPullRequests(target, state);
  summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (summaries.length === 0) return [];
  const db = getDb();
  const metas = await db.pullRequestMeta.findMany({ where: { projectId, prIndex: { in: summaries.map((s) => s.index) } } });
  const metaByIndex = new Map<number, MetaRow>(
    metas.map((m: MetaRow & { prIndex: number }) => [m.prIndex, m] as [number, MetaRow]),
  );
  return summaries.map((s) => toDetail(s, metaByIndex.get(s.index) ?? null));
}

export async function mergePull(projectId: string, index: number, actingUserId: string | null, actingToken?: string): Promise<void> {
  const target = await requireGiteaWorkingRef(projectId);
  try {
    await gitea.mergePullRequest(target, index, actingToken);
    await upsertMeta(projectId, index, { disposition: "merged", lastMergeError: null });
    await sendMessage(projectId, actingUserId, `${prTag(index)}머지되었습니다.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await upsertMeta(projectId, index, { lastMergeError: message });
    await sendMessage(projectId, actingUserId, `${prTag(index)}자동 머지에 실패했습니다 - 수동 병합이 필요합니다: ${message}`);
    throw err; // 라우트가 에러를 그대로 전달, 프론트가 실패를 계기로 수동 병합 안내 배너를 켠다
  }
}

/** 자동 머지가 실패한 뒤(위 mergePull의 lastMergeError 경로), 로컬에서
 * 직접(또는 AI가 CLI로) 충돌을 해결해 push한 커밋을 Gitea에 "수동으로
 * 병합됨"으로 기록시킨다(요구사항 4번 핵심 메커니즘). */
export async function mergePullManually(projectId: string, index: number, mergeCommitId: string, actingUserId: string | null, actingToken?: string): Promise<void> {
  const target = await requireGiteaWorkingRef(projectId);
  await gitea.mergePullRequestManually(target, index, mergeCommitId, actingToken);
  await upsertMeta(projectId, index, { disposition: "merged", lastMergeError: null });
  await sendMessage(projectId, actingUserId, `${prTag(index)}수동 병합이 완료 처리되었습니다(commit: ${mergeCommitId.slice(0, 8)}).`);
}

export async function rejectPull(projectId: string, index: number, actingUserId: string | null, actingToken?: string): Promise<void> {
  const target = await requireGiteaWorkingRef(projectId);
  await gitea.setPullRequestState(target, index, "closed", actingToken);
  await upsertMeta(projectId, index, { disposition: "rejected" });
  await sendMessage(projectId, actingUserId, `${prTag(index)}거부되었습니다.`);
}

/** 요구사항 6: Close는 상태 불문 닫되, Merge/Reject 둘 다 명시적으로
 * 선택된 적이 없으면(disposition이 아직 null) 거부로 간주한다. 이미
 * merged/rejected가 확정된 PR은 프론트에서 Close 버튼 자체를 숨기므로
 * (머지된 PR은 Gitea에서도 이미 closed) 여기서는 그 경우를 별도로
 * 막지 않는다. */
export async function closePull(projectId: string, index: number, actingUserId: string | null, actingToken?: string): Promise<void> {
  const target = await requireGiteaWorkingRef(projectId);
  const meta = await getMeta(projectId, index);
  await gitea.setPullRequestState(target, index, "closed", actingToken);
  if (!meta?.disposition) {
    await upsertMeta(projectId, index, { disposition: "rejected" });
    await sendMessage(projectId, actingUserId, `${prTag(index)}닫혔습니다(머지/거부가 선택되지 않아 거부로 처리됨).`);
  } else {
    await sendMessage(projectId, actingUserId, `${prTag(index)}닫혔습니다.`);
  }
}

/** 요구사항 5: 거부돼도 이후 커밋으로 결국 Accept에 닿을 수 있어야
 * 한다 - 다시 열면 disposition을 지워 다음 mergePull() 호출이 자연스럽게
 * "merged"로 덮어쓸 수 있게 한다. */
export async function reopenPull(projectId: string, index: number, actingUserId: string | null, actingToken?: string): Promise<void> {
  const target = await requireGiteaWorkingRef(projectId);
  await gitea.setPullRequestState(target, index, "open", actingToken);
  await upsertMeta(projectId, index, { disposition: null, lastMergeError: null });
  await sendMessage(projectId, actingUserId, `${prTag(index)}다시 열렸습니다.`);
}

export async function listMessagesForPullRequest(projectId: string, index: number) {
  const db = getDb();
  return db.message.findMany({ where: { projectId, body: { startsWith: prTag(index) } }, orderBy: { createdAt: "asc" } });
}
