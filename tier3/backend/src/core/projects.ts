import { getDb } from "./db.js";

// SP-00002 3~4절: 프로젝트 단위 테넌시, role(owner/editor/viewer)은
// Prisma enum이 아니라 평문 문자열이라(schema.*.prisma 참고) 여기서
// 유효한 값 자체를 상수로 못박는다.

export const ROLES = ["viewer", "editor", "owner"] as const;
export type Role = (typeof ROLES)[number];
const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: string, min: Role): boolean {
  return (ROLE_RANK[role as Role] ?? 0) >= ROLE_RANK[min];
}

export interface CreateProjectInput {
  name: string;
  gitRepoUrl: string;
}

export async function createProject(ownerId: string, input: CreateProjectInput) {
  const db = getDb();
  const project = await db.project.create({
    data: { name: input.name, gitRepoUrl: input.gitRepoUrl },
  });
  await db.projectMember.create({
    data: { projectId: project.id, userId: ownerId, role: "owner" },
  });
  return project;
}

export async function listMyProjects(userId: string) {
  const db = getDb();
  const memberships = await db.projectMember.findMany({
    where: { userId },
    include: { project: true },
  });
  return memberships.map((m) => ({ ...m.project, role: m.role }));
}

export async function getMembership(projectId: string, userId: string) {
  const db = getDb();
  return db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
}

export async function addMember(projectId: string, userId: string, role: Role) {
  const db = getDb();
  return db.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role },
    update: { role },
  });
}

export async function updateMemberRole(projectId: string, userId: string, role: Role) {
  const db = getDb();
  return db.projectMember.update({
    where: { projectId_userId: { projectId, userId } },
    data: { role },
  });
}

export async function removeMember(projectId: string, userId: string) {
  const db = getDb();
  await db.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
}

export async function listMembers(projectId: string) {
  const db = getDb();
  const rows = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, username: true, email: true } } },
  });
  return rows.map((r) => ({ ...r.user, role: r.role, joined_at: r.joinedAt }));
}

export async function findUserByIdentifier(identifier: string) {
  const db = getDb();
  return db.user.findFirst({ where: { OR: [{ id: identifier }, { email: identifier }, { username: identifier }] } });
}
