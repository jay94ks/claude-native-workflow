import { getDb } from "./db.js";

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

export async function removeTeamAdmin(teamId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.teamAdmin.deleteMany({ where: { teamId, userId } });
}

export async function listTeamAdmins(teamId: string): Promise<TeamAdmin[]> {
  const db = getDb();
  const rows = await db.teamAdmin.findMany({ where: { teamId } });
  return rows.map((r: TeamAdmin) => ({ id: r.id, teamId: r.teamId, userId: r.userId }));
}

export async function isTeamAdmin(teamId: string | null, userId: string): Promise<boolean> {
  if (!teamId) return false;
  const db = getDb();
  const row = await db.teamAdmin.findUnique({ where: { teamId_userId: { teamId, userId } } });
  return row !== null;
}

export async function listAdministeredTeamIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.teamAdmin.findMany({ where: { userId } });
  return rows.map((r: { teamId: string }) => r.teamId);
}
