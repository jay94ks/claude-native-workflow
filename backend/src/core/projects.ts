import { getDb } from "./db.js";
import { seedDefaultDocTypes } from "./docTypes.js";
import { seedDefaultKanbanColumns } from "./kanban.js";
import { getMemberRole, isProjectAllowedByActiveScope } from "./members.js";
import { isTeamAdmin } from "./teamAdmins.js";

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
}

export async function createProject(name: string, projectGroupId?: string): Promise<Project> {
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
  const row = await db.project.create({ data: { name, projectGroupId: groupId } });
  await seedDefaultDocTypes(row.id);
  await seedDefaultKanbanColumns(row.id);
  return { id: row.id, projectGroupId: row.projectGroupId, name: row.name, hidden: row.hidden, hiddenBy: row.hiddenBy };
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getDb();
  const row = await db.project.findUnique({ where: { id } });
  if (!row) return null;
  return { id: row.id, projectGroupId: row.projectGroupId, name: row.name, hidden: row.hidden, hiddenBy: row.hiddenBy };
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

/** 숨김 처리된 프로젝트를 이 사용자가 볼 수 있는가 - 그 프로젝트의
 * Member거나, 그 프로젝트가 속한 팀의 팀장이면 true. */
export async function canSeeHiddenProject(projectId: string, userId: string): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  if (role) return true;
  const teamId = await getOwningTeamId(projectId);
  return isTeamAdmin(teamId, userId);
}

/** hidden=true면 hiddenBy=actingUserId 기록, false면 hiddenBy를 비운다
 * (더는 의미가 없으므로). */
export async function setProjectHidden(projectId: string, hidden: boolean, actingUserId: string): Promise<Project> {
  const db = getDb();
  const row = await db.project.update({
    where: { id: projectId },
    data: { hidden, hiddenBy: hidden ? actingUserId : null },
  });
  return { id: row.id, projectGroupId: row.projectGroupId, name: row.name, hidden: row.hidden, hiddenBy: row.hiddenBy };
}

/** 숨김 프로젝트는 canSeeHiddenProject를 만족하는 viewer에게만 보인다 -
 * 숨김 아닌 프로젝트는 지금처럼(멤버십 무관) 전체 공개 목록. */
export async function listProjects(projectGroupId: string | undefined, viewerId: string): Promise<Project[]> {
  const db = getDb();
  const rows = await db.project.findMany({
    where: projectGroupId ? { projectGroupId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  const visible: Project[] = [];
  for (const r of rows as { id: string; projectGroupId: string; name: string; hidden: boolean; hiddenBy: string | null }[]) {
    if (!(await isProjectAllowedByActiveScope(r.id))) continue; // 스코프 밖 프로젝트는 존재 자체를 목록에서 숨김
    if (r.hidden && !(await canSeeHiddenProject(r.id, viewerId))) continue;
    visible.push({ id: r.id, projectGroupId: r.projectGroupId, name: r.name, hidden: r.hidden, hiddenBy: r.hiddenBy });
  }
  return visible;
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
