import { getDb } from "./db.js";
import { getActiveKeyScope } from "./requestScope.js";

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

/** 활성 API 키 스코프(core/requestScope.ts)가 이 프로젝트에 대한
 * 접근을 허용하는지 확인한다 - "unrestricted"(JWT 로그인/개인 키)는
 * 항상 허용, "project"는 정확히 일치하는 프로젝트만, "team"은 그
 * 프로젝트가 속한 팀이 일치할 때만. getMemberRole()과
 * core/permissions.ts의 resolveEffectivePermission()이 이 함수
 * 하나를 공유해 스코프 판정 로직이 한 곳에만 있게 한다(라우트마다
 * 따로 체크하지 않아도 이 프로젝트를 다루는 모든 권한 판정에 자동으로
 * 적용됨). */
export async function isProjectAllowedByActiveScope(projectId: string): Promise<boolean> {
  const scope = getActiveKeyScope();
  if (scope.type === "unrestricted") return true;
  if (scope.type === "project") return scope.projectId === projectId;
  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { projectGroup: { select: { teamId: true } } },
  });
  return project?.projectGroup.teamId === scope.teamId;
}

export async function getMemberRole(projectId: string, userId: string): Promise<string | null> {
  if (!(await isProjectAllowedByActiveScope(projectId))) return null;
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
