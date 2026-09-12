import { getDb } from "./db.js";
import { seedDefaultDocTypes } from "./docTypes.js";
import { seedDefaultKanbanColumns } from "./kanban.js";
import { getMemberRole, isProjectAllowedByActiveScope } from "./members.js";
import { isTeamAdmin } from "./teamAdmins.js";
import { isProjectGroupAdmin } from "./projectGroupAdmins.js";
import { hasProjectMembershipInGroup } from "./projectGroups.js";
import { paginateInMemory, type Page } from "./pagination.js";

const DEFAULT_GROUP_NAME = "기본";

// Project.projectGroupId는 스키마상 필수다 - 하지만 "팀·그룹 없이도
// 동작해야 한다"(개인 PC/소규모 설치에서 계층 구조를 신경 쓰지 않아도
// 되게)는 요구를 만족시키려고, projectGroupId를 안 넘기면 팀 없는
// 기본 그룹을 찾거나 만들어서 쓴다 - 설계자가 계층을 원하면 나중에
// 언제든 진짜 그룹을 만들어 옮기면 된다.
async function defaultProjectGroupId(): Promise<string> {
  const db = getDb();
  const existing = await db.projectGroup.findFirst({
    where: { teamId: null, name: DEFAULT_GROUP_NAME },
  });
  if (existing) return existing.id;
  const created = await db.projectGroup.create({ data: { name: DEFAULT_GROUP_NAME } });
  return created.id;
}

export interface Project {
  id: string;
  projectGroupId: string;
  name: string;
  hidden: boolean;
  hiddenBy: string | null;
  isPublic: boolean;
}

export interface ProjectWithMyPerms extends Project {
  /** owner 또는 소속 팀 팀장·그룹 관리자만 true(숨김/공개 토글
   * 라우트가 요구하는 것과 정확히 같은 조건) - 프런트가 토글 버튼을
   * v-if할 때 쓴다. */
  canToggleHidden: boolean;
}

export async function createProject(name: string, projectGroupId?: string, isPublic = false): Promise<Project> {
  const db = getDb();
  // createProjectGroup()과 같은 이유로 빈 문자열을 "안 넘김"으로
  // 정규화한다 - 안 그러면 검증을 다 건너뛰고 Prisma FK 에러가 그대로
  // 노출된다.
  projectGroupId = projectGroupId || undefined;
  const groupId = projectGroupId ?? (await defaultProjectGroupId());
  if (projectGroupId) {
    const group = await db.projectGroup.findUnique({ where: { id: projectGroupId } });
    if (!group) throw new Error(`projectGroup을 찾을 수 없습니다: ${projectGroupId}`);
  }
  const row = await db.project.create({ data: { name, projectGroupId: groupId, isPublic } });
  await seedDefaultDocTypes(row.id);
  await seedDefaultKanbanColumns(row.id);
  return {
    id: row.id,
    projectGroupId: row.projectGroupId,
    name: row.name,
    hidden: row.hidden,
    hiddenBy: row.hiddenBy,
    isPublic: row.isPublic,
  };
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getDb();
  const row = await db.project.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    projectGroupId: row.projectGroupId,
    name: row.name,
    hidden: row.hidden,
    hiddenBy: row.hiddenBy,
    isPublic: row.isPublic,
  };
}

/** Project→ProjectGroup을 거쳐 그 그룹이 속한 팀 id를 구한다(팀 없으면
 * null) - 숨김 프로젝트 접근/팀장 판정이 재사용. */
export async function getOwningTeamId(projectId: string): Promise<string | null> {
  const db = getDb();
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const group = await db.projectGroup.findUnique({ where: { id: project.projectGroupId } });
  return group?.teamId ?? null;
}

/** 이 프로젝트를 목록/조회에서 볼 수 있는가 - Member(admin 포함,
 * getMemberRole이 이미 최고 관리자를 owner로 처리)거나, 소속 팀의
 * 팀장이거나, 소속 그룹의 관리자면 hidden 여부와 무관하게 항상 true
 * (관리자/멤버는 항상 봄). 그 외엔 hidden이면 무조건 false(공개
 * 여부와 무관하게 차단 - hidden이 isPublic보다 우선), hidden이
 * 아니면 isPublic && 그 그룹에 실제 멤버십이 있을 때만 true(설계자
 * 확정 - "공개"만으로는 부족하고 그 그룹에 대한 읽기 권한도 있어야
 * 함). 예전 canSeeHiddenProject()를 대체 - 그룹 관리자 우회가
 * 빠져있던 비일관성도 이번에 같이 보정. */
export async function canSeeProject(project: Project, userId: string): Promise<boolean> {
  const role = await getMemberRole(project.id, userId);
  if (role) return true;
  const teamId = await getOwningTeamId(project.id);
  if (await isTeamAdmin(teamId, userId)) return true;
  if (await isProjectGroupAdmin(project.projectGroupId, userId)) return true;
  if (project.hidden) return false;
  return project.isPublic && (await hasProjectMembershipInGroup(project.projectGroupId, userId));
}

/** hidden=true면 hiddenBy=actingUserId 기록, false면 hiddenBy를 비운다
 * (더는 의미가 없으므로). */
export async function setProjectHidden(projectId: string, hidden: boolean, actingUserId: string): Promise<Project> {
  const db = getDb();
  const row = await db.project.update({
    where: { id: projectId },
    data: { hidden, hiddenBy: hidden ? actingUserId : null },
  });
  return {
    id: row.id,
    projectGroupId: row.projectGroupId,
    name: row.name,
    hidden: row.hidden,
    hiddenBy: row.hiddenBy,
    isPublic: row.isPublic,
  };
}

export async function setProjectPublic(projectId: string, isPublic: boolean): Promise<Project> {
  const db = getDb();
  const row = await db.project.update({ where: { id: projectId }, data: { isPublic } });
  return {
    id: row.id,
    projectGroupId: row.projectGroupId,
    name: row.name,
    hidden: row.hidden,
    hiddenBy: row.hiddenBy,
    isPublic: row.isPublic,
  };
}

/** 프로젝트를 완전히 삭제한다 - 문서/코멘트/칸반/Q&A 등 DB 데이터는
 * cascade로 함께 지워지고(스키마 참고), 연결된 Gitea 저장소도 먼저
 * 지운다(설계자 확인). gitRepos.ts를 정적 import하면 projects.ts ↔
 * gitRepos.ts 순환 참조가 생긴다(gitRepos.ts가 assertProjectExists를
 * 쓰므로) - members.ts의 resolveWorkSlugForCollabSync와 동일한 회피
 * 패턴으로 동적 import한다. */
export async function deleteProject(projectId: string): Promise<void> {
  try {
    const { deleteProjectGitRepo } = await import("./gitRepos.js");
    await deleteProjectGitRepo(projectId);
  } catch (err) {
    console.error(`deleteProject(${projectId}) - Gitea 저장소 정리 실패:`, err);
  }
  const db = getDb();
  await db.project.delete({ where: { id: projectId } });
}

/** 권한이 없거나 소속되지 않은 프로젝트는 canSeeProject()로 걸러
 * 목록 자체에서 뺀다(설계자 확정 - 기본 비공개, isPublic + 그룹
 * 읽기 권한이 있어야 예외적으로 보임). */
export async function listProjects(projectGroupId: string | undefined, viewerId: string): Promise<ProjectWithMyPerms[]> {
  const db = getDb();
  const rows = await db.project.findMany({
    where: projectGroupId ? { projectGroupId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  const visible: ProjectWithMyPerms[] = [];
  for (const r of rows as Project[]) {
    if (!(await isProjectAllowedByActiveScope(r.id))) continue; // 스코프 밖 프로젝트는 존재 자체를 목록에서 숨김
    if (!(await canSeeProject(r, viewerId))) continue;
    const role = await getMemberRole(r.id, viewerId);
    const teamId = await getOwningTeamId(r.id);
    const canToggleHidden =
      role === "owner" || (await isTeamAdmin(teamId, viewerId)) || (await isProjectGroupAdmin(r.projectGroupId, viewerId));
    visible.push({
      id: r.id,
      projectGroupId: r.projectGroupId,
      name: r.name,
      hidden: r.hidden,
      hiddenBy: r.hiddenBy,
      isPublic: r.isPublic,
      canToggleHidden,
    });
  }
  return visible;
}

// listTeamsPaged()와 같은 이유(스코프/가시성 필터가 행을 걸러냄) -
// 필터링까지 끝낸 배열을 받은 뒤 여기서 자른다.
export async function listProjectsPaged(
  projectGroupId: string | undefined,
  viewerId: string,
  page: number,
  pageSize: number,
): Promise<Page<ProjectWithMyPerms>> {
  const all = await listProjects(projectGroupId, viewerId);
  return paginateInMemory(all, page, pageSize);
}

export async function assertProjectExists(projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.project.findUnique({ where: { id: projectId } });
  if (!row) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
}

export type SearchScope = "project" | "group" | "team";

/** 사이드바 다중 스코프 검색(웹 전용) 전용 - anchorProjectId를 기준점
 * 삼아 그 범위(프로젝트 자신/소속 그룹/소속 팀)의 프로젝트 id들을
 * 반환하되, 항상 실제 멤버십(getMemberRole 비어있지 않음)으로 거른다.
 * listProjects()는 숨김 아닌 프로젝트를 비멤버에게도 존재를 보여주지만
 * (목록 화면의 기존 동작), 문서/소스 코드 내용 읽기는 항상
 * requireProjectRole("viewer")(실제 Member)를 요구해왔다 - 검색 결과도
 * 내용을 그대로 노출하므로 같은 기준을 적용한다. */
export async function listAccessibleProjectIdsInScope(
  anchorProjectId: string,
  scope: SearchScope,
  userId: string,
): Promise<string[]> {
  const db = getDb();
  if (scope === "project") {
    return (await getMemberRole(anchorProjectId, userId)) ? [anchorProjectId] : [];
  }

  const anchor = await db.project.findUnique({ where: { id: anchorProjectId } });
  if (!anchor) throw new Error(`프로젝트를 찾을 수 없습니다: ${anchorProjectId}`);

  let candidates: { id: string }[];
  if (scope === "group") {
    candidates = await db.project.findMany({ where: { projectGroupId: anchor.projectGroupId }, select: { id: true } });
  } else {
    const teamId = await getOwningTeamId(anchorProjectId);
    if (!teamId) throw new Error("이 프로젝트는 팀에 속해 있지 않습니다");
    candidates = await db.project.findMany({ where: { projectGroup: { teamId } }, select: { id: true } });
  }

  const accessible: string[] = [];
  for (const c of candidates as { id: string }[]) {
    if (await getMemberRole(c.id, userId)) accessible.push(c.id);
  }
  return accessible;
}

/** 검색 결과가 여러 프로젝트에 걸칠 때(그룹/팀 스코프) 각 결과에
 * 프로젝트 이름 배지를 붙이는 데 쓴다 - id → name 맵으로 반환. */
export async function getProjectNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const rows = await db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map((rows as { id: string; name: string }[]).map((r) => [r.id, r.name]));
}
