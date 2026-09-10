import { getDb } from "./db.js";
import { getInstallConfig } from "./institutions.js";

export interface ProjectGroup {
  id: string;
  institutionId: string | null;
  name: string;
}

export async function createProjectGroup(name: string, institutionId?: string): Promise<ProjectGroup> {
  const db = getDb();
  const { institutionsEnabled } = await getInstallConfig();
  if (institutionId && !institutionsEnabled) {
    throw new Error("기관 단위 사용이 꺼져 있어 institutionId를 지정할 수 없습니다");
  }
  if (institutionId) {
    const inst = await db.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw new Error(`institution을 찾을 수 없습니다: ${institutionId}`);
  }
  const row = await db.projectGroup.create({ data: { name, institutionId: institutionId ?? null } });
  return { id: row.id, institutionId: row.institutionId, name: row.name };
}

export async function listProjectGroups(institutionId?: string): Promise<ProjectGroup[]> {
  const db = getDb();
  const rows = await db.projectGroup.findMany({
    where: institutionId ? { institutionId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: { id: string; institutionId: string | null; name: string }) => ({
    id: r.id,
    institutionId: r.institutionId,
    name: r.name,
  }));
}
