// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git
// 스테이징 워크플로우(add/rm/add_bulk/rm_bulk/status/restore/commit).
// mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { z } from "zod";
import { call, resolveFileContent, type ToolRegistrar } from "../shared.js";

export function registerGitStagingTools(tool: ToolRegistrar): void {
  tool(
    "git_add",
    "git 파일 변경 스테이징",
    "파일 변경을 스테이징한다(git add - 아직 커밋 안 됨). content 또는 localFile(이 MCP 서버가 도는 머신의 로컬 경로 - 디스크에서 직접 읽어 전송) 중 정확히 하나를 지정한다. 한글처럼 밀도 높은 비-ASCII 텍스트가 많은 파일은 localFile을 쓰면 모델이 내용을 다시 생성할 필요가 없어 더 안전하다(PN-46EE061F).",
    { projectId: z.string(), path: z.string(), content: z.string().optional(), localFile: z.string().optional() },
    async (a) => {
      const content = resolveFileContent(a.content, a.localFile);
      return call(`/api/projects/${a.projectId}/git/staging/add`, {
        method: "POST",
        body: JSON.stringify({ path: a.path, content }),
      });
    },
  );
  tool(
    "git_rm",
    "git 파일 삭제 스테이징",
    "파일 삭제를 스테이징한다(git rm - 아직 커밋 안 됨).",
    { projectId: z.string(), path: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/staging/rm`, {
        method: "POST",
        body: JSON.stringify({ path: a.path }),
      }),
  );
  tool(
    "git_add_bulk",
    "git 파일 변경 일괄 스테이징",
    "여러 파일을 한 번에 스테이징한다(git add 여러 개, 아직 커밋 안 됨) - 파일마다 git_add를 반복 호출하는 것보다 빠르다(항목 수만큼 왕복하지 않음). 각 항목은 content 또는 localFile(이 MCP 서버가 도는 머신의 로컬 경로 - 디스크에서 직접 읽어 전송) 중 정확히 하나를 지정한다. 한글처럼 밀도 높은 비-ASCII 텍스트가 많은 파일은 localFile을 쓰면 모델이 내용을 다시 생성할 필요가 없어 더 안전하다(PN-46EE061F). 항목별 결과({path, ok, error?}) 반환, 일부만 실패해도(localFile을 못 읽는 경우 포함) 나머지는 계속 진행.",
    {
      projectId: z.string(),
      items: z.array(z.object({ path: z.string(), content: z.string().optional(), localFile: z.string().optional() })),
    },
    async (a) => {
      const items = a.items as { path: string; content?: string; localFile?: string }[];
      const resolved: { path: string; content: string }[] = [];
      const localFailures: { path: string; ok: false; error: string }[] = [];
      for (const item of items) {
        try {
          resolved.push({ path: item.path, content: resolveFileContent(item.content, item.localFile) });
        } catch (err) {
          localFailures.push({ path: item.path, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const serverResults =
        resolved.length > 0
          ? await call<unknown[]>(`/api/projects/${a.projectId}/git/staging/add-bulk`, {
              method: "POST",
              body: JSON.stringify({ items: resolved }),
            })
          : [];
      return [...serverResults, ...localFailures];
    },
  );
  tool(
    "git_rm_bulk",
    "git 파일 삭제 일괄 스테이징",
    "여러 파일 삭제를 한 번에 스테이징한다(git rm 여러 개, 아직 커밋 안 됨) - 항목별 결과({path, ok, error?}) 반환.",
    { projectId: z.string(), paths: z.array(z.string()) },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/staging/rm-bulk`, {
        method: "POST",
        body: JSON.stringify({ paths: a.paths }),
      }),
  );
  tool(
    "git_status",
    "git 스테이징 상태 조회",
    "스테이징된 변경 목록과 각 항목의 현재 HEAD 대비 diff를 조회한다.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/staging/status`),
  );
  tool(
    "git_restore",
    "git 스테이징 취소",
    "스테이징을 취소한다(git restore --staged).",
    { projectId: z.string(), path: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/staging/restore`, {
        method: "POST",
        body: JSON.stringify({ path: a.path }),
      }),
  );
  tool(
    "git_commit",
    "git 스테이징 반영(커밋)",
    "스테이징된 변경을 전부 모아 한 번에 커밋한다(드리프트가 있으면 3-way 자동 병합, 진짜 충돌이 있으면 전체 커밋을 거부한다).",
    { projectId: z.string(), message: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/staging/commit`, {
        method: "POST",
        body: JSON.stringify({ message: a.message }),
      }),
  );
}
