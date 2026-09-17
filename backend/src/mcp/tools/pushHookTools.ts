// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git push
// 훅 프롬프트 자동화(대기열 방식, Phase 3). mcp/server.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerPushHookTools(tool: ToolRegistrar): void {
  tool(
    "hook_create",
    "push 훅 프롬프트 생성",
    '지정한 브랜치(생략하면 전체)로 push될 때 대기열에 쌓일 프롬프트를 등록한다 - "release/*"처럼 *로 브랜치 그룹을 묶을 수 있다(세그먼트 안에서만, /는 안 넘음).',
    { projectId: z.string(), promptTemplate: z.string(), triggerBranch: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/push-hook-prompts`, {
        method: "POST",
        body: JSON.stringify({ promptTemplate: a.promptTemplate, triggerBranch: a.triggerBranch }),
      }),
  );
  tool(
    "hook_list",
    "push 훅 프롬프트 목록",
    "프로젝트에 등록된 프롬프트 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/projects/${a.projectId}/push-hook-prompts`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/push-hook-prompts/page?${qs}`);
    },
  );
  tool(
    "hook_update",
    "push 훅 프롬프트 수정",
    '트리거 브랜치나 프롬프트 내용을 바꾼다 - triggerBranch에 "release/*"처럼 *를 쓰면 브랜치 그룹을 묶을 수 있고, 빈 문자열을 주면 브랜치 제한을 해제한다(모든 브랜치 매칭), 생략하면 기존 값 유지.',
    { projectId: z.string(), id: z.string(), promptTemplate: z.string().optional(), triggerBranch: z.string().optional() },
    async (a) => {
      const body: Record<string, unknown> = {};
      if (a.promptTemplate !== undefined) body.promptTemplate = a.promptTemplate;
      if (a.triggerBranch !== undefined) body.triggerBranch = a.triggerBranch;
      return call(`/api/projects/${a.projectId}/push-hook-prompts/${a.id}`, { method: "PUT", body: JSON.stringify(body) });
    },
  );
  tool("hook_delete", "push 훅 프롬프트 삭제", "프롬프트를 삭제한다(이후 push에 더는 매칭되지 않음).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-prompts/${a.id}`, { method: "DELETE" }),
  );
  tool(
    "hook_queue_list",
    "push 훅 대기열 조회",
    "이 프로젝트를 열 때 먼저 확인해야 할 대기 중인 push 훅 목록(세션 시작 시 pending으로 확인 권장). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), status: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.status ? { status: String(a.status) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects/${a.projectId}/push-hook-queue${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool("hook_ack", "push 훅 처리 시작", "대기열 항목을 acknowledged로 표시한다(처리를 막 시작했을 때).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-queue/${a.id}/ack`, { method: "POST" }),
  );
  tool("hook_done", "push 훅 처리 완료", "대기열 항목을 done으로 표시한다(처리를 끝냈을 때).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-queue/${a.id}/done`, { method: "POST" }),
  );
}
