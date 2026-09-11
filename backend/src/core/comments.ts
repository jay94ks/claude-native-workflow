import { getDb } from "./db.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { getDocument } from "./documents.js";
import { getKanbanCardByTrackingCode } from "./kanban.js";

// 코멘트는 설계자들끼리만 공유되는 채널이라 CLI/MCP에 없다(완전성 원칙의
// 의도적 예외 - comment.G, 이번에 소스 코드/칸반 카드로 확장돼도 그대로
// 유지). targetType/targetKey로 다형화돼 있어 대상이 하나 더 늘어도
// 여기 core 함수는 그대로 재사용된다.

export type CommentTargetType = "document" | "source" | "kanbanCard";

export type CommentStatus = "open" | "closed" | "solved" | "etc";
const ALLOWED_STATUSES = new Set<CommentStatus>(["open", "closed", "solved", "etc"]);

export interface CommentDetail {
  id: string;
  projectId: string;
  targetType: string;
  targetKey: string;
  body: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  status: string; // open | closed | solved | etc - 작성자 본인만 변경 가능
}

/** document/kanbanCard 대상은 실제로 존재하는지, 이 프로젝트 소속이
 * 맞는지 확인한다 - source는 git 파일 존재 여부를 확인하지 않는다
 * (DocumentSourceLink와 같은 이유 - 순수 연관 관계). */
async function assertTargetExists(projectId: string, targetType: string, targetKey: string): Promise<void> {
  if (targetType === "document") {
    const doc = await getDocument(targetKey);
    if (!doc || doc.projectId !== projectId) throw new Error(`대상 문서를 찾을 수 없습니다: ${targetKey}`);
  } else if (targetType === "kanbanCard") {
    const card = await getKanbanCardByTrackingCode(targetKey);
    if (!card || card.projectId !== projectId) throw new Error(`대상 카드를 찾을 수 없습니다: ${targetKey}`);
  } else if (targetType !== "source") {
    throw new Error(`알 수 없는 대상 종류입니다: ${targetType}`);
  }
}

export async function addComment(
  projectId: string,
  targetType: string,
  targetKey: string,
  body: string,
  authorId: string,
): Promise<CommentDetail> {
  if (!body.trim()) throw new Error("body가 필요합니다");
  await assertTargetExists(projectId, targetType, targetKey);
  const db = getDb();
  const row = await db.comment.create({ data: { projectId, targetType, targetKey, body, authorId } });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "comment",
    action: "create",
    id: row.id,
    targetType,
    targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return row;
}

export async function listComments(targetType: string, targetKey: string): Promise<CommentDetail[]> {
  const db = getDb();
  return db.comment.findMany({ where: { targetType, targetKey }, orderBy: { createdAt: "asc" } });
}

export async function editComment(id: string, body: string, requesterId: string): Promise<CommentDetail> {
  if (!body.trim()) throw new Error("body가 필요합니다");
  const db = getDb();
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new Error(`코멘트를 찾을 수 없습니다: ${id}`);
  if (existing.authorId !== requesterId) throw new Error("본인이 작성한 코멘트만 수정할 수 있습니다");
  const row = await db.comment.update({ where: { id }, data: { body } });

  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "comment",
    action: "update",
    id,
    targetType: existing.targetType,
    targetKey: existing.targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return row;
}

export async function deleteComment(id: string, requesterId: string): Promise<void> {
  const db = getDb();
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new Error(`코멘트를 찾을 수 없습니다: ${id}`);
  if (existing.authorId !== requesterId) throw new Error("본인이 작성한 코멘트만 삭제할 수 있습니다");
  await db.comment.delete({ where: { id } });

  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "comment",
    action: "delete",
    id,
    targetType: existing.targetType,
    targetKey: existing.targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}

/** 코멘트 상태는 본인만 변경할 수 있다 - editComment/deleteComment와
 * 정확히 같은 작성자 확인 패턴(이전엔 resolve만 editor 기준이라
 * 불일치했던 지점을 통일). */
export async function setCommentStatus(id: string, status: string, requesterId: string): Promise<CommentDetail> {
  if (!ALLOWED_STATUSES.has(status as CommentStatus)) {
    throw new Error(`status는 open/closed/solved/etc 중 하나여야 합니다: ${status}`);
  }
  const db = getDb();
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new Error(`코멘트를 찾을 수 없습니다: ${id}`);
  if (existing.authorId !== requesterId) throw new Error("본인이 작성한 코멘트만 상태를 변경할 수 있습니다");
  const row = await db.comment.update({ where: { id }, data: { status } });

  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "comment",
    action: "update",
    id,
    targetType: existing.targetType,
    targetKey: existing.targetKey,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return row;
}

export interface RecentComment extends CommentDetail {
  /** 표시용 제목 - document/kanbanCard는 그 제목, source는 targetKey
   * (파일 경로) 그대로. */
  targetLabel: string;
}

/** 홈 대시보드 "최근 코멘트" + 그 "더보기" 전체 목록 둘 다 이걸 쓴다
 * (limit만 다르게 호출). 다형 대상이라 더 이상 단일 join으로 제목을
 * 못 구해서, targetType별로 조회를 나눈다. */
export async function listRecentComments(projectId: string, limit = 5): Promise<RecentComment[]> {
  const db = getDb();
  const rows = await db.comment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const results: RecentComment[] = [];
  for (const r of rows) {
    let targetLabel = r.targetKey;
    if (r.targetType === "document") {
      const doc = await getDocument(r.targetKey);
      if (doc) targetLabel = doc.title;
    } else if (r.targetType === "kanbanCard") {
      const card = await getKanbanCardByTrackingCode(r.targetKey);
      if (card) targetLabel = card.title;
    }
    results.push({ ...r, targetLabel });
  }
  return results;
}
