// 배치 2f(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 팀/그룹/프로젝트/멤버. mcp/server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerOrgTools(tool: ToolRegistrar): void {
  tool(
    "team_create",
    "팀 생성",
    "새 팀을 만든다(기본 비공개 - 소속되지 않은 설계자에겐 목록에 안 보임).",
    { name: z.string(), isPublic: z.boolean().optional() },
    async (a) => call("/api/teams", { method: "POST", body: JSON.stringify(a) }),
  );
  tool(
    "team_list",
    "팀 목록",
    "전체 팀 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call("/api/teams");
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/teams/page?${qs}`);
    },
  );
  tool("team_admin_add", "팀장 등록", "그 팀의 팀장으로 사용자를 등록한다(숨겨진 프로젝트를 보고 해제할 수 있게 됨).", { teamId: z.string(), userId: z.string() }, async (a) =>
    call(`/api/teams/${a.teamId}/admins`, { method: "POST", body: JSON.stringify({ userId: a.userId }) }),
  );
  tool("team_admin_remove", "팀장 해제", "그 팀의 팀장에서 사용자를 제외한다.", { teamId: z.string(), userId: z.string() }, async (a) =>
    call(`/api/teams/${a.teamId}/admins/${a.userId}`, { method: "DELETE" }),
  );
  tool(
    "team_admin_list",
    "팀장 목록",
    "그 팀의 팀장 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { teamId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/teams/${a.teamId}/admins`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/teams/${a.teamId}/admins/page?${qs}`);
    },
  );
  tool(
    "team_update",
    "팀 수정",
    "팀 이름/활성 여부/공개 여부를 수정한다 - 그 팀의 관리자만 가능.",
    { teamId: z.string(), name: z.string().optional(), enabled: z.boolean().optional(), isPublic: z.boolean().optional() },
    async (a) =>
      call(`/api/teams/${a.teamId}`, {
        method: "PUT",
        body: JSON.stringify({ name: a.name, enabled: a.enabled, isPublic: a.isPublic }),
      }),
  );
  tool(
    "team_delete",
    "팀 삭제",
    "팀을 삭제한다 - 소속 프로젝트 그룹이 하나라도 있으면 거부됨, 그 팀의 관리자만 가능.",
    { teamId: z.string() },
    async (a) => call(`/api/teams/${a.teamId}`, { method: "DELETE" }),
  );
  tool(
    "team_members",
    "팀 멤버 조회",
    "그 팀 산하 모든 프로젝트 그룹·프로젝트의 멤버를 모아 보여준다 - 그 팀의 관리자만 가능(보안 요구사항). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { teamId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/teams/${a.teamId}/members`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/teams/${a.teamId}/members/page?${qs}`);
    },
  );
  tool(
    "group_create",
    "프로젝트 그룹 생성",
    "새 프로젝트 그룹을 만든다(기본 비공개 - 소속되지 않은 설계자에겐 목록에 안 보임).",
    { name: z.string(), teamId: z.string().optional(), isPublic: z.boolean().optional() },
    async (a) => call("/api/project-groups", { method: "POST", body: JSON.stringify(a) }),
  );
  tool(
    "group_list",
    "프로젝트 그룹 목록",
    "프로젝트 그룹 목록(teamId로 필터 가능). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { teamId: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.teamId ? { teamId: String(a.teamId) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/project-groups${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool(
    "group_update",
    "프로젝트 그룹 수정",
    "그룹 이름/공개 여부를 수정하거나 다른 팀으로 재소속한다(name/teamId/isPublic 중 하나 이상) - 이름·공개 여부 수정은 그 그룹의 관리자만, 팀 재소속은 목적지 팀의 팀장도 함께 필요(빈 문자열이면 팀 없음으로 뗌).",
    { groupId: z.string(), name: z.string().optional(), teamId: z.string().optional(), isPublic: z.boolean().optional() },
    async (a) =>
      call(`/api/project-groups/${a.groupId}`, {
        method: "PUT",
        body: JSON.stringify({ name: a.name, teamId: a.teamId, isPublic: a.isPublic }),
      }),
  );
  tool(
    "group_delete",
    "프로젝트 그룹 삭제",
    "그룹을 삭제한다 - 소속 프로젝트가 하나라도 있으면 거부됨, 그 그룹의 관리자만 가능.",
    { groupId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}`, { method: "DELETE" }),
  );
  tool(
    "group_members",
    "프로젝트 그룹 멤버 조회",
    "그 그룹 산하 모든 프로젝트의 멤버를 모아 보여준다 - 그 그룹의 관리자만 가능(보안 요구사항). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { groupId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/project-groups/${a.groupId}/members`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/project-groups/${a.groupId}/members/page?${qs}`);
    },
  );
  tool(
    "group_admin_add",
    "그룹 관리자 등록",
    "그 프로젝트 그룹의 관리자로 사용자를 등록한다.",
    { groupId: z.string(), userId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}/admins`, { method: "POST", body: JSON.stringify({ userId: a.userId }) }),
  );
  tool(
    "group_admin_remove",
    "그룹 관리자 해제",
    "그 프로젝트 그룹의 관리자에서 사용자를 제외한다.",
    { groupId: z.string(), userId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}/admins/${a.userId}`, { method: "DELETE" }),
  );
  tool(
    "group_admin_list",
    "그룹 관리자 목록",
    "그 프로젝트 그룹의 관리자 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { groupId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/project-groups/${a.groupId}/admins`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/project-groups/${a.groupId}/admins/page?${qs}`);
    },
  );
  tool(
    "project_create",
    "프로젝트 생성",
    "새 프로젝트를 만든다(그룹 생략 시 기본 그룹 사용, 기본 비공개 - isPublic이어도 그 그룹에 실제 멤버십이 있는 설계자에게만 보임).",
    { name: z.string(), projectGroupId: z.string().optional(), isPublic: z.boolean().optional() },
    async (a) => call("/api/projects", { method: "POST", body: JSON.stringify(a) }),
  );
  tool(
    "project_list",
    "프로젝트 목록",
    "프로젝트 목록(projectGroupId로 필터 가능). page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectGroupId: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.projectGroupId ? { projectGroupId: String(a.projectGroupId) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool("project_get", "프로젝트 조회", "id로 프로젝트 1건을 조회한다.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}`),
  );
  tool(
    "project_hide",
    "프로젝트 숨김 설정",
    "프로젝트를 숨기거나(hidden=true) 해제한다(hidden=false) - 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 가능.",
    { projectId: z.string(), hidden: z.boolean() },
    async (a) => call(`/api/projects/${a.projectId}/hidden`, { method: "PUT", body: JSON.stringify({ hidden: a.hidden }) }),
  );
  tool(
    "project_public",
    "프로젝트 공개 설정",
    "프로젝트를 공개(isPublic=true) 또는 비공개(isPublic=false)로 바꾼다 - 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 가능. 공개여도 그 그룹에 실제 멤버십이 있는 설계자에게만 보인다.",
    { projectId: z.string(), isPublic: z.boolean() },
    async (a) => call(`/api/projects/${a.projectId}/public`, { method: "PUT", body: JSON.stringify({ isPublic: a.isPublic }) }),
  );
  tool(
    "project_delete",
    "프로젝트 삭제",
    "프로젝트를 완전히 삭제한다(문서/코멘트/칸반/Q&A/연결된 Gitea 저장소까지 전부 - 되돌릴 수 없음, owner 전용).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}`, { method: "DELETE" }),
  );
  tool(
    "member_add",
    "프로젝트 멤버 추가",
    "프로젝트에 사용자를 role과 함께 추가한다.",
    { projectId: z.string(), userId: z.string(), role: z.enum(["owner", "editor", "viewer"]) },
    async (a) => call(`/api/projects/${a.projectId}/members`, { method: "POST", body: JSON.stringify({ userId: a.userId, role: a.role }) }),
  );
  tool(
    "member_list",
    "프로젝트 멤버 목록",
    "프로젝트 멤버 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/projects/${a.projectId}/members`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/members/page?${qs}`);
    },
  );
  tool(
    "member_set_role",
    "프로젝트 멤버 역할 변경",
    "프로젝트 멤버의 role을 바꾼다(owner|editor|viewer).",
    { projectId: z.string(), userId: z.string(), role: z.enum(["owner", "editor", "viewer"]) },
    async (a) => call(`/api/projects/${a.projectId}/members/${a.userId}`, { method: "PUT", body: JSON.stringify({ role: a.role }) }),
  );
  tool(
    "member_remove",
    "프로젝트 멤버 제거",
    "프로젝트에서 멤버를 제거한다.",
    { projectId: z.string(), userId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/members/${a.userId}`, { method: "DELETE" }),
  );
}
