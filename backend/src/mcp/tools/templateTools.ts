// 배치 2l(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 템플릿
// (CLAUDE.md, SKILL.md 등). mcp/server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerTemplateTools(tool: ToolRegistrar): void {
  tool(
    "template_get",
    "템플릿 조회",
    "CLAUDE.md/SKILL.md 등 템플릿 파일의 실제 적용될 내용을 조회한다(project → group → team → 전역 기본값 순).",
    { filename: z.string(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename), ...(a.projectId ? { projectId: String(a.projectId) } : {}) });
      return call(`/api/templates?${qs}`);
    },
  );
  tool(
    "template_set",
    "템플릿 override 설정",
    "특정 스코프(팀/그룹/프로젝트, 생략하면 전역 기본값)에 템플릿 내용을 설정한다.",
    { filename: z.string(), content: z.string(), teamId: z.string().optional(), projectGroupId: z.string().optional(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename) });
      return call(`/api/templates?${qs}`, {
        method: "PUT",
        body: JSON.stringify({ content: a.content, teamId: a.teamId, projectGroupId: a.projectGroupId, projectId: a.projectId }),
      });
    },
  );
  tool(
    "template_deploy",
    "템플릿 배포",
    "CLAUDE.md/SKILL.md를 해석해 이 프로젝트의 내부 Gitea 작업 저장소에 커밋한다 - link-external 프로젝트라면 이것만으로 GitHub/GitLab에 반영되지 않으니 이어서 git_publish까지 호출해야 한다.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/templates/deploy`, { method: "POST" }),
  );
  tool(
    "template_revisions",
    "템플릿 변경 이력 조회",
    "특정 스코프(팀/그룹/프로젝트, 생략하면 전역 기본값)에서 그 템플릿 파일이 덮어써지기 전 과거 내용들을 시간순으로 조회한다 - 실수로 잘못된 내용을 덮어썼을 때 이전 버전을 확인하고 template_set으로 그 content를 다시 넘겨 복원하는 데 쓴다. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    {
      filename: z.string(),
      teamId: z.string().optional(),
      projectGroupId: z.string().optional(),
      projectId: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        filename: String(a.filename),
        ...(a.teamId ? { teamId: String(a.teamId) } : {}),
        ...(a.projectGroupId ? { projectGroupId: String(a.projectGroupId) } : {}),
        ...(a.projectId ? { projectId: String(a.projectId) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/templates/revisions${suffix}?${qs}`);
    },
  );
}
