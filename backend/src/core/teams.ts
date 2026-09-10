import { getDb } from "./db.js";

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

export async function createTeam(name: string): Promise<Team> {
  const { teamsEnabled } = await getInstallConfig();
  if (!teamsEnabled) {
    throw new Error("팀 단위 사용이 이 설치에서 꺼져 있습니다(InstallConfig.teamsEnabled=false)");
  }
  const db = getDb();
  const row = await db.team.create({ data: { name } });
  return { id: row.id, name: row.name, enabled: row.enabled };
}

export async function listTeams(): Promise<Team[]> {
  const db = getDb();
  const rows = await db.team.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r: { id: string; name: string; enabled: boolean }) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
  }));
}
