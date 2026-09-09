import { getLocalDb, nowIso } from "./localdb.js";

// SP-00003 2절 문서 단위 코멘트 - docs/PROTOCOL.md의 공식 답변 대기(RP)와
// 별개인 비공식 토론용, 마크다운 파일에는 쓰지 않는다(SP-00001 2절).
// db.enabled가 꺼진 기본 상태에서는 여기(로컬 SQLite)에 저장 - db.enabled를
// 켜는 서비스 DB 이관은 PL-00001 2단계 8번에서 다룬다.

export interface Comment {
  id: number;
  doc_path: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

export function listComments(docPath: string): Comment[] {
  const stmt = getLocalDb().prepare(
    "SELECT id, doc_path, body, created_at, resolved_at FROM doc_comments WHERE doc_path = ? ORDER BY id",
  );
  return stmt.all(docPath) as unknown as Comment[];
}

export function addComment(docPath: string, body: string): number {
  const stmt = getLocalDb().prepare(
    "INSERT INTO doc_comments (doc_path, body, created_at) VALUES (?, ?, ?)",
  );
  const info = stmt.run(docPath, body, nowIso());
  return Number(info.lastInsertRowid);
}

export function resolveComment(docPath: string, commentId: number): void {
  const stmt = getLocalDb().prepare(
    "UPDATE doc_comments SET resolved_at = ? WHERE id = ? AND doc_path = ?",
  );
  stmt.run(nowIso(), commentId, docPath);
}
