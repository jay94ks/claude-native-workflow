import { getDb } from "./db.js";
import * as gitea from "./gitea.js";
import { requireGiteaWorkingRef } from "./gitRepos.js";
import { createPlan } from "./plans.js";
import { createKanbanCard } from "./kanban.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";

// 코드 리뷰(사후 검토) 오케스트레이션 - pullRequests.ts와 같은 이유로
// 독립 모듈(도메인당 파일 하나 원칙). 머지를 막는 게이트가 아니라
// "이미 반영된 코드를 돌아보는 기록"이라, PR 관리와 달리 Gitea 쪽에
// 아무 상태도 쓰지 않는다(diff는 `docs git compare`(gitea.compareDiff,
// core/gitea.ts)로 AI가 직접 읽는다 - 이 모듈은 리뷰 결과만 관리).
//
// 메시지 채널은 "새 변화가 감지됐다"는 순수 알림 한 번뿐이다(머지 시
// pullRequests.ts의 mergePull()/mergePullManually()가 보낸다) - 이
// 모듈은 Message 모델을 건드리지 않는다(요청/제출/삭제 어디에서도
// sendMessage를 호출하지 않음 - 설계자 지시, 메시지 더미 방지).

export interface CodeReviewFindingInput {
  filePath: string;
  line?: number | null;
  category: string;
  severity: "blocker" | "major" | "minor" | "nit";
  summary: string;
  failureScenario: string;
  verdict?: "CONFIRMED" | "PLAUSIBLE" | null;
}

/** 같은 (projectId, headRef) 리뷰가 이미 있으면 그대로 재사용한다(중복
 * 방지) - "라운드"라는 개념이 없어져 복합 유니크 제약 대신 조회로
 * 처리. prIndex가 있는데 base/head를 안 주면 Gitea에서 그 PR의
 * head/base 브랜치를 직접 조회한다(호출부가 매번 두 번 묻지 않아도
 * 되게 - AI가 `--pr`만 주고 바로 요청할 수 있다). */
export async function requestReview(
  projectId: string,
  input: { prIndex?: number; base?: string; head?: string; label: string },
  actingUserId: string | null,
): Promise<{ id: string; status: string }> {
  if (!input.label.trim()) throw new Error("label이 필요합니다");
  let base = input.base;
  let head = input.head;
  if ((!base || !head) && input.prIndex !== undefined) {
    const target = await requireGiteaWorkingRef(projectId);
    const pr = await gitea.getPullRequest(target, input.prIndex);
    // 브랜치 이름(pr.baseBranch/headBranch)이 아니라 그 시점의 정확한
    // 커밋(SHA)을 쓴다 - 브랜치 이름은 새 커밋이 push돼도 안 바뀌어서,
    // dedup 키로 쓰면 "새 커밋 후 다시 봐달라"는 재요청이 예전 완료된
    // 리뷰를 그대로 돌려주는 버그가 있었다(Phase 2 검증 중 발견).
    base = base ?? pr.baseSha;
    head = head ?? pr.headSha;
  }
  if (!base || !head) throw new Error("base/head를 확인할 수 없습니다 - 직접 지정하거나 prIndex를 넘겨주세요");

  const db = getDb();
  const existing = await db.codeReview.findFirst({ where: { projectId, headRef: head } });
  if (existing) return { id: existing.id, status: existing.status };

  const row = await db.codeReview.create({
    data: {
      projectId,
      prIndex: input.prIndex ?? null,
      label: input.label,
      baseRef: base,
      headRef: head,
      triggeredBy: "manual",
      requestedBy: actingUserId,
    },
  });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "codeReview",
    action: "create",
    id: row.id,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return { id: row.id, status: row.status };
}

export async function listPending(projectId: string) {
  const db = getDb();
  return db.codeReview.findMany({ where: { projectId, status: "pending" }, orderBy: { createdAt: "asc" } });
}

/** 리뷰 이력 조회(상태 무관, 최신순) - prIndex를 주면 그 PR에 달린
 * 것만, 생략하면 프로젝트 전체(코드 리뷰 목록 화면이 씀). headRef를
 * SHA로 고정한 뒤로는(위 requestReview 참고) 같은 PR도 새 커밋마다
 * 새 행이 생기므로 실제로 여러 건일 수 있다. */
export async function listReviews(projectId: string, prIndex?: number) {
  const db = getDb();
  return db.codeReview.findMany({
    where: { projectId, ...(prIndex !== undefined ? { prIndex } : {}) },
    orderBy: { createdAt: "desc" },
    include: { findings: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getReviewDetail(reviewId: string) {
  const db = getDb();
  const review = await db.codeReview.findUnique({
    where: { id: reviewId },
    include: { findings: { orderBy: { createdAt: "asc" } } },
  });
  if (!review) throw new Error(`리뷰를 찾을 수 없습니다: ${reviewId}`);
  return review;
}

/** severity별 자동 후속 작업 연결 - blocker는 PN(실행 계획), major는
 * 칸반 "pending" 컬럼 카드. 승인/변경요청 같은 게이트 개념이 없는 대신,
 * 심각한 발견은 그 자체로 추적 가능한 작업이 된다(설계자 지시). AI가
 * 만드는 후속 작업이라 origin은 항상 "ai" - kanban.createKanbanCard()가
 * origin:"designer"일 때만 자동으로 메시지를 보내는데, 여기선 메시지를
 * 또 쌓지 않기 위해 일부러 "ai"로 만든다. */
async function createFollowUp(
  projectId: string,
  actingUserId: string | null,
  review: { label: string },
  finding: CodeReviewFindingInput,
): Promise<string | null> {
  const title = `[사후 검토] ${finding.summary.slice(0, 60)}`;
  const body = [
    `**분류**: ${finding.category}`,
    `**위치**: ${finding.filePath}${finding.line ? `:${finding.line}` : ""}`,
    `**재현/실패 시나리오**: ${finding.failureScenario}`,
    `**출처**: ${review.label}`,
  ].join("\n\n");
  const createdBy = actingUserId ?? "system";

  if (finding.severity === "blocker") {
    const plan = await createPlan(projectId, title, body, createdBy);
    return plan.trackingCode;
  }
  if (finding.severity === "major") {
    const db = getDb();
    const column = await db.kanbanColumn.findFirst({ where: { projectId, name: "pending" } });
    if (!column) return null; // 컬럼이 없는(삭제된) 프로젝트 - 후속 연결만 조용히 생략, finding 저장 자체는 계속
    const card = await createKanbanCard(projectId, column.id, title, body, "ai", createdBy);
    return card.trackingCode;
  }
  return null;
}

export async function submitFindings(
  projectId: string,
  reviewId: string,
  input: { aiSummary?: string; findings: CodeReviewFindingInput[] },
  actingUserId: string | null,
): Promise<{ id: string; status: string; findingCount: number; followUpCount: number }> {
  const db = getDb();
  const review = await db.codeReview.findUnique({ where: { id: reviewId } });
  if (!review || review.projectId !== projectId) throw new Error(`리뷰를 찾을 수 없습니다: ${reviewId}`);

  let followUpCount = 0;
  for (const finding of input.findings) {
    const followUpRef = await createFollowUp(projectId, actingUserId, review, finding);
    if (followUpRef) followUpCount++;
    await db.codeReviewFinding.create({
      data: {
        reviewId,
        filePath: finding.filePath,
        line: finding.line ?? null,
        category: finding.category,
        severity: finding.severity,
        summary: finding.summary,
        failureScenario: finding.failureScenario,
        verdict: finding.verdict ?? null,
        followUpRef,
      },
    });
  }

  const updated = await db.codeReview.update({
    where: { id: reviewId },
    data: { status: "completed", completedAt: new Date(), aiSummary: input.aiSummary ?? null },
  });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "codeReview",
    action: "update",
    id: reviewId,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return { id: updated.id, status: updated.status, findingCount: input.findings.length, followUpCount };
}

/** open → fixed/wontfix/false_positive만 허용(다시 open으로 되돌리는
 * 것은 범위 밖 - 필요해지면 새 finding으로 다시 잡는 게 자연스럽다). */
export async function resolveFinding(findingId: string, status: string, resolvedBy: string | null): Promise<void> {
  if (!["fixed", "wontfix", "false_positive"].includes(status)) {
    throw new Error(`status는 fixed/wontfix/false_positive 중 하나여야 합니다: ${status}`);
  }
  const db = getDb();
  const finding = await db.codeReviewFinding.findUnique({ where: { id: findingId } });
  if (!finding) throw new Error(`발견 항목을 찾을 수 없습니다: ${findingId}`);
  await db.codeReviewFinding.update({
    where: { id: findingId },
    data: { status, resolvedBy, resolvedAt: new Date() },
  });
}

/** findings가 하나라도 있으면 삭제할 수 없다(설계자 지시 - "잡아낸 게
 * 있으면" 그 기록은 영구 보존, 문서 버전 이력과 같은 감사 가능성
 * 원칙). 0건인(아직 처리 전이거나, 검토했지만 아무것도 못 찾은) 리뷰만
 * 취소/정리할 수 있다. */
export async function deleteReview(projectId: string, reviewId: string): Promise<void> {
  const db = getDb();
  const review = await db.codeReview.findUnique({ where: { id: reviewId }, include: { findings: true } });
  if (!review || review.projectId !== projectId) throw new Error(`리뷰를 찾을 수 없습니다: ${reviewId}`);
  if (review.findings.length > 0) {
    throw new Error("이 리뷰는 발견 항목이 있어 삭제할 수 없습니다");
  }
  await db.codeReview.delete({ where: { id: reviewId } });
}
