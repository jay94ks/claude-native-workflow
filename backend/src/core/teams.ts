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
  isPublic: boolean;
}

export interface TeamWithMyAdmin extends Team {
  isAdmin: boolean;
}

/** 생성 직후 그 설계자를 자동으로 첫 TeamAdmin으로 등록한다
 * (addMember(project.id, req.userId!, "owner")가 프로젝트 생성자를
 * owner로 넣는 것과 같은 원칙) - 안 그러면 "팀 관리자만 관리 가능"으로
 * 잠근 뒤 아무도 막 만든 팀을 관리할 수 없는 상태가 된다. */
export async function createTeam(name: string, actingUserId: string, isPublic = false): Promise<Team> {
  const { teamsEnabled } = await getInstallConfig();
  if (!teamsEnabled) {
    throw new Error("팀 단위 사용이 이 설치에서 꺼져 있습니다(InstallConfig.teamsEnabled=false)");
  }
  const db = getDb();
  const row = await db.team.create({ data: { name, isPublic } });
  await addTeamAdmin(row.id, actingUserId);
  return { id: row.id, name: row.name, enabled: row.enabled, isPublic: row.isPublic };
}

/** 이 팀 산하(팀→그룹→프로젝트) 어딘가에 실제 Member로 소속돼 있는가 -
 * 새 모델 없이 기존 Member 테이블만으로 "이 팀에 대한 읽기 권한"을
 * 판단한다(설계자 확정 - 그룹 산하 프로젝트 중 하나라도 멤버면 그
 * 팀/그룹에 읽기 권한이 있다고 간주). */
export async function hasProjectMembershipInTeam(teamId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const row = await db.member.findFirst({ where: { userId, project: { projectGroup: { teamId } } } });
  return row !== null;
}

/** 이 팀을 목록/조회에서 볼 수 있는가 - 공개 설정, 팀장(admin, 최고
 * 관리자 우회 포함), 산하 프로젝트 멤버십 중 하나라도 만족하면 true.
 * 기본은 비공개(설계자 확정 - 새로 만드는 팀/그룹/프로젝트부터 기본값
 * "비공개", 이 테스트 환경에선 기존 데이터 마이그레이션은 신경 쓰지
 * 않기로 함). */
export async function canSeeTeam(team: { id: string; isPublic: boolean }, userId: string): Promise<boolean> {
  if (team.isPublic) return true;
  if (await isTeamAdmin(team.id, userId)) return true;
  return hasProjectMembershipInTeam(team.id, userId);
}

/** 각 팀에 대한 호출자의 팀장 여부(isAdmin)를 함께 계산해서 얹는다 -
 * 프런트가 CUD 버튼을 그 값 하나로 v-if할 수 있게(isTeamAdmin()이 이미
 * admin-aware라 최고 관리자는 자동으로 전부 true). 권한이 없거나
 * 소속되지 않은 팀은 canSeeTeam()으로 걸러 목록 자체에서 뺀다. */
export async function listTeams(viewerId: string): Promise<TeamWithMyAdmin[]> {
  const db = getDb();
  const rows = await db.team.findMany({ orderBy: { createdAt: "desc" } });
  const out: TeamWithMyAdmin[] = [];
  for (const r of rows as { id: string; name: string; enabled: boolean; isPublic: boolean }[]) {
    const isAdmin = await isTeamAdmin(r.id, viewerId);
    if (!r.isPublic && !isAdmin && !(await hasProjectMembershipInTeam(r.id, viewerId))) continue;
    out.push({ id: r.id, name: r.name, enabled: r.enabled, isPublic: r.isPublic, isAdmin });
  }
  return out;
}

export async function updateTeam(
  teamId: string,
  input: { name?: string; enabled?: boolean; isPublic?: boolean },
): Promise<Team> {
  const db = getDb();
  const row = await db.team.update({
    where: { id: teamId },
    data: { name: input.name, enabled: input.enabled, isPublic: input.isPublic },
  });
  return { id: row.id, name: row.name, enabled: row.enabled, isPublic: row.isPublic };
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
