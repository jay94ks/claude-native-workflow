import { getDb } from "./db.js";
import { addTeamAdmin, isTeamAdmin } from "./teamAdmins.js";

// InstallConfig는 싱글턴 - id를 항상 "singleton"으로 고정해서 upsert.
const INSTALL_CONFIG_ID = "singleton";

export async function getInstallConfig(): Promise<{ teamsEnabled: boolean }> {
  const db = getDb();
  const row = await db.installConfig.upsert({
    where: { id: INSTALL_CONFIG_ID },
    update: {},
    create: { id: INSTALL_CONFIG_ID, teamsEnabled: true },
  });
  return { teamsEnabled: row.teamsEnabled };
}

export async function setTeamsEnabled(enabled: boolean): Promise<void> {
  const db = getDb();
  await db.installConfig.upsert({
    where: { id: INSTALL_CONFIG_ID },
    update: { teamsEnabled: enabled },
    create: { id: INSTALL_CONFIG_ID, teamsEnabled: enabled },
  });
}

export interface Team {
  id: string;
  name: string;
  enabled: boolean;
}

export interface TeamWithMyAdmin extends Team {
  isAdmin: boolean;
}

/** 생성 직후 그 설계자를 자동으로 첫 TeamAdmin으로 등록한다
 * (addMember(project.id, req.userId!, "owner")가 프로젝트 생성자를
 * owner로 넣는 것과 같은 원칙) - 안 그러면 "팀 관리자만 관리 가능"으로
 * 잠근 뒤 아무도 막 만든 팀을 관리할 수 없는 상태가 된다. */
export async function createTeam(name: string, actingUserId: string): Promise<Team> {
  const { teamsEnabled } = await getInstallConfig();
  if (!teamsEnabled) {
    throw new Error("팀 단위 사용이 이 설치에서 꺼져 있습니다(InstallConfig.teamsEnabled=false)");
  }
  const db = getDb();
  const row = await db.team.create({ data: { name } });
  await addTeamAdmin(row.id, actingUserId);
  return { id: row.id, name: row.name, enabled: row.enabled };
}

/** 각 팀에 대한 호출자의 팀장 여부(isAdmin)를 함께 계산해서 얹는다 -
 * 프런트가 CUD 버튼을 그 값 하나로 v-if할 수 있게(isTeamAdmin()이 이미
 * admin-aware라 최고 관리자는 자동으로 전부 true). */
export async function listTeams(viewerId: string): Promise<TeamWithMyAdmin[]> {
  const db = getDb();
  const rows = await db.team.findMany({ orderBy: { createdAt: "desc" } });
  const out: TeamWithMyAdmin[] = [];
  for (const r of rows as { id: string; name: string; enabled: boolean }[]) {
    out.push({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      isAdmin: await isTeamAdmin(r.id, viewerId),
    });
  }
  return out;
}

export async function updateTeam(teamId: string, input: { name?: string; enabled?: boolean }): Promise<Team> {
  const db = getDb();
  const row = await db.team.update({
    where: { id: teamId },
    data: { name: input.name, enabled: input.enabled },
  });
  return { id: row.id, name: row.name, enabled: row.enabled };
}

/** 소속 ProjectGroup이 하나라도 있으면 거부 - 고아 그룹을 만들지
 * 않기 위해(이 라운드는 그룹 이관 기능을 안 만듦, 폴더 삭제 등에서
 * 이미 쓰는 "비어있지 않으면 명확한 에러로 거부" 원칙과 동일). */
export async function deleteTeam(teamId: string): Promise<void> {
  const db = getDb();
  const groupCount = await db.projectGroup.count({ where: { teamId } });
  if (groupCount > 0) {
    throw new Error(`이 팀에 아직 프로젝트 그룹이 ${groupCount}개 있습니다 - 먼저 비운 뒤 삭제하세요`);
  }
  await db.team.delete({ where: { id: teamId } });
}

export interface TeamMemberRow {
  projectId: string;
  projectName: string;
  groupId: string;
  groupName: string;
  userId: string;
  role: string;
}

/** 그 팀 산하 모든 그룹의 모든 프로젝트의 Member를 조인해 펼친다 -
 * 팀 관리자 전용 조회(요구사항 3). 중복 제거 안 함 - 한 설계자가
 * 여러 프로젝트에 걸쳐 있으면 그만큼 여러 행으로, 사실 그대로
 * 보여준다. */
export async function listMembersForTeam(teamId: string): Promise<TeamMemberRow[]> {
  const db = getDb();
  const groups = await db.projectGroup.findMany({
    where: { teamId },
    select: {
      id: true,
      name: true,
      projects: {
        select: { id: true, name: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  const rows: TeamMemberRow[] = [];
  for (const group of groups) {
    for (const project of group.projects) {
      for (const member of project.members) {
        rows.push({
          projectId: project.id,
          projectName: project.name,
          groupId: group.id,
          groupName: group.name,
          userId: member.userId,
          role: member.role,
        });
      }
    }
  }
  return rows;
}
