import { getDb } from "./db.js";
import { seedDefaultDocTypes } from "./docTypes.js";

const DEFAULT_GROUP_NAME = "기본";

// Project.projectGroupId는 스키마상 필수다 - 하지만 "기관·그룹 없이도
// 동작해야 한다"(개인 PC/소규모 설치에서 계층 구조를 신경 쓰지 않아도
// 되게)는 요구를 만족시키려고, projectGroupId를 안 넘기면 기관 없는
// 기본 그룹을 찾거나 만들어서 쓴다 - 설계자가 계층을 원하면 나중에
// 언제든 진짜 그룹을 만들어 옮기면 된다.
async function defaultProjectGroupId(): Promise<string> {
  const db = getDb();
  const existing = await db.projectGroup.findFirst({
    where: { institutionId: null, name: DEFAULT_GROUP_NAME },
  });
  if (existing) return existing.id;
  const created = await db.projectGroup.create({ data: { name: DEFAULT_GROUP_NAME } });
  return created.id;
}

export interface Project {
  id: string;
  projectGroupId: string;
  name: string;
}

export async function createProject(name: string, projectGroupId?: string): Promise<Project> {
  const db = getDb();
  const groupId = projectGroupId ?? (await defaultProjectGroupId());
  if (projectGroupId) {
    const group = await db.projectGroup.findUnique({ where: { id: projectGroupId } });
    if (!group) throw new Error(`projectGroup을 찾을 수 없습니다: ${projectGroupId}`);
  }
  const row = await db.project.create({ data: { name, projectGroupId: groupId } });
  await seedDefaultDocTypes(row.id);
  return { id: row.id, projectGroupId: row.projectGroupId, name: row.name };
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getDb();
  const row = await db.project.findUnique({ where: { id } });
  if (!row) return null;
  return { id: row.id, projectGroupId: row.projectGroupId, name: row.name };
}

export async function listProjects(projectGroupId?: string): Promise<Project[]> {
  const db = getDb();
  const rows = await db.project.findMany({
    where: projectGroupId ? { projectGroupId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: { id: string; projectGroupId: string; name: string }) => ({
    id: r.id,
    projectGroupId: r.projectGroupId,
    name: r.name,
  }));
}

export async function assertProjectExists(projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.project.findUnique({ where: { id: projectId } });
  if (!row) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
}
