import { getDb } from "./db.js";

// InstallConfig는 싱글턴 - id를 항상 "singleton"으로 고정해서 upsert.
const INSTALL_CONFIG_ID = "singleton";

export async function getInstallConfig(): Promise<{ institutionsEnabled: boolean }> {
  const db = getDb();
  const row = await db.installConfig.upsert({
    where: { id: INSTALL_CONFIG_ID },
    update: {},
    create: { id: INSTALL_CONFIG_ID, institutionsEnabled: true },
  });
  return { institutionsEnabled: row.institutionsEnabled };
}

export async function setInstitutionsEnabled(enabled: boolean): Promise<void> {
  const db = getDb();
  await db.installConfig.upsert({
    where: { id: INSTALL_CONFIG_ID },
    update: { institutionsEnabled: enabled },
    create: { id: INSTALL_CONFIG_ID, institutionsEnabled: enabled },
  });
}

export interface Institution {
  id: string;
  name: string;
  enabled: boolean;
}

export async function createInstitution(name: string): Promise<Institution> {
  const { institutionsEnabled } = await getInstallConfig();
  if (!institutionsEnabled) {
    throw new Error("기관 단위 사용이 이 설치에서 꺼져 있습니다(InstallConfig.institutionsEnabled=false)");
  }
  const db = getDb();
  const row = await db.institution.create({ data: { name } });
  return { id: row.id, name: row.name, enabled: row.enabled };
}

export async function listInstitutions(): Promise<Institution[]> {
  const db = getDb();
  const rows = await db.institution.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r: { id: string; name: string; enabled: boolean }) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
  }));
}
