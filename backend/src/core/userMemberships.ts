import { getDb } from "./db.js";

// 관리자 화면의 "소속 조회" 다이얼로그 전용 - 이 사용자가 실제로
// 관리 권한/멤버십을 가진 모든 곳(프로젝트 그룹/팀/프로젝트)을 한
// 번에 모은다. core/permissions.ts의 access-overview(DocAccessOverride,
// 문서/문서타입별 세부 제한)와는 완전히 다른 개념이라 별도 파일로
// 분리했다 - 이쪽은 "어디에 속해 있는가", 그쪽은 "어디서 세부적으로
// 막혀 있는가".

export interface UserProjectMembership {
  projectId: string;
  projectName: string;
  role: string;
  isSoleOwner: boolean;
}
export interface UserTeamMembership {
  teamId: string;
  teamName: string;
  isSoleAdmin: boolean;
}
export interface UserProjectGroupMembership {
  groupId: string;
  groupName: string;
  teamId: string | null;
  isSoleAdmin: boolean;
  // 그룹 자체엔 명시적 관리자가 이 사용자 하나뿐이어도, 그 그룹이
  // 속한 팀에 팀장이 있으면 팀장이 isProjectGroupAdmin() 상속으로
  // 계속 관리하므로 방출해도 "무관리자"가 되지 않는다.
  coveredByTeamAdmin: boolean;
}
export interface UserMemberships {
  projects: UserProjectMembership[];
  teams: UserTeamMembership[];
  projectGroups: UserProjectGroupMembership[];
}

export async function listUserMemberships(userId: string): Promise<UserMemberships> {
  const db = getDb();

  const memberRows = await db.member.findMany({
    where: { userId },
    include: { project: { select: { name: true } } },
  });
  const projects: UserProjectMembership[] = [];
  for (const row of memberRows as Array<{ projectId: string; role: string; project: { name: string } }>) {
    let isSoleOwner = false;
    if (row.role === "owner") {
      const ownerCount = await db.member.count({ where: { projectId: row.projectId, role: "owner" } });
      isSoleOwner = ownerCount <= 1;
    }
    projects.push({ projectId: row.projectId, projectName: row.project.name, role: row.role, isSoleOwner });
  }

  const teamAdminRows = await db.teamAdmin.findMany({
    where: { userId },
    include: { team: { select: { name: true } } },
  });
  const teams: UserTeamMembership[] = [];
  for (const row of teamAdminRows as Array<{ teamId: string; team: { name: string } }>) {
    const adminCount = await db.teamAdmin.count({ where: { teamId: row.teamId } });
    teams.push({ teamId: row.teamId, teamName: row.team.name, isSoleAdmin: adminCount <= 1 });
  }

  const groupAdminRows = await db.projectGroupAdmin.findMany({
    where: { userId },
    include: { projectGroup: { select: { name: true, teamId: true } } },
  });
  const projectGroups: UserProjectGroupMembership[] = [];
  for (const row of groupAdminRows as Array<{ projectGroupId: string; projectGroup: { name: string; teamId: string | null } }>) {
    const adminCount = await db.projectGroupAdmin.count({ where: { projectGroupId: row.projectGroupId } });
    const teamAdminCount = row.projectGroup.teamId
      ? await db.teamAdmin.count({ where: { teamId: row.projectGroup.teamId } })
      : 0;
    projectGroups.push({
      groupId: row.projectGroupId,
      groupName: row.projectGroup.name,
      teamId: row.projectGroup.teamId,
      isSoleAdmin: adminCount <= 1,
      coveredByTeamAdmin: teamAdminCount > 0,
    });
  }

  return { projects, teams, projectGroups };
}
