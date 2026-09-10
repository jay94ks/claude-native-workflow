import { getDb } from "./db.js";
import { getInstallConfig } from "./teams.js";

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
