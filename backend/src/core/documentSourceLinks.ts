import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";

// 문서 ↔ "연관된 소스코드" 파일 경로 - git 저장소 루트 기준 상대 경로
// 문자열만 저장한다(Gitea에 그 경로가 실제 존재하는지는 검증하지 않음 -
// 순수 연관 관계). 코멘트/폴더와 달리 AI가 수정 작업과 직접 관련된
// 신호라 CLI/MCP에도 노출된다(완전성 원칙 - server.ts/cli/index.ts/
// mcp/server.ts 전부 참고).

export interface SourceLinkDetail {
  id: string;
  filePath: string;
  createdBy: string;
  createdAt: Date;
}

export async function addSourceLink(trackingCode: string, filePath: string, userId: string): Promise<SourceLinkDetail> {
  const trimmed = filePath.trim();
  if (!trimmed) throw new Error("filePath가 필요합니다");
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  const existing = await db.documentSourceLink.findFirst({ where: { documentId: document.id, filePath: trimmed } });
  if (existing) throw new Error(`이미 연결된 경로입니다: ${trimmed}`);

  const row = await db.documentSourceLink.create({
    data: { documentId: document.id, filePath: trimmed, createdBy: userId },
  });
  return { id: row.id, filePath: row.filePath, createdBy: row.createdBy, createdAt: row.createdAt };
}

export async function removeSourceLink(id: string, trackingCode: string): Promise<void> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const link = await db.documentSourceLink.findUnique({ where: { id } });
  if (!link || link.documentId !== document.id) throw new Error(`연결된 소스코드 링크를 찾을 수 없습니다: ${id}`);
  await db.documentSourceLink.delete({ where: { id } });
}

export async function listSourceLinks(trackingCode: string): Promise<SourceLinkDetail[]> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const rows = await db.documentSourceLink.findMany({ where: { documentId: document.id }, orderBy: { createdAt: "asc" } });
  return rows.map((r: SourceLinkDetail) => ({ id: r.id, filePath: r.filePath, createdBy: r.createdBy, createdAt: r.createdAt }));
}

export async function listSourceLinksPaged(
  trackingCode: string,
  page: number,
  pageSize: number,
): Promise<Page<SourceLinkDetail>> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const result = await paginate<SourceLinkDetail>(
    (args) => db.documentSourceLink.findMany({ where: { documentId: document.id }, orderBy: { createdAt: "asc" }, ...args }),
    () => db.documentSourceLink.count({ where: { documentId: document.id } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((r: SourceLinkDetail) => ({ id: r.id, filePath: r.filePath, createdBy: r.createdBy, createdAt: r.createdAt })),
  };
}
