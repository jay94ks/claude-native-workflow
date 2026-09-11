import { getDb } from "./db.js";
import { getInstallConfig } from "./teams.js";
import { isTeamAllowedByActiveScope } from "./teamAdmins.js";
import { addProjectGroupAdmin, isProjectGroupAdmin } from "./projectGroupAdmins.js";

export interface ProjectGroup {
  id: string;
  teamId: string | null;
  name: string;
}

export interface ProjectGroupWithMyAdmin extends ProjectGroup {
  isAdmin: boolean;
}

/** 생성 직후 그 설계자를 자동으로 첫 ProjectGroupAdmin으로 등록한다
 * (createTeam()이 팀 생성자를 TeamAdmin으로 넣는 것과 같은 원칙 -
 * 팀에 속한 그룹이어도 별도로 등록한다, 그 팀의 팀장이 아닐 수도
 * 있으므로). */
export async function createProjectGroup(name: string, teamId: string | undefined, actingUserId: string): Promise<ProjectGroup> {
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
  await addProjectGroupAdmin(row.id, actingUserId);
  return { id: row.id, teamId: row.teamId, name: row.name };
}

/** 그룹 자체를 대상으로 하는 라우트(그룹 CRUD, 그룹 관리자 등록/해제,
 * 그룹 멤버 조회 등)에 건다 - 그 그룹이 속한 팀을 기준으로
 * isTeamAllowedByActiveScope()에 위임한다(팀 없는 그룹은 unrestricted
 * 스코프만 허용 - team 스코프 키가 일치할 teamId 자체가 없으므로
 * 자동으로 거부됨). */
export async function isGroupAllowedByActiveScope(groupId: string): Promise<boolean> {
  const db = getDb();
  const group = await db.projectGroup.findUnique({ where: { id: groupId } });
  if (!group) return false;
  return isTeamAllowedByActiveScope(group.teamId ?? "");
}

/** 각 그룹에 대한 호출자의 그룹 관리자 여부(isAdmin)를 함께 계산해서
 * 얹는다(listTeams()와 같은 원칙 - isProjectGroupAdmin()이 이미
 * admin-aware라 최고 관리자는 자동으로 전부 true). */
export async function listProjectGroups(teamId: string | undefined, viewerId: string): Promise<ProjectGroupWithMyAdmin[]> {
  const db = getDb();
  const rows = await db.projectGroup.findMany({
    where: teamId ? { teamId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  const out: ProjectGroupWithMyAdmin[] = [];
  for (const r of rows as { id: string; teamId: string | null; name: string }[]) {
    out.push({ id: r.id, teamId: r.teamId, name: r.name, isAdmin: await isProjectGroupAdmin(r.id, viewerId) });
  }
  return out;
}

export async function getProjectGroupById(groupId: string): Promise<ProjectGroup | null> {
  const db = getDb();
  const row = await db.projectGroup.findUnique({ where: { id: groupId } });
  return row ? { id: row.id, teamId: row.teamId, name: row.name } : null;
}

/** name/teamId 둘 다 선택 - 준 필드만 갱신한다. teamId 재소속 시
 * 팀 존재/teamsEnabled 검증은 createProjectGroup()과 동일(중복 로직
 * 최소화보다 두 함수가 서로 다른 시점에 독립적으로 실패해야 한다는
 * 점이 더 중요해 그대로 반복). 목적지 팀 관리자 동의 여부 같은 권한
 * 판단은 이 함수가 아니라 라우트가 한다(이 저장소의 기존 관례). */
export async function updateProjectGroup(
  groupId: string,
  input: { name?: string; teamId?: string | null },
): Promise<ProjectGroup> {
  const db = getDb();
  if (input.teamId) {
    const { teamsEnabled } = await getInstallConfig();
    if (!teamsEnabled) throw new Error("팀 단위 사용이 꺼져 있어 teamId를 지정할 수 없습니다");
    const team = await db.team.findUnique({ where: { id: input.teamId } });
    if (!team) throw new Error(`팀을 찾을 수 없습니다: ${input.teamId}`);
  }
  const row = await db.projectGroup.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
    },
  });
  return { id: row.id, teamId: row.teamId, name: row.name };
}

/** 소속 Project가 하나라도 있으면 거부 - 고아 프로젝트를 만들지
 * 않기 위해(이 라운드는 프로젝트 이관 기능을 안 만듦). */
export async function deleteProjectGroup(groupId: string): Promise<void> {
  const db = getDb();
  const projectCount = await db.project.count({ where: { projectGroupId: groupId } });
  if (projectCount > 0) {
    throw new Error(`이 그룹에 아직 프로젝트가 ${projectCount}개 있습니다 - 먼저 비운 뒤 삭제하세요`);
  }
  await db.projectGroup.delete({ where: { id: groupId } });
}

export interface GroupMemberRow {
  projectId: string;
  projectName: string;
  userId: string;
  role: string;
}

/** 그 그룹 산하 모든 프로젝트의 Member를 조인해 펼친다 - 그룹 관리자
 * 전용 조회(요구사항 2). 중복 제거 안 함(listMembersForTeam()과 같은
 * 원칙). */
export async function listMembersForGroup(groupId: string): Promise<GroupMemberRow[]> {
  const db = getDb();
  const projects = await db.project.findMany({
    where: { projectGroupId: groupId },
    select: { id: true, name: true, members: { select: { userId: true, role: true } } },
  });
  const rows: GroupMemberRow[] = [];
  for (const project of projects) {
    for (const member of project.members) {
      rows.push({ projectId: project.id, projectName: project.name, userId: member.userId, role: member.role });
    }
  }
  return rows;
}
