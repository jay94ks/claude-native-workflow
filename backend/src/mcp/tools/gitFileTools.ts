// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git 파일
// 조회/직접 쓰기(tree/cat/read/grep/cat_batch/put/delete - 스테이징을
// 거치지 않는 단일 커밋). mcp/server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { z } from "zod";
import { call, resolveFileContent, type ToolRegistrar } from "../shared.js";

export function registerGitFileTools(tool: ToolRegistrar): void {
  tool(
    "git_tree",
    "git 디렉터리 조회",
    "저장소의 디렉터리 목록을 조회한다(path 생략하면 루트). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    {
      projectId: z.string(),
      path: z.string().optional(),
      ref: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        path: String(a.path ?? ""),
        ...(a.ref ? { ref: String(a.ref) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects/${a.projectId}/git/tree${suffix}?${qs}`);
    },
  );
  tool(
    "git_cat",
    "git 파일 조회",
    "저장소의 파일 1건 내용을 조회한다.",
    { projectId: z.string(), path: z.string(), ref: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path), ...(a.ref ? { ref: String(a.ref) } : {}) });
      return call(`/api/projects/${a.projectId}/git/file?${qs}`);
    },
  );
  tool(
    "git_read",
    "git 파일 부분 읽기",
    "소스 코드 파일을 줄 단위로 부분 읽기(큰 파일을 전체로 안 올리고 필요한 범위만) - 둘 다 생략하면 처음 2000줄.",
    { projectId: z.string(), path: z.string(), ref: z.string().optional(), offset: z.number().int().optional(), limit: z.number().int().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path) });
      if (a.ref) qs.set("ref", String(a.ref));
      if (a.offset !== undefined) qs.set("offset", String(a.offset));
      if (a.limit !== undefined) qs.set("limit", String(a.limit));
      return call(`/api/projects/${a.projectId}/git/file/lines?${qs}`);
    },
  );
  tool(
    "git_grep",
    "git 파일 검색",
    "소스 코드 파일을 정규식(POSIX ERE)으로 줄 단위 검색 - 매치된 줄 번호+텍스트 배열, 패턴이 잘못되면 에러.",
    {
      projectId: z.string(),
      path: z.string(),
      pattern: z.string(),
      ref: z.string().optional(),
      caseInsensitive: z.boolean().optional(),
      context: z.number().int().optional(),
    },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path), q: String(a.pattern) });
      if (a.ref) qs.set("ref", String(a.ref));
      if (a.caseInsensitive) qs.set("caseInsensitive", "true");
      if (a.context !== undefined) qs.set("context", String(a.context));
      return call(`/api/projects/${a.projectId}/git/file/grep?${qs}`);
    },
  );
  tool(
    "git_put",
    "git 파일 저장",
    "저장소에 파일을 커밋한다(있으면 갱신, 없으면 생성). content 또는 localFile(이 MCP 서버가 도는 머신의 로컬 경로 - 디스크에서 직접 읽어 전송) 중 정확히 하나를 지정한다. 한글처럼 밀도 높은 비-ASCII 텍스트가 많은 파일은 localFile을 쓰면 모델이 내용을 다시 생성할 필요가 없어 더 안전하다(PN-46EE061F).",
    { projectId: z.string(), path: z.string(), content: z.string().optional(), localFile: z.string().optional(), message: z.string().optional() },
    async (a) => {
      const content = resolveFileContent(a.content, a.localFile);
      const qs = new URLSearchParams({ path: String(a.path) });
      return call(`/api/projects/${a.projectId}/git/file?${qs}`, {
        method: "PUT",
        body: JSON.stringify({ content, message: a.message }),
      });
    },
  );
  tool(
    "git_delete",
    "git 파일 삭제",
    "저장소에서 파일을 삭제한다(커밋으로 기록됨).",
    { projectId: z.string(), path: z.string(), message: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path) });
      return call(`/api/projects/${a.projectId}/git/file?${qs}`, {
        method: "DELETE",
        body: JSON.stringify({ message: a.message }),
      });
    },
  );
  tool(
    "git_cat_batch",
    "git 파일 여러 개 한번에 조회",
    "여러 파일을 한 번에 조회한다.",
    { projectId: z.string(), paths: z.array(z.string()) },
    async (a) => {
      const qs = new URLSearchParams({ paths: (a.paths as string[]).join(",") });
      return call(`/api/projects/${a.projectId}/git/files?${qs}`);
    },
  );
}
