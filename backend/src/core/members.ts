import { getDb } from "./db.js";
import { getActiveKeyScope } from "./requestScope.js";
import { isSuperAdmin } from "./auth.js";
import * as gitea from "./gitea.js";

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
  await syncCollaboratorGrant(projectId, userId, role);
  return { id: row.id, projectId: row.projectId, userId: row.userId, role: row.role };
}

export async function updateMemberRole(projectId: string, userId: string, role: string, actingUserId: string): Promise<Member> {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`알 수 없는 role: ${role} (owner|editor|viewer 중 하나)`);
  }
  // 이 라우트는 owner만 호출 가능하므로(requireProjectRole("owner")),
  // 여기 도달한 actingUserId는 항상 현재 owner다 - 자기 자신을 대상으로
  // owner가 아닌 role로 바꾸려는 시도만 막으면 "유일한 owner가 스스로를
  // 내림"과 "owner가 여럿이어도 자기 자신은 못 내림" 둘 다 커버된다
  // (다른 owner가 그 사람을 내리는 건 그대로 허용 - 그건 actingUserId가
  // 다르므로 이 조건에 안 걸림).
  if (userId === actingUserId && role !== "owner") {
    throw new Error("본인의 owner 권한은 스스로 해제할 수 없습니다 - 다른 owner가 변경해야 합니다");
  }
  const db = getDb();
  const row = await db.member.update({ where: { projectId_userId: { projectId, userId } }, data: { role } });
  await syncCollaboratorGrant(projectId, userId, role);
  return { id: row.id, projectId: row.projectId, userId: row.userId, role: row.role };
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.member.delete({ where: { projectId_userId: { projectId, userId } } });
  await syncCollaboratorGrant(projectId, userId, null);
}

export async function listMembers(projectId: string): Promise<Member[]> {
  const db = getDb();
  const rows = await db.member.findMany({ where: { projectId } });
  return rows.map((r: Member) => ({ id: r.id, projectId: r.projectId, userId: r.userId, role: r.role }));
}

const GITEA_PERMISSION_BY_ROLE: Record<string, "read" | "write" | "admin"> = {
  viewer: "read",
  editor: "write",
  owner: "admin",
};

/** gitRepos.ts를 정적 import하면 members.ts ↔ gitRepos.ts 순환
 * 참조가 생긴다(gitRepos.ts가 저장소 연결 시 이 파일의
 * resyncCollaboratorGrantsForProject()를 쓰므로) - 이 방향은 호출
 * 시점(둘 다 모듈 평가가 끝난 뒤)에만 필요하므로 동적 import로 순환을
 * 피한다. 저장소가 아직 없으면(가장 흔한 경우 - 프로젝트 생성 직후)
 * null. */
async function resolveWorkSlugForCollabSync(projectId: string): Promise<string | null> {
  try {
    const { requireGiteaWorkingSlug } = await import("./gitRepos.js");
    return await requireGiteaWorkingSlug(projectId);
  } catch {
    return null;
  }
}

/** Member.role 변경을 Gitea 저장소 협업자 권한에 그대로 반영한다
 * (owner→admin/editor→write/viewer→read, role이 null이면 협업자에서
 * 제거). work/self_hosted 저장소에만 적용 - 미러는 설계자가 직접 rw할
 * 대상이 아니므로 제외. fail-soft(Gitea 미설정, 그 설계자의 Gitea
 * 계정이 아직 없음, 저장소 미연결 등 - 전부 조용히 스킵, 앱 레벨 Member
 * 조작 자체는 절대 안 막는다). */
export async function syncCollaboratorGrant(projectId: string, userId: string, role: string | null): Promise<void> {
  try {
    const db = getDb();
    const user = await db.user.findUnique({ where: { id: userId }, select: { giteaUsername: true } });
    if (!user?.giteaUsername) return;
    const slug = await resolveWorkSlugForCollabSync(projectId);
    if (!slug) return;
    if (role === null) {
      await gitea.removeRepoCollaborator(slug, user.giteaUsername);
    } else {
      await gitea.setRepoCollaborator(slug, user.giteaUsername, GITEA_PERMISSION_BY_ROLE[role] ?? "read");
    }
  } catch (err) {
    console.error(`syncCollaboratorGrant(${projectId}, ${userId}) 실패:`, err);
  }
}

/** 저장소가 막 연결된 시점(core/gitRepos.ts) 호출 - 그 프로젝트의
 * 기존 멤버 전원(저장소가 없던 동안 가입한 멤버들)에게 한 번에
 * 협업자 권한을 부여한다. */
export async function resyncCollaboratorGrantsForProject(projectId: string): Promise<void> {
  const db = getDb();
  const rows = await db.member.findMany({ where: { projectId }, select: { userId: true, role: true } });
  for (const row of rows) {
    await syncCollaboratorGrant(projectId, row.userId, row.role);
  }
}

/** 그 설계자의 Gitea 계정/토큰이 막 준비된 시점(core/giteaAccounts.ts)
 * 호출 - "계정은 생겼는데 이미 속한 프로젝트 어디에도 아직 협업자로
 * 없는" 간극을 메운다. */
export async function resyncCollaboratorGrantsForUser(userId: string): Promise<void> {
  const db = getDb();
  const rows = await db.member.findMany({ where: { userId }, select: { projectId: true, role: true } });
  for (const row of rows) {
    await syncCollaboratorGrant(row.projectId, userId, row.role);
  }
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
  if (await isSuperAdmin(userId)) return "owner";
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
