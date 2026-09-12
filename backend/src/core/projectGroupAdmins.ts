import { getDb } from "./db.js";
import { isTeamAdmin } from "./teamAdmins.js";
import { isSuperAdmin } from "./auth.js";
import { paginate, type Page } from "./pagination.js";

// core/teamAdmins.ts와 동일한 패턴 - 다만 팀은 그룹의 상위 개념이라
// 권한도 위에서 아래로 흐른다: 팀 관리자는 자기 팀 산하 모든 그룹에
// 대해서도 자동으로 그룹 관리자 권한을 갖는다(canSeeProject가
// "팀장은 자기 팀 산하 숨김/비공개 프로젝트도 본다"로 이미 쓰는 것과
// 같은 상속 원칙 - isProjectGroupAdmin()이 이 상속을 구현).

export interface ProjectGroupAdmin {
  id: string;
  projectGroupId: string;
  userId: string;
}

export async function addProjectGroupAdmin(projectGroupId: string, userId: string): Promise<ProjectGroupAdmin> {
  const db = getDb();
  const group = await db.projectGroup.findUnique({ where: { id: projectGroupId } });
  if (!group) throw new Error(`프로젝트 그룹을 찾을 수 없습니다: ${projectGroupId}`);
  const row = await db.projectGroupAdmin.upsert({
    where: { projectGroupId_userId: { projectGroupId, userId } },
    update: {},
    create: { projectGroupId, userId },
  });
  return { id: row.id, projectGroupId: row.projectGroupId, userId: row.userId };
}

export async function removeProjectGroupAdmin(projectGroupId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.projectGroupAdmin.deleteMany({ where: { projectGroupId, userId } });
}

export async function listProjectGroupAdmins(projectGroupId: string): Promise<ProjectGroupAdmin[]> {
  const db = getDb();
  const rows = await db.projectGroupAdmin.findMany({ where: { projectGroupId } });
  return rows.map((r: ProjectGroupAdmin) => ({ id: r.id, projectGroupId: r.projectGroupId, userId: r.userId }));
}

export async function listProjectGroupAdminsPaged(
  projectGroupId: string,
  page: number,
  pageSize: number,
): Promise<Page<ProjectGroupAdmin>> {
  const db = getDb();
  return paginate(
    (args) => db.projectGroupAdmin.findMany({ where: { projectGroupId }, ...args }),
    () => db.projectGroupAdmin.count({ where: { projectGroupId } }),
    page,
    pageSize,
  );
}

/** 명시적으로 그 그룹의 ProjectGroupAdmin으로 등록돼 있거나, 그 그룹이
 * 속한 팀의 TeamAdmin이면 true(팀 없는 그룹은 명시적 등록만 해당).
 * "그룹 관리자만 볼 수 있다"는 이번 보안 요구사항의 판정 함수 - 그룹
 * 멤버 조회/그룹 관리자 등록·해제/그룹 CRUD가 전부 이 함수 하나를
 * 공유한다. */
export async function isProjectGroupAdmin(projectGroupId: string, userId: string): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const db = getDb();
  const explicit = await db.projectGroupAdmin.findUnique({
    where: { projectGroupId_userId: { projectGroupId, userId } },
  });
  if (explicit) return true;

  const group = await db.projectGroup.findUnique({ where: { id: projectGroupId } });
  if (!group?.teamId) return false;
  return isTeamAdmin(group.teamId, userId);
}
