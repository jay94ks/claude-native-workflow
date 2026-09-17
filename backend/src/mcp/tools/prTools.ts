// 배치 2d(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - Pull
// Request + 코드 리뷰(사후 검토). mcp/server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
//
// git 저장소 관리 기능(브랜치/저장소 연동/발행)은 지금까지 웹 전용
// 이었지만, PR은 이번에 CLI/MCP를 예외로 연다 - 자동 머지가 실패했을
// 때 Claude가 직접 진단하고 수동 병합까지 완료할 수 있어야 하기
// 때문(설계자 요구사항 4번). PR 생성은 브랜치 선택 UI와 강하게
// 결합돼 있어 여전히 웹에서만 한다.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

const codeReviewFindingSchema = z.object({
  filePath: z.string(),
  line: z.number().optional(),
  category: z.string(),
  severity: z.enum(["blocker", "major", "minor", "nit"]),
  summary: z.string(),
  failureScenario: z.string(),
  verdict: z.enum(["CONFIRMED", "PLAUSIBLE"]).optional(),
});

export function registerPrTools(tool: ToolRegistrar): void {
  tool(
    "pr_list",
    "Pull Request 목록",
    "항상 최신순(createdAt desc). state(open/closed/all, 기본 all)로 필터. page/pageSize를 둘 다 생략하면 전체 배열, 하나라도 주면 페이지네이션 응답.",
    { projectId: z.string(), state: z.enum(["open", "closed", "all"]).optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const qs = new URLSearchParams();
      if (a.state) qs.set("state", String(a.state));
      const paged = a.page !== undefined || a.pageSize !== undefined;
      if (paged) {
        qs.set("page", String(a.page ?? 1));
        qs.set("pageSize", String(a.pageSize ?? 20));
      }
      return call(`/api/projects/${a.projectId}/git/pulls${paged ? "/page" : ""}?${qs}`);
    },
  );
  tool("pr_get", "Pull Request 상세", "이 앱이 추가로 추적하는 disposition(merged/rejected/null)과 lastMergeError를 포함해 반환한다.", { projectId: z.string(), index: z.number() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/pulls/${a.index}`),
  );
  tool("pr_commits", "PR의 커밋 목록", "이 PR에 관여한 커밋 목록.", { projectId: z.string(), index: z.number() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/pulls/${a.index}/commits`),
  );
  tool("pr_comments", "PR 대화 조회", "설계자간 Markdown 대화(Gitea 댓글) 목록.", { projectId: z.string(), index: z.number() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/pulls/${a.index}/comments`),
  );
  tool(
    "pr_add_comment",
    "PR 대화에 댓글 추가",
    "설계자간 대화(Markdown)에 댓글을 남긴다.",
    { projectId: z.string(), index: z.number(), body: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/comments`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );
  tool("pr_timeline", "PR 진행 내역", "PR이 닫힐 때까지의 전체 히스토리(댓글/상태전이/머지/커밋참조 등 타입별 이벤트 피드).", { projectId: z.string(), index: z.number() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/pulls/${a.index}/timeline`),
  );
  tool("pr_messages", "PR에 기록된 이 앱의 메시지", "머지/거부/닫힘/재오픈 등 이 앱이 남긴 진행 메시지 목록.", { projectId: z.string(), index: z.number() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/pulls/${a.index}/messages`),
  );
  tool(
    "pr_merge",
    "PR 자동 머지",
    "owner 전용. 실패하면 lastMergeError가 기록되고 다음 pr_get 호출에서 수동 병합 안내를 확인할 수 있다.",
    { projectId: z.string(), index: z.number() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/merge`, { method: "POST" }),
  );
  tool(
    "pr_merge_manually",
    "PR 수동 머지 완료 기록",
    "owner 전용. 자동 머지가 실패했을 때, 로컬에서 직접(또는 Claude가 CLI로) 충돌을 해결해 push한 커밋 SHA를 넘기면 Gitea에 병합 완료로 기록된다.",
    { projectId: z.string(), index: z.number(), mergeCommitId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/merge-manually`, { method: "POST", body: JSON.stringify({ mergeCommitId: a.mergeCommitId }) }),
  );
  tool(
    "pr_reject",
    "PR 거부",
    "editor 이상. 거부돼도 이후 pr_reopen + 새 커밋으로 다시 Accept까지 갈 수 있다.",
    { projectId: z.string(), index: z.number() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/reject`, { method: "POST" }),
  );
  tool(
    "pr_close",
    "PR 닫기",
    "editor 이상. 머지/거부 여부와 무관하게 닫는다 - 둘 다 선택되지 않았으면 거부로 처리된다.",
    { projectId: z.string(), index: z.number() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/close`, { method: "POST" }),
  );
  tool(
    "pr_reopen",
    "PR 재오픈",
    "editor 이상. 거부/닫힘 상태의 PR을 다시 연다.",
    { projectId: z.string(), index: z.number() },
    async (a) => call(`/api/projects/${a.projectId}/git/pulls/${a.index}/reopen`, { method: "POST" }),
  );

  // 코드 리뷰(사후 검토) - 머지를 막는 게이트가 아니라 이미 반영된
  // 코드를 돌아보는 기록. diff는 이미 있는 git_diff로 직접 읽는다
  // (여기 전용 diff 도구는 없음).

  tool(
    "code_review_request",
    "코드 리뷰(사후 검토) 요청",
    'PR 머지 알림 메시지를 보고 실제로 검토할 가치가 있다고 판단했을 때, 또는 임의 범위를 검토하고 싶을 때 부른다. prIndex만 주면 그 PR의 base/head 브랜치를 자동으로 찾는다 - 이미 pending/completed인 같은 head 리뷰가 있으면 그걸 그대로 재사용.',
    { projectId: z.string(), prIndex: z.number().optional(), base: z.string().optional(), head: z.string().optional(), label: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/code-review/request`, {
        method: "POST",
        body: JSON.stringify({ prIndex: a.prIndex, base: a.base, head: a.head, label: a.label }),
      }),
  );
  tool("code_review_pending", "AI 분석 대기 중인 리뷰 목록", "status가 pending인 CodeReview 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/code-review/pending`),
  );
  tool(
    "code_review_list",
    "코드 리뷰 이력 조회",
    "상태 무관 최신순. prIndex를 주면 그 PR에 달린 리뷰만.",
    { projectId: z.string(), prIndex: z.number().optional() },
    async (a) => call(`/api/projects/${a.projectId}/git/code-review${a.prIndex !== undefined ? `?prIndex=${a.prIndex}` : ""}`),
  );
  tool("code_review_get", "코드 리뷰 상세", "지금까지의 finding 목록 포함.", { projectId: z.string(), reviewId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/code-review/${a.reviewId}`),
  );
  tool(
    "code_review_submit",
    "코드 리뷰 결과 제출",
    "findings 배열(+선택적 aiSummary)을 한 번에 제출해 리뷰를 완료 처리한다. severity가 blocker인 항목은 PN(실행 계획)이, major인 항목은 칸반 pending 컬럼 카드가 자동 생성된다(승인/변경요청 같은 게이트 개념은 없음 - 심각한 발견 자체가 추적 가능한 후속 작업이 된다).",
    { projectId: z.string(), reviewId: z.string(), aiSummary: z.string().optional(), findings: z.array(codeReviewFindingSchema) },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/code-review/${a.reviewId}/submit`, {
        method: "POST",
        body: JSON.stringify({ aiSummary: a.aiSummary, findings: a.findings }),
      }),
  );
  tool(
    "code_review_resolve_finding",
    "발견 항목 트리아지",
    "status는 fixed/wontfix/false_positive 중 하나(open으로 되돌리는 것은 지원 안 함 - 필요하면 새 finding으로 다시 제출). comment를 같이 주면 상태 전환과 함께 판단 근거(예: false_positive라고 본 이유)를 코멘트로 남긴다 - 다음 리뷰가 file_history로 이 근거를 다시 찾아볼 수 있다.",
    {
      projectId: z.string(),
      findingId: z.string(),
      status: z.enum(["fixed", "wontfix", "false_positive"]),
      comment: z.string().optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/code-review/findings/${a.findingId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status: a.status, comment: a.comment }),
      }),
  );
  tool(
    "code_review_delete",
    "코드 리뷰 삭제(취소)",
    "발견 항목이 0건인 리뷰만 삭제할 수 있다 - 하나라도 있으면 거부된다(잡아낸 게 있으면 영구 보존).",
    { projectId: z.string(), reviewId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/code-review/${a.reviewId}`, { method: "DELETE" }),
  );
  tool(
    "code_review_comment_add",
    "코드 리뷰 코멘트 추가",
    "findingId를 주면 그 발견 항목에, 생략하면 리뷰 전체(스코프 고지 등)에 코멘트를 남긴다. 문서/칸반 코멘트와 달리 AI가 직접 쓰는 채널 - 트리아지 근거를 여기 남겨두면 file_history로 다음 리뷰가 참고할 수 있다. 수정/삭제 불가(불변 기록).",
    { projectId: z.string(), reviewId: z.string(), body: z.string(), findingId: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/code-review/${a.reviewId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: a.body, findingId: a.findingId }),
      }),
  );
  tool(
    "code_review_file_history",
    "파일별 과거 리뷰 이력 조회",
    "이 프로젝트의 모든 리뷰를 통틀어 그 파일(line을 주면 그 라인까지 정확히 일치)에 걸렸던 과거 finding과 딸린 코멘트를 최신순으로 모아 보여준다. 새 리뷰를 시작하기 전에 '이 파일은 예전에도 잡힌 적 있나/그때 뭐라고 판단했나'를 확인하는 용도(자동 주입은 없음 - 직접 불러서 참고).",
    { projectId: z.string(), filePath: z.string(), line: z.number().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: a.filePath as string });
      if (a.line !== undefined) qs.set("line", String(a.line));
      return call(`/api/projects/${a.projectId}/git/code-review/file-history?${qs}`);
    },
  );
}
