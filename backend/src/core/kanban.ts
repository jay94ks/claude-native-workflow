import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { sendMessage } from "./messages.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { paginate, paginateInMemory, type Page } from "./pagination.js";

// 프로젝트별 칸반 보드 - 컬럼(분류)은 프로젝트 공유 자원이고, "그 컬럼을
// 내가 보는 순서/숨김 여부"만 설계자별로 다르다(KanbanColumnPref).
// 카드는 문서/질문과 같은 원칙으로 트래킹 코드를 받고(KB-XXXXXXXX),
// origin("ai"|"designer")으로 누가 만들었는지 구분한다 - 설계자가 만든
// 카드는 생성 즉시 sendMessage()로 알림을 보내 "반드시 진행되어야 하는
// 작업"임을 AI가 인지하게 한다(요청 문구 "메시지 기능과 연동" 그대로).
// 카드 코멘트는 설계자간 채널이라 core/comments.ts와 마찬가지로 CLI/MCP
// 표면이 없다(호출부: cli/index.ts, mcp/server.ts 어디에도 없음).

const KANBAN_CARD_TYPE_CODE = "KB";
const DEFAULT_COLUMN_NAMES = ["pending", "doing", "qa", "done"];

// ---------------------------------------------------------------- 컬럼(분류)

export interface KanbanColumnView {
  id: string;
  projectId: string;
  name: string;
  order: number;
  hidden: boolean;
}

export async function seedDefaultKanbanColumns(projectId: string): Promise<void> {
  const db = getDb();
  await db.kanbanColumn.createMany({
    data: DEFAULT_COLUMN_NAMES.map((name, order) => ({ projectId, name, order })),
  });
}

export async function createKanbanColumn(projectId: string, name: string): Promise<KanbanColumnView> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("분류 이름이 필요합니다");
  const db = getDb();
  const existing = await db.kanbanColumn.findFirst({ where: { projectId, name: trimmed } });
  if (existing) throw new Error(`이미 같은 이름의 분류가 있습니다: ${trimmed}`);
  const count = await db.kanbanColumn.count({ where: { projectId } });
  const row = await db.kanbanColumn.create({ data: { projectId, name: trimmed, order: count } });
  await realtimePublish(projectChangesTopic(projectId), {
    entity: "kanbanColumn",
    action: "create",
    id: row.id,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
  return { id: row.id, projectId: row.projectId, name: row.name, order: row.order, hidden: false };
}

/** 프로젝트의 컬럼 전체 - 호출자의 KanbanColumnPref가 있으면 order/hidden을
 * 덮어쓴 "유효 뷰"를 반환한다(숨긴 컬럼도 hidden:true로 그대로 포함 -
 * 프런트가 메인 보드/숨김 관리 패널로 나눠 쓴다). CLI/MCP도 이 함수를
 * 그대로 쓰므로, 그 API 키/JWT가 대행하는 신원의 개인 설정이 자동으로
 * 적용된다. */
export async function listKanbanColumnsForUser(projectId: string, userId: string): Promise<KanbanColumnView[]> {
  const db = getDb();
  const columns = await db.kanbanColumn.findMany({ where: { projectId } });
  const prefs = await db.kanbanColumnPref.findMany({
    where: { userId, columnId: { in: columns.map((c: { id: string }) => c.id) } },
  });
  const prefByColumnId = new Map(prefs.map((p: { columnId: string }) => [p.columnId, p]));
  const merged = columns.map((c: { id: string; projectId: string; name: string; order: number }) => {
    const pref = prefByColumnId.get(c.id) as { order: number | null; hidden: boolean | null } | undefined;
    return {
      id: c.id,
      projectId: c.projectId,
      name: c.name,
      order: pref?.order ?? c.order,
      hidden: pref?.hidden ?? false,
    };
  });
  merged.sort((a: KanbanColumnView, b: KanbanColumnView) => a.order - b.order);
  return merged;
}

// 컬럼별 개인 설정(순서/숨김)을 병합한 뒤 그 병합된 순서로 다시
// 정렬하므로(원래 DB order와 다를 수 있음), DB 단계에서 skip/take를
// 걸면 페이지 경계가 최종 순서와 어긋난다 - 병합·정렬까지 끝난 배열을
// 통째로 받은 뒤 여기서 자른다(컬럼 수는 프로젝트당 소수라 비용 문제
// 없음).
export async function listKanbanColumnsForUserPaged(
  projectId: string,
  userId: string,
  page: number,
  pageSize: number,
): Promise<Page<KanbanColumnView>> {
  const all = await listKanbanColumnsForUser(projectId, userId);
  return paginateInMemory(all, page, pageSize);
}

export async function getKanbanColumnProjectId(columnId: string): Promise<string | null> {
  const db = getDb();
  const column = await db.kanbanColumn.findUnique({ where: { id: columnId } });
  return column?.projectId ?? null;
}

export async function setColumnHiddenForUser(columnId: string, userId: string, hidden: boolean): Promise<void> {
  const db = getDb();
  const column = await db.kanbanColumn.findUnique({ where: { id: columnId } });
  if (!column) throw new Error(`분류를 찾을 수 없습니다: ${columnId}`);
  await db.kanbanColumnPref.upsert({
    where: { columnId_userId: { columnId, userId } },
    create: { columnId, userId, hidden },
    update: { hidden },
  });
}

/** 드래그로 바뀐 전체 순서를 배열로 받아 0..n-1로 재번호 - 호출자
 * 본인의 KanbanColumnPref만 바뀌므로 다른 설계자의 뷰는 그대로다. */
export async function reorderColumnsForUser(projectId: string, userId: string, columnIds: string[]): Promise<void> {
  const db = getDb();
  const columns = await db.kanbanColumn.findMany({ where: { projectId, id: { in: columnIds } } });
  if (columns.length !== columnIds.length) throw new Error("일부 분류를 찾을 수 없습니다");
  await db.$transaction(
    columnIds.map((id, i) =>
      db.kanbanColumnPref.upsert({
        where: { columnId_userId: { columnId: id, userId } },
        create: { columnId: id, userId, order: i },
        update: { order: i },
      }),
    ),
  );
}

// ---------------------------------------------------------------- 카드

export interface KanbanCardDetail {
  trackingCode: string;
  projectId: string;
  columnId: string;
  columnName: string;
  title: string;
  body: string | null;
  origin: string;
  hidden: boolean;
  order: number;
  createdBy: string;
  createdAt: Date;
  docRefs: string[];
}

function toCardDetail(row: {
  trackingCode: string;
  projectId: string;
  columnId: string;
  columnName: string;
  title: string;
  body: string | null;
  origin: string;
  hidden: boolean;
  order: number;
  createdBy: string;
  createdAt: Date;
  docRefs: { trackingCode: string }[];
}): KanbanCardDetail {
  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    columnId: row.columnId,
    columnName: row.columnName,
    title: row.title,
    body: row.body,
    origin: row.origin,
    hidden: row.hidden,
    order: row.order,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    docRefs: row.docRefs.map((d) => d.trackingCode),
  };
}

/** origin==="designer"면 생성 직후 sendMessage()로 "[trackingCode]
 * title" 메시지를 자동 발송한다(요청 4번 "메시지 기능과 연동" 그대로) -
 * 별도 mandatory 컬럼 없이 origin 자체가 "반드시 진행돼야 하는 작업"
 * 표시를 겸한다. */
export async function createKanbanCard(
  projectId: string,
  columnId: string,
  title: string,
  body: string | undefined,
  origin: "ai" | "designer",
  createdBy: string,
  refTrackingCodes?: string[],
): Promise<KanbanCardDetail> {
  if (!title.trim()) throw new Error("제목이 필요합니다");
  const db = getDb();
  const column = await db.kanbanColumn.findUnique({ where: { id: columnId } });
  if (!column || column.projectId !== projectId) throw new Error(`분류를 찾을 수 없습니다: ${columnId}`);

  const refs = refTrackingCodes?.filter(Boolean) ?? [];
  for (const ref of refs) {
    const doc = await db.document.findUnique({ where: { trackingCode: ref } });
    if (!doc) throw new Error(`근거 문서를 찾을 수 없습니다: ${ref}`);
  }

  const cardCount = await db.kanbanCard.count({ where: { columnId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(projectId, KANBAN_CARD_TYPE_CODE, "kanbanCard", (trackingCode) =>
    db.kanbanCard.create({
      data: { projectId, columnId, trackingCode, title, body: body ?? null, origin, order: cardCount, createdBy },
    }),
  );

  if (refs.length > 0) {
    await db.kanbanCardDocumentRef.createMany({
      data: refs.map((trackingCode) => ({ cardId: row.id, trackingCode })),
    });
  }

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "kanbanCard",
    action: "create",
    id: row.id,
    trackingCode: row.trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  if (origin === "designer") {
    await sendMessage(projectId, createdBy, `[${row.trackingCode}] ${title}`);
  }

  return toCardDetail({ ...row, columnName: column.name, docRefs: refs.map((trackingCode) => ({ trackingCode })) });
}

export async function listKanbanCards(
  projectId: string,
  columnId?: string,
  includeHidden = false,
): Promise<KanbanCardDetail[]> {
  const db = getDb();
  const rows = await db.kanbanCard.findMany({
    where: {
      projectId,
      ...(columnId ? { columnId } : {}),
      ...(includeHidden ? {} : { hidden: false }),
    },
    include: { docRefs: true, column: true },
    orderBy: { order: "asc" },
  });
  return rows.map((r: typeof rows[number]) => toCardDetail({ ...r, columnName: r.column.name }));
}

export async function listKanbanCardsPaged(
  projectId: string,
  columnId: string | undefined,
  includeHidden: boolean,
  page: number,
  pageSize: number,
): Promise<Page<KanbanCardDetail>> {
  const db = getDb();
  const where = {
    projectId,
    ...(columnId ? { columnId } : {}),
    ...(includeHidden ? {} : { hidden: false }),
  };
  type RawCard = Omit<Parameters<typeof toCardDetail>[0], "columnName"> & { column: { name: string } };
  const result = await paginate<RawCard>(
    (args) => db.kanbanCard.findMany({ where, include: { docRefs: true, column: true }, orderBy: { order: "asc" }, ...args }),
    () => db.kanbanCard.count({ where }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((r) => toCardDetail({ ...r, columnName: r.column.name })),
  };
}

/** 문서/질문과 같은 "트래킹 코드로 조회" 관례 - 카드 하위 라우트(이동/
 * 숨김/코멘트)들이 전부 이걸로 먼저 카드+projectId를 얻은 뒤
 * getMemberRole로 인라인 인가한다. */
export async function getKanbanCardByTrackingCode(trackingCode: string): Promise<KanbanCardDetail | null> {
  const db = getDb();
  const row = await db.kanbanCard.findUnique({ where: { trackingCode }, include: { docRefs: true, column: true } });
  if (!row) return null;
  return toCardDetail({ ...row, columnName: row.column.name });
}

/** 대상 컬럼의 기존 카드 목록(order asc)에 toIndex(생략 시 맨 끝)로
 * 삽입한 뒤 전체를 0..n-1로 재번호한다 - 드래그 앤 드롭과 AI의
 * kanban-card-move가 같은 로직을 공유. */
export async function moveKanbanCard(trackingCode: string, toColumnId: string, toIndex?: number): Promise<void> {
  const db = getDb();
  const card = await db.kanbanCard.findUnique({ where: { trackingCode } });
  if (!card) throw new Error(`카드를 찾을 수 없습니다: ${trackingCode}`);
  const column = await db.kanbanColumn.findUnique({ where: { id: toColumnId } });
  if (!column || column.projectId !== card.projectId) throw new Error(`분류를 찾을 수 없습니다: ${toColumnId}`);

  const siblings = await db.kanbanCard.findMany({
    where: { columnId: toColumnId, id: { not: card.id } },
    orderBy: { order: "asc" },
  });
  const insertAt = toIndex === undefined ? siblings.length : Math.max(0, Math.min(toIndex, siblings.length));
  siblings.splice(insertAt, 0, card);

  await db.$transaction(
    siblings.map((c: { id: string }, i: number) =>
      db.kanbanCard.update({ where: { id: c.id }, data: { columnId: toColumnId, order: i } }),
    ),
  );

  await realtimePublish(projectChangesTopic(card.projectId), {
    entity: "kanbanCard",
    action: "update",
    id: card.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}

export async function setKanbanCardHidden(trackingCode: string, hidden: boolean): Promise<void> {
  const db = getDb();
  const existing = await db.kanbanCard.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`카드를 찾을 수 없습니다: ${trackingCode}`);
  await db.kanbanCard.update({ where: { trackingCode }, data: { hidden } });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "kanbanCard",
    action: "update",
    id: existing.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}

// 카드별 코멘트는 core/comments.ts의 공용 Comment로 흡수됐다
// (targetType:"kanbanCard", targetKey=카드의 트래킹 코드) - 이 파일엔
// 더 이상 코멘트 관련 함수가 없다.
