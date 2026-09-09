import { getLocalDb, nowIso } from "./localdb.js";
import { loadConfig } from "./config.js";
import { buildConnectionUrl, connectServiceClient, type ServiceClient } from "./servicedb.js";

// SP-00003 2절 문서 단위 코멘트 - docs/PROTOCOL.md의 공식 답변 대기(RP)와
// 별개인 비공식 토론용, 마크다운 파일에는 쓰지 않는다(SP-00001 2절).
// `db.enabled`가 꺼져 있으면 로컬 SQLite(localdb.ts)에, 켜져 있으면
// 서비스 DB(servicedb.ts, SP-00001 6절)에 저장 - 코멘트는 캐시가 아니라
// 원본 데이터라 이 스위치는 `docs db enable`/`disable`(dbmigrate.ts)로만
// 바뀐다(설정 파일 직접 수정 금지).

export interface Comment {
  id: number;
  doc_path: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

let cachedServiceClient: ServiceClient | null = null;
let cachedServiceUrl: string | null = null;

async function getServiceClientIfEnabled(): Promise<ServiceClient | null> {
  const config = loadConfig();
  if (!config.db.enabled || !config.db.connection) return null;
  const url = buildConnectionUrl(config.db.driver, config.db.connection);
  if (cachedServiceClient && cachedServiceUrl === url) return cachedServiceClient;
  if (cachedServiceClient) await cachedServiceClient.$disconnect();
  cachedServiceClient = await connectServiceClient(config.db.driver, url);
  cachedServiceUrl = url;
  return cachedServiceClient;
}

function rowToComment(r: { id: number; docPath: string; body: string; createdAt: string; resolvedAt: string | null }): Comment {
  return { id: r.id, doc_path: r.docPath, body: r.body, created_at: r.createdAt, resolved_at: r.resolvedAt };
}

export async function listComments(docPath: string): Promise<Comment[]> {
  const service = await getServiceClientIfEnabled();
  if (service) {
    const rows = await service.docComment.findMany({ where: { docPath }, orderBy: { id: "asc" } });
    return rows.map(rowToComment);
  }
  const stmt = getLocalDb().prepare(
    "SELECT id, doc_path, body, created_at, resolved_at FROM doc_comments WHERE doc_path = ? ORDER BY id",
  );
  return stmt.all(docPath) as unknown as Comment[];
}

export async function addComment(docPath: string, body: string): Promise<number> {
  const service = await getServiceClientIfEnabled();
  const createdAt = nowIso();
  if (service) {
    const row = await service.docComment.create({ data: { docPath, body, createdAt, resolvedAt: null } });
    return row.id;
  }
  const stmt = getLocalDb().prepare(
    "INSERT INTO doc_comments (doc_path, body, created_at) VALUES (?, ?, ?)",
  );
  const info = stmt.run(docPath, body, createdAt);
  return Number(info.lastInsertRowid);
}

export async function resolveComment(docPath: string, commentId: number): Promise<void> {
  const service = await getServiceClientIfEnabled();
  if (service) {
    await service.docComment.update({ where: { id: commentId }, data: { resolvedAt: nowIso() } });
    return;
  }
  const stmt = getLocalDb().prepare(
    "UPDATE doc_comments SET resolved_at = ? WHERE id = ? AND doc_path = ?",
  );
  stmt.run(nowIso(), commentId, docPath);
}
