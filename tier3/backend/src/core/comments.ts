import { getDb } from "./db.js";

// SP-00002 8절: "doc_comments.project_id로 프로젝트별로 분리된다" - 모든
// Tier 3 프로젝트가 하나의 공유 서비스 DB를 쓴다(프로젝트별 DB 커넥션이
// 아님). tier2-backend의 core/comments.ts는 정반대로 "docs/.config.json의
// db.enabled 토글에 따라 로컬 SQLite 또는 서비스 DB"를 고르는 프로젝트별
// 설계라 여기서는 재사용하지 않는다 - Tier 3는 그 토글 개념 자체가 없고
// (서버 기동 시 한 번 연결해서 항상 켜져 있음, core/db.ts), 대신 매
// 호출마다 project_id로 걸러야 한다는 게 근본적으로 다른 부분.

export interface Comment {
  id: number;
  doc_path: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

export async function listComments(projectId: string, docPath: string): Promise<Comment[]> {
  const rows = await getDb().docComment.findMany({
    where: { projectId, docPath },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({ id: r.id, doc_path: r.docPath, body: r.body, created_at: r.createdAt, resolved_at: r.resolvedAt }));
}

export async function addComment(projectId: string, docPath: string, body: string): Promise<number> {
  const row = await getDb().docComment.create({
    data: { projectId, docPath, body, createdAt: new Date().toISOString(), resolvedAt: null },
  });
  return row.id;
}

export async function resolveComment(projectId: string, docPath: string, id: number): Promise<void> {
  await getDb().docComment.updateMany({
    where: { id, projectId, docPath },
    data: { resolvedAt: new Date().toISOString() },
  });
}
