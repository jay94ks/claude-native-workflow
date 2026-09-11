import { getDb } from "./db.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";

export interface CommentDetail {
  id: string;
  trackingCode: string;
  body: string;
  authorId: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export async function addComment(
  projectId: string,
  trackingCode: string,
  body: string,
  authorId: string,
): Promise<CommentDetail> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`대상 문서를 찾을 수 없습니다: ${trackingCode}`);

  const row = await db.comment.create({ data: { projectId, trackingCode, body, authorId } });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "comment",
    action: "create",
    id: row.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return {
    id: row.id,
    trackingCode: row.trackingCode,
    body: row.body,
    authorId: row.authorId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export async function listComments(trackingCode: string): Promise<CommentDetail[]> {
  const db = getDb();
  const rows = await db.comment.findMany({ where: { trackingCode }, orderBy: { createdAt: "asc" } });
  return rows.map((r: CommentDetail) => ({
    id: r.id,
    trackingCode: r.trackingCode,
    body: r.body,
    authorId: r.authorId,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));
}

export interface RecentComment extends CommentDetail {
  documentTitle: string;
}

/** 홈 대시보드 "최근 코멘트" + 그 "더보기" 전체 목록 둘 다 이걸 쓴다
 * (limit만 다르게 호출) - Comment가 이미 projectId를 갖고 있어(문서
 * 경유 없이) 프로젝트 전체 조회가 바로 된다. */
export async function listRecentComments(projectId: string, limit = 5): Promise<RecentComment[]> {
  const db = getDb();
  const rows = await db.comment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { document: true },
  });
  return rows.map((r: CommentDetail & { document: { title: string } }) => ({
    id: r.id,
    trackingCode: r.trackingCode,
    body: r.body,
    authorId: r.authorId,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    documentTitle: r.document.title,
  }));
}

export async function resolveComment(id: string, projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.comment.findUnique({ where: { id } });
  if (!row || row.projectId !== projectId) {
    throw new Error(`코멘트를 찾을 수 없습니다: ${id}`);
  }
  await db.comment.update({ where: { id }, data: { resolvedAt: new Date() } });

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "comment",
    action: "update",
    id,
    trackingCode: row.trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}
