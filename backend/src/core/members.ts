import { getDb } from "./db.js";

const VALID_ROLES = new Set(["owner", "editor", "viewer"]);
const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };

export interface Member {
  id: string;
  projectId: string;
  userId: string;
  role: string;
}

export async function addMember(projectId: string, userId: string, role: string): Promise<Member> {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`알 수 없는 role: ${role} (owner|editor|viewer 중 하나)`);
  }
  const db = getDb();
  const row = await db.member.create({ data: { projectId, userId, role } });
  return { id: row.id, projectId: row.projectId, userId: row.userId, role: row.role };
}

export async function listMembers(projectId: string): Promise<Member[]> {
  const db = getDb();
  const rows = await db.member.findMany({ where: { projectId } });
  return rows.map((r: Member) => ({ id: r.id, projectId: r.projectId, userId: r.userId, role: r.role }));
}

export async function getMemberRole(projectId: string, userId: string): Promise<string | null> {
  const db = getDb();
  const row = await db.member.findUnique({ where: { projectId_userId: { projectId, userId } } });
  return row?.role ?? null;
}

/** API 미들웨어가 쓰는 권한 검사 - 요구 역할 이상인지 확인. 옛 concept
 * tier3의 requireProjectRole()과 같은 랭크 비교 방식(viewer < editor <
 * owner). */
export function roleSatisfies(actualRole: string | null, requiredRole: string): boolean {
  if (!actualRole) return false;
  return (ROLE_RANK[actualRole] ?? -1) >= (ROLE_RANK[requiredRole] ?? Infinity);
}
