import { getDb } from "./db.js";
import { getActiveKeyScope } from "./requestScope.js";
import { isSuperAdmin } from "./auth.js";
import { paginate, type Page } from "./pagination.js";

export interface TeamAdmin {
  id: string;
  teamId: string;
  userId: string;
}

export async function addTeamAdmin(teamId: string, userId: string): Promise<TeamAdmin> {
  const db = getDb();
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error(`팀을 찾을 수 없습니다: ${teamId}`);
  const row = await db.teamAdmin.upsert({
    where: { teamId_userId: { teamId, userId } },
    update: {},
    create: { teamId, userId },
  });
  return { id: row.id, teamId: row.teamId, userId: row.userId };
}

/** 그 팀의 유일한 관리자는 방출할 수 없다(팀장이 0명이 되는 상태를
 * 막음). */
export async function removeTeamAdmin(teamId: string, userId: string): Promise<void> {
  const db = getDb();
  const existing = await db.teamAdmin.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!existing) return; // 원래도 deleteMany라 없으면 조용히 끝났다 - 그대로 유지
  const adminCount = await db.teamAdmin.count({ where: { teamId } });
  if (adminCount <= 1) {
    throw new Error("이 팀의 유일한 관리자는 방출할 수 없습니다 - 먼저 다른 팀장을 지정하세요");
  }
  await db.teamAdmin.deleteMany({ where: { teamId, userId } });
}

export async function listTeamAdmins(teamId: string): Promise<TeamAdmin[]> {
  const db = getDb();
  const rows = await db.teamAdmin.findMany({ where: { teamId } });
  return rows.map((r: TeamAdmin) => ({ id: r.id, teamId: r.teamId, userId: r.userId }));
}

export async function listTeamAdminsPaged(teamId: string, page: number, pageSize: number): Promise<Page<TeamAdmin>> {
  const db = getDb();
  return paginate(
    (args) => db.teamAdmin.findMany({ where: { teamId }, ...args }),
    () => db.teamAdmin.count({ where: { teamId } }),
    page,
    pageSize,
  );
}

export async function isTeamAdmin(teamId: string | null, userId: string): Promise<boolean> {
  if (!teamId) return false;
  // 프로젝트 단위 키는 팀장 권한을 절대 대행하지 않는다(그 키의
  // 스코프가 프로젝트 하나로 좁혀져 있으므로). 팀 단위 키는 자기
  // 팀에 대해서만 - 다른 팀의 teamId를 겨냥하면 실제로 그 사람이
  // 그 팀 팀장이라도 이 키로는 대행 못 함.
  const scope = getActiveKeyScope();
  if (scope.type === "project") return false;
  if (scope.type === "team" && scope.teamId !== teamId) return false;
  if (await isSuperAdmin(userId)) return true;
  const db = getDb();
  const row = await db.teamAdmin.findUnique({ where: { teamId_userId: { teamId, userId } } });
  return row !== null;
}

export async function listAdministeredTeamIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.teamAdmin.findMany({ where: { userId } });
  return rows.map((r: { teamId: string }) => r.teamId);
}

/** 팀 자체를 대상으로 하는 라우트(팀장 등록, 팀/그룹 스코프 DocType
 * 관리 등 - 이 모듈의 isTeamAdmin()과 달리 "실제 팀장인가"가 아니라
 * "이 활성 키가 이 팀을 대상으로 할 수 있는가"만 본다)에 건다 -
 * unrestricted(로그인/개인 키)는 항상 허용, team 스코프 키는 정확히
 * 일치하는 팀만, project 스코프 키는 팀 단위 관리를 절대 대행하지
 * 않는다(그 키의 범위가 프로젝트 하나로 좁혀져 있으므로). */
export function isTeamAllowedByActiveScope(teamId: string): boolean {
  const scope = getActiveKeyScope();
  if (scope.type === "unrestricted") return true;
  if (scope.type === "team") return scope.teamId === teamId;
  return false;
}
