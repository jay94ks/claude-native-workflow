// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git 저장소
// 연결/이력 조회(연결/해제/동기화/발행/로그/blame/show/diff/compare).
// mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. tree/cat/read/
// grep/put/delete/cat_batch는 gitFileTools.ts로, staging(add/rm/commit 등)은
// gitStagingTools.ts로 갈라졌다.
//
// git_diff/git_compare는 응답이 JSON이 아니라 순수 텍스트(unified diff)라
// 다른 도구처럼 tool() 래퍼(JSON.stringify)를 안 거치고 server.registerTool을
// 직접 호출해 원문 그대로 반환한다 - 그래서 이 파일만 ToolRegistrar 외에
// McpServer 인스턴스도 받는다.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCallText } from "../../cli/apiclient.js";
import { call, errorResult, type ToolRegistrar } from "../shared.js";

export function registerGitRepoTools(tool: ToolRegistrar, server: McpServer): void {
  tool(
    "git_link",
    "git 저장소 연결(자체 호스팅)",
    "Gitea에 저장소를 만들고 프로젝트에 연결한다 - importFromUrl을 주면 그 저장소의 히스토리를 통째로 가져와 시작한다(완전 이주).",
    { projectId: z.string(), importFromUrl: z.string().optional(), gitCredentialId: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/link`, {
        method: "POST",
        body: JSON.stringify(a.importFromUrl ? { importFrom: { repoUrl: a.importFromUrl, gitCredentialId: a.gitCredentialId } } : {}),
      }),
  );
  tool(
    "git_link_external",
    "git 저장소 연동(외부를 주된 저장소로)",
    "외부 GitHub/GitLab 저장소를 주된(authoritative) 저장소로 연동한다 - 관리 편의를 위해 Gitea에 미러(읽기 전용)와 작업 저장소(이 시스템이 커밋하는 곳)를 같이 만든다.",
    { projectId: z.string(), provider: z.enum(["github", "gitlab"]), repoUrl: z.string(), gitCredentialId: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/link-external`, {
        method: "POST",
        body: JSON.stringify({ provider: a.provider, repoUrl: a.repoUrl, gitCredentialId: a.gitCredentialId }),
      }),
  );
  tool("git_repo", "연결된 git 저장소 조회", "프로젝트에 연결된 git 저장소 정보를 반환한다.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/repo`),
  );
  tool(
    "git_unlink",
    "외부 연동 해제(자체 호스팅으로 전환)",
    "외부 연동(git_link_external)의 권위 저장소 관계만 끊는다 - Gitea 작업 저장소는 그대로 남아 self_hosted로 전환된다(자체 호스팅 저장소는 해제할 수 없다 - 프로젝트 삭제만 가능).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/repo`, { method: "DELETE" }),
  );
  tool(
    "git_sync_status",
    "동기화 상태 확인",
    "외부 연동(git_link_external) 프로젝트의 미러 대비 작업 저장소 변경 현황(added/changed/removedFromWork)을 확인한다 - Gitea의 미러 동기화가 비동기라 요청 후 완료될 때까지 기다렸다가 결과를 반환한다(이미 다른 요청이 진행 중이면 그 결과를 그대로 기다림).",
    { projectId: z.string() },
    async (a) => {
      await call(`/api/projects/${a.projectId}/git/sync-status`, { method: "POST" });
      for (;;) {
        const state = await call<{ status: string }>(`/api/projects/${a.projectId}/git/sync-status`);
        if (state.status === "ready") return state;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    },
  );
  tool(
    "git_sync_proposal",
    "동기화 제안 내용 조회",
    "외부 연동 프로젝트에서 달라진 파일들의 실제 내용을 가져온다 - 외부(권위) 저장소로 반영하는 건 설계자 몫.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/sync-proposal`),
  );
  tool(
    "git_publish",
    "외부 저장소로 동기화(발행)",
    "외부(권위) 저장소로 실제 동기화(push)를 시도한다 - 즉시 반영되면 status:synced, fast-forward 불가/권한 부족이면 status:queued로 AI 대기열에 올라간다(이 프로젝트에 메시지로도 안내됨).",
    { projectId: z.string(), gitCredentialId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish`, { method: "POST", body: JSON.stringify({ gitCredentialId: a.gitCredentialId }) }),
  );
  tool(
    "git_publish_queue",
    "발행 대기열 조회",
    "이 프로젝트의 처리 대기 중인 발행 큐 항목(없으면 null) - 세션 시작 시 확인 권장(pending이면 처리 후 git_publish_queue_done으로 보고).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish-queue`),
  );
  tool(
    "git_publish_queue_done",
    "발행 대기열 처리 완료 보고",
    "발행 큐 항목 처리를 완료로 보고한다 - 그래야 웹 UI의 동기화 버튼이 다시 활성화된다.",
    { projectId: z.string(), id: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish-queue/${a.id}/done`, { method: "POST" }),
  );
  tool(
    "git_log",
    "git 로그 조회",
    "자체 호스팅 저장소의 커밋 로그. page/pageSize를 주면 페이지네이션 응답을 받는다(Gitea 제약으로 total은 없음, hasMore만), 생략하면 전체 배열.",
    { projectId: z.string(), ref: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.ref ? { ref: String(a.ref) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects/${a.projectId}/git/log${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool("git_blame", "git blame 조회", "파일의 라인별 최종 수정 커밋.", { projectId: z.string(), path: z.string(), ref: z.string().optional() }, async (a) => {
    const qs = new URLSearchParams({ path: String(a.path), ...(a.ref ? { ref: String(a.ref) } : {}) });
    return call(`/api/projects/${a.projectId}/git/blame?${qs}`);
  });
  tool("git_show", "git show 조회", "커밋 1건의 메타데이터.", { projectId: z.string(), sha: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/show/${a.sha}`),
  );

  // git_diff는 응답이 JSON이 아니라 순수 텍스트(unified diff)라 다른
  // 도구처럼 JSON.stringify로 감싸지 않고 원문 그대로 반환한다.
  server.registerTool(
    "git_diff",
    { title: "git diff 조회", description: "커밋 1건의 unified diff 원문.", inputSchema: { projectId: z.string(), sha: z.string() } },
    async (a: Record<string, unknown>) => {
      try {
        const diff = await apiCallText(`/api/projects/${a.projectId}/git/diff/${a.sha}`);
        return { content: [{ type: "text" as const, text: diff }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "git_compare",
    {
      title: "git range diff 조회",
      description: "커밋 1건이 아니라 base..head 사이 전체 unified diff 원문 - 코드 리뷰(사후 검토, code_review_*)가 근거하는 조회.",
      inputSchema: { projectId: z.string(), base: z.string(), head: z.string() },
    },
    async (a: Record<string, unknown>) => {
      try {
        const qs = new URLSearchParams({ base: String(a.base), head: String(a.head) });
        const diff = await apiCallText(`/api/projects/${a.projectId}/git/compare?${qs}`);
        return { content: [{ type: "text" as const, text: diff }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
