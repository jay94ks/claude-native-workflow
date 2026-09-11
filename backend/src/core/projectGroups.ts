import { getDb } from "./db.js";
import { getInstallConfig } from "./teams.js";
import { isTeamAllowedByActiveScope } from "./teamAdmins.js";

export interface ProjectGroup {
  id: string;
  teamId: string | null;
  name: string;
}

export async function createProjectGroup(name: string, teamId?: string): Promise<ProjectGroup> {
  const db = getDb();
  // 빈 문자열은 "안 넘김"과 같은 뜻으로 취급한다 - 그렇지 않으면 아래
  // truthy 체크(`if (teamId)`)를 다 통과해버려서 검증 없이
  // Prisma에 빈 문자열이 그대로 들어가 원본 FK 제약 에러가 새어나간다
  // (실측 중 발견 - 빈 문자열 teamId를 넘겼을 때 "찾을 수
  // 없습니다" 같은 명확한 에러가 아니라 Prisma 내부 에러 메시지가
  // 그대로 노출됐다).
  teamId = teamId || undefined;
  const { teamsEnabled } = await getInstallConfig();
  if (teamId && !teamsEnabled) {
    throw new Error("팀 단위 사용이 꺼져 있어 teamId를 지정할 수 없습니다");
  }
  if (teamId) {
    const team = await db.team.findUnique({ where: { id: teamId } });
    if (!team) throw new Error(`팀을 찾을 수 없습니다: ${teamId}`);
  }
  const row = await db.projectGroup.create({ data: { name, teamId: teamId ?? null } });
  return { id: row.id, teamId: row.teamId, name: row.name };
}

/** 그룹 자체를 대상으로 하는 라우트(그룹 스코프 DocType 관리 등)에
 * 건다 - 그 그룹이 속한 팀을 기준으로 isTeamAllowedByActiveScope()에
 * 위임한다(팀 없는 그룹은 unrestricted 스코프만 허용 - team 스코프
 * 키가 일치할 teamId 자체가 없으므로 자동으로 거부됨). */
export async function isGroupAllowedByActiveScope(groupId: string): Promise<boolean> {
  const db = getDb();
  const group = await db.projectGroup.findUnique({ where: { id: groupId } });
  if (!group) return false;
  return isTeamAllowedByActiveScope(group.teamId ?? "");
}

export async function listProjectGroups(teamId?: string): Promise<ProjectGroup[]> {
  const db = getDb();
  const rows = await db.projectGroup.findMany({
    where: teamId ? { teamId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: { id: string; teamId: string | null; name: string }) => ({
    id: r.id,
    teamId: r.teamId,
    name: r.name,
  }));
}
