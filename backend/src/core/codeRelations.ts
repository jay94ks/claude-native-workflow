import { getDb } from "./db.js";
import { isSuperAdmin } from "./auth.js";
import { paginate, type Page } from "./pagination.js";

// 코드 관계도 - Claude가 코드 탐색 중 스스로 발견한 "무엇을, 어디서,
// 왜 참조했는지"를 기록해두는 자기 기록형 그래프. folders.ts와 동일한
// 원칙으로 프로젝트 내 설계자(userId) 개인 소유 - 다른 설계자는 존재
// 자체를 조회할 수 없다. 상위/하위 관계는 단일 부모 트리가 아니라
// CodeRelationEdge 다대다 조인으로 표현하고(노드 하나가 여러 부모/여러
// 자식을 가질 수 있음), 순환도 허용한다 - 실제 코드 관계는 상호
// 참조·순환 의존이 흔해서 생성 시점에 막지 않고, 순회(traverse)할 때만
// 방문 집합으로 무한 루프를 방지한다.

export interface CodeRelationDetail {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  target: string;
  referrer: string;
  purpose: string;
  filePath: string;
  line: number | null;
  column: number | null;
  data: unknown;
  trackingCodes: string[];
  tags: string[];
  parentIds: string[];
  childIds: string[];
}

export interface CodeRelationInput {
  target: string;
  referrer: string;
  purpose: string;
  filePath: string;
  line?: number;
  column?: number;
  data?: unknown;
  trackingCodes?: string[];
  tags?: string[];
  parentIds?: string[];
  childIds?: string[];
}

export interface CodeRelationEdgePatch {
  addParentIds?: string[];
  removeParentIds?: string[];
  addChildIds?: string[];
  removeChildIds?: string[];
}

interface RawRelation {
  id: string;
  projectId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  target: string;
  referrer: string;
  purpose: string;
  filePath: string;
  line: number | null;
  column: number | null;
  data: string | null;
  refs: { trackingCode: string }[];
  tags: { tag: string }[];
  parentEdges: { toId: string }[];
  childEdges: { fromId: string }[];
}

const RELATION_INCLUDE = { tags: true, refs: true, parentEdges: true, childEdges: true } as const;

function toDetail(row: RawRelation): CodeRelationDetail {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    target: row.target,
    referrer: row.referrer,
    purpose: row.purpose,
    filePath: row.filePath,
    line: row.line,
    column: row.column,
    data: row.data ? JSON.parse(row.data) : null,
    trackingCodes: row.refs.map((r) => r.trackingCode),
    tags: row.tags.map((t) => t.tag),
    parentIds: row.parentEdges.map((e) => e.toId),
    childIds: row.childEdges.map((e) => e.fromId),
  };
}

// folders.ts의 assertOwnsFolder와 동일 패턴 - 소유자가 아니면(또는
// projectId가 안 맞으면) "찾을 수 없거나 소유자가 아님"으로 존재
// 자체를 숨긴다(gitCredentials.ts와 동일 원칙).
async function assertOwnsRelation(id: string, projectId: string, userId: string): Promise<RawRelation> {
  const db = getDb();
  const row = await db.codeRelation.findUnique({ where: { id }, include: RELATION_INCLUDE });
  if (!row || row.projectId !== projectId || (row.userId !== userId && !(await isSuperAdmin(userId)))) {
    throw new Error(`관계를 찾을 수 없거나 소유자가 아닙니다: ${id}`);
  }
  return row;
}

function buildSearchWhere(filter: { q?: string; tag?: string }): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.tag) where.tags = { some: { tag: filter.tag } };
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    // SQLite Prisma 커넥터가 mode:"insensitive"를 지원 안 해서(3
    // 프로바이더 전부 지원해야 하는 제약) contains만 쓴다 - auth.ts의
    // 사용자 검색과 동일한 이유/관례.
    where.OR = [{ target: { contains: q } }, { referrer: { contains: q } }, { purpose: { contains: q } }];
  }
  return where;
}

// questions.ts의 addQuestion()과 동일한 이유/패턴 - QuestionReference처럼
// Document.trackingCode로의 실제 FK라 존재하지 않는 코드를 그대로
// insert 시도하면 원본 FK 제약 에러가 그대로 노출된다. 미리 조회해
// 명확한 에러로 바꾼다.
async function assertDocumentsExist(trackingCodes: string[]): Promise<void> {
  const db = getDb();
  for (const code of trackingCodes) {
    const doc = await db.document.findUnique({ where: { trackingCode: code } });
    if (!doc) throw new Error(`연관 문서를 찾을 수 없습니다: ${code}`);
  }
}

export async function createRelation(projectId: string, userId: string, input: CodeRelationInput): Promise<CodeRelationDetail> {
  const target = input.target?.trim();
  const referrer = input.referrer?.trim();
  const purpose = input.purpose?.trim();
  const filePath = input.filePath?.trim();
  if (!target) throw new Error("target이 필요합니다");
  if (!referrer) throw new Error("referrer가 필요합니다");
  if (!purpose) throw new Error("purpose가 필요합니다");
  if (!filePath) throw new Error("filePath가 필요합니다");

  const trackingCodes = [...new Set((input.trackingCodes ?? []).filter(Boolean))];
  await assertDocumentsExist(trackingCodes);

  const db = getDb();
  const created = await db.codeRelation.create({
    data: {
      projectId,
      userId,
      target,
      referrer,
      purpose,
      filePath,
      line: input.line ?? null,
      column: input.column ?? null,
      data: input.data !== undefined ? JSON.stringify(input.data) : null,
      tags: input.tags?.length ? { create: [...new Set(input.tags)].map((tag) => ({ tag })) } : undefined,
      refs: trackingCodes.length ? { create: trackingCodes.map((trackingCode) => ({ trackingCode })) } : undefined,
    },
  });

  for (const parentId of input.parentIds ?? []) await addEdge(projectId, userId, created.id, parentId);
  for (const childId of input.childIds ?? []) await addEdge(projectId, userId, childId, created.id);

  return getRelation(created.id, projectId, userId);
}

export async function updateRelation(
  id: string,
  projectId: string,
  userId: string,
  patch: Partial<CodeRelationInput> & CodeRelationEdgePatch,
): Promise<CodeRelationDetail> {
  await assertOwnsRelation(id, projectId, userId);
  const db = getDb();

  const data: Record<string, unknown> = {};
  if (patch.target !== undefined) data.target = patch.target.trim();
  if (patch.referrer !== undefined) data.referrer = patch.referrer.trim();
  if (patch.purpose !== undefined) data.purpose = patch.purpose.trim();
  if (patch.filePath !== undefined) data.filePath = patch.filePath.trim();
  if (patch.line !== undefined) data.line = patch.line;
  if (patch.column !== undefined) data.column = patch.column;
  if (patch.data !== undefined) data.data = JSON.stringify(patch.data);
  if (Object.keys(data).length > 0) {
    await db.codeRelation.update({ where: { id }, data });
  }

  if (patch.tags !== undefined) {
    await db.codeRelationTag.deleteMany({ where: { relationId: id } });
    const uniqueTags = [...new Set(patch.tags)];
    if (uniqueTags.length > 0) {
      await db.codeRelationTag.createMany({ data: uniqueTags.map((tag) => ({ relationId: id, tag })) });
    }
  }

  if (patch.trackingCodes !== undefined) {
    const uniqueCodes = [...new Set(patch.trackingCodes.filter(Boolean))];
    await assertDocumentsExist(uniqueCodes);
    await db.codeRelationRef.deleteMany({ where: { relationId: id } });
    if (uniqueCodes.length > 0) {
      await db.codeRelationRef.createMany({ data: uniqueCodes.map((trackingCode) => ({ relationId: id, trackingCode })) });
    }
  }

  for (const parentId of patch.addParentIds ?? []) await addEdge(projectId, userId, id, parentId);
  for (const parentId of patch.removeParentIds ?? []) await removeEdge(projectId, userId, id, parentId);
  for (const childId of patch.addChildIds ?? []) await addEdge(projectId, userId, childId, id);
  for (const childId of patch.removeChildIds ?? []) await removeEdge(projectId, userId, childId, id);

  return getRelation(id, projectId, userId);
}

// CodeRelationEdge/CodeRelationTag 둘 다 onDelete:Cascade라 이 관계에
// 연결된 엣지/태그만 자동 정리되고, 나머지 그래프는 그대로 남는다
// (Folder의 "promote" 같은 별도 승격 로직 불필요).
export async function deleteRelation(id: string, projectId: string, userId: string): Promise<void> {
  await assertOwnsRelation(id, projectId, userId);
  const db = getDb();
  await db.codeRelation.delete({ where: { id } });
}

export async function getRelation(id: string, projectId: string, userId: string): Promise<CodeRelationDetail> {
  const row = await assertOwnsRelation(id, projectId, userId);
  return toDetail(row);
}

export interface RelationListFilter {
  q?: string;
  filePath?: string;
  trackingCode?: string;
  tag?: string;
  hasNoParent?: boolean;
  page?: number;
  pageSize?: number;
}

// 페이지/페이지 크기 둘 다 생략하면 전체 배열(기존 list 명령들과 동일
// 페이지네이션 관례 - SKILL.md에 이미 문서화됨).
export async function listRelations(
  projectId: string,
  userId: string,
  filter: RelationListFilter,
): Promise<CodeRelationDetail[] | Page<CodeRelationDetail>> {
  const db = getDb();
  const where: Record<string, unknown> = { projectId, userId, ...buildSearchWhere(filter) };
  if (filter.filePath) where.filePath = filter.filePath;
  if (filter.trackingCode) where.refs = { some: { trackingCode: filter.trackingCode } };
  if (filter.hasNoParent) where.parentEdges = { none: {} };

  if (filter.page === undefined && filter.pageSize === undefined) {
    const rows = await db.codeRelation.findMany({ where, include: RELATION_INCLUDE, orderBy: { createdAt: "desc" } });
    return rows.map(toDetail);
  }
  const result = await paginate<RawRelation>(
    (args) => db.codeRelation.findMany({ where, include: RELATION_INCLUDE, orderBy: { createdAt: "desc" }, ...args }),
    () => db.codeRelation.count({ where }),
    filter.page ?? 1,
    filter.pageSize ?? 20,
  );
  return { ...result, items: result.items.map(toDetail) };
}

export async function listParents(id: string, projectId: string, userId: string): Promise<CodeRelationDetail[]> {
  const detail = await getRelation(id, projectId, userId);
  if (detail.parentIds.length === 0) return [];
  const db = getDb();
  const rows = await db.codeRelation.findMany({ where: { id: { in: detail.parentIds } }, include: RELATION_INCLUDE });
  return rows.map(toDetail);
}

export async function listChildren(id: string, projectId: string, userId: string): Promise<CodeRelationDetail[]> {
  const detail = await getRelation(id, projectId, userId);
  if (detail.childIds.length === 0) return [];
  const db = getDb();
  const rows = await db.codeRelation.findMany({ where: { id: { in: detail.childIds } }, include: RELATION_INCLUDE });
  return rows.map(toDetail);
}

// upsert라 이미 있는 엣지를 다시 걸어도 조용히 성공(멱등) - teamAdmins.ts
// 류의 addTeamAdmin과 같은 패턴. 순환 여부는 검사하지 않는다(설계자
// 지시 - 범용 그래프 엔진, 순환 허용).
export async function addEdge(projectId: string, userId: string, childId: string, parentId: string): Promise<void> {
  if (childId === parentId) throw new Error("자기 자신을 상위 관계로 지정할 수 없습니다");
  // 두 노드 다 같은 (projectId,userId) 소유인지 확인 - 설계자 경계를
  // 넘는 연결 자체를 막는 핵심 가드.
  await assertOwnsRelation(childId, projectId, userId);
  await assertOwnsRelation(parentId, projectId, userId);
  const db = getDb();
  await db.codeRelationEdge.upsert({
    where: { fromId_toId: { fromId: childId, toId: parentId } },
    update: {},
    create: { projectId, userId, fromId: childId, toId: parentId },
  });
}

export async function removeEdge(projectId: string, userId: string, childId: string, parentId: string): Promise<void> {
  await assertOwnsRelation(childId, projectId, userId);
  const db = getDb();
  await db.codeRelationEdge.deleteMany({ where: { projectId, userId, fromId: childId, toId: parentId } });
}

export interface TraversalFilter {
  tag?: string;
  q?: string;
}
export interface TraversalResult extends CodeRelationDetail {
  depth: number;
}

const MAX_TRAVERSAL_DEPTH = 20;

// 깊이 제한 그래프 순회 - MySQL/SQLite/Postgres의 재귀 CTE 문법 차이를
// 피하려고(이 코드베이스는 raw SQL을 쓰지 않음) 애플리케이션 레벨
// 반복 BFS로 구현한다. 순환 허용 그래프라 방문 집합(visited)으로 이미
// 본 노드는 다시 확장하지 않는다 - 그래야 무한 루프 없이 depth까지
// 안전하게 펼칠 수 있다. tag/q 필터는 순회 자체를 끊지 않고 결과에
// 담을지만 결정한다(필터링된 노드 너머로도 계속 탐색).
async function traverse(
  rootId: string,
  projectId: string,
  userId: string,
  maxDepth: number,
  filter: TraversalFilter,
  direction: "descendants" | "ancestors",
): Promise<TraversalResult[]> {
  await assertOwnsRelation(rootId, projectId, userId);
  const db = getDb();
  const safeDepth = Math.max(1, Math.min(Math.trunc(maxDepth) || 3, MAX_TRAVERSAL_DEPTH));
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  const results: TraversalResult[] = [];

  for (let depth = 1; depth <= safeDepth && frontier.length > 0; depth++) {
    const edges =
      direction === "descendants"
        ? await db.codeRelationEdge.findMany({ where: { toId: { in: frontier }, projectId, userId } })
        : await db.codeRelationEdge.findMany({ where: { fromId: { in: frontier }, projectId, userId } });
    const rawNextIds: string[] = direction === "descendants" ? edges.map((e: { fromId: string }) => e.fromId) : edges.map((e: { toId: string }) => e.toId);
    const nextIds = [...new Set(rawNextIds.filter((id) => !visited.has(id)))];
    if (nextIds.length === 0) break;
    nextIds.forEach((id) => visited.add(id));

    const rows = await db.codeRelation.findMany({
      where: { id: { in: nextIds }, projectId, userId, ...buildSearchWhere(filter) },
      include: RELATION_INCLUDE,
    });
    for (const row of rows) results.push({ ...toDetail(row), depth });

    frontier = nextIds;
  }
  return results;
}

export async function listDescendants(
  rootId: string,
  projectId: string,
  userId: string,
  maxDepth: number,
  filter: TraversalFilter,
): Promise<TraversalResult[]> {
  return traverse(rootId, projectId, userId, maxDepth, filter, "descendants");
}

export async function listAncestors(
  rootId: string,
  projectId: string,
  userId: string,
  maxDepth: number,
  filter: TraversalFilter,
): Promise<TraversalResult[]> {
  return traverse(rootId, projectId, userId, maxDepth, filter, "ancestors");
}

// ---------------------------------------------------------------- Bulk
// 트랜잭션 전체 성공/실패가 아니라 항목별 부분 성공 결과 배열 - 이
// 코드베이스의 bulk-folder/bulk-transition과 동일한 확립된 관례.

export interface BulkItemResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function bulkCreateRelations(projectId: string, userId: string, items: CodeRelationInput[]): Promise<BulkItemResult[]> {
  return Promise.all(
    items.map(async (item) => {
      try {
        const created = await createRelation(projectId, userId, item);
        return { ok: true, id: created.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export interface BulkUpdateItem extends Partial<CodeRelationInput>, CodeRelationEdgePatch {
  id: string;
}

export async function bulkUpdateRelations(
  projectId: string,
  userId: string,
  items: BulkUpdateItem[],
): Promise<Array<{ id: string } & BulkItemResult>> {
  return Promise.all(
    items.map(async ({ id, ...patch }) => {
      try {
        await updateRelation(id, projectId, userId, patch);
        return { id, ok: true };
      } catch (err) {
        return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function bulkDeleteRelations(
  projectId: string,
  userId: string,
  ids: string[],
): Promise<Array<{ id: string } & BulkItemResult>> {
  return Promise.all(
    ids.map(async (id) => {
      try {
        await deleteRelation(id, projectId, userId);
        return { id, ok: true };
      } catch (err) {
        return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}
