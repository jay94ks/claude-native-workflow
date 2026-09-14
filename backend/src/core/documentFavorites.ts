import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";
import type { DocumentSummary, DocumentSortKey } from "./documents.js";

// 문서 "즐겨찾기" - 폴더(folders.ts)와 같은 설계자 개인 소유 패턴
// ((document, user)당 최대 한 행)이지만 계층 구조가 없는 단순 토글이라
// 별도 모듈로 둔다. AI(CLI/MCP)는 이 개념을 모른다 - 웹 전용
// (#document-favorites).

interface DocRowWithStatus {
  id: string;
  trackingCode: string;
  projectId: string;
  docTypeId: string;
  title: string;
  statusId: string;
  status: { code: string };
  priority: number | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
function toSummary(row: DocRowWithStatus): DocumentSummary {
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    statusId: row.statusId,
    statusCode: row.status.code,
    priority: row.priority,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
function orderByForSort(sort: DocumentSortKey) {
  return sort === "createdAt:asc" ? { createdAt: "asc" as const } : sort === "updatedAt:desc" ? { updatedAt: "desc" as const } : { createdAt: "desc" as const };
}

/** 문서 자신에 대한 읽기 권한은 호출부(server.ts)가 이미
 * resolveEffectivePermission으로 확인했다고 가정한다(folders.ts의
 * moveDocumentToFolder와 같은 원칙 - 즐겨찾기 등록도 문서 내용을 안
 * 바꾸는 순수 개인 메타데이터라 write는 요구 안 함). */
export async function isDocumentFavorited(trackingCode: string, userId: string): Promise<boolean> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const row = await db.documentFavorite.findUnique({ where: { documentId_userId: { documentId: document.id, userId } } });
  return !!row;
}

export async function setDocumentFavorite(trackingCode: string, userId: string, favorited: boolean): Promise<void> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  if (favorited) {
    await db.documentFavorite.upsert({
      where: { documentId_userId: { documentId: document.id, userId } },
      create: { documentId: document.id, userId },
      update: {},
    });
  } else {
    await db.documentFavorite.deleteMany({ where: { documentId: document.id, userId } });
  }
}

/** 프로젝트 홈 "즐겨찾기한 문서" 섹션 + 전용 페이지("더보기")가 공유 -
 * listFolderDocumentsPaged()와 같은 DocumentSummary 페이지네이션 모양. */
export async function listFavoriteDocumentsPaged(
  projectId: string,
  userId: string,
  page: number,
  pageSize: number,
  sort: DocumentSortKey = "createdAt:desc",
): Promise<Page<DocumentSummary>> {
  const db = getDb();
  const where = { userId, document: { projectId } };
  const orderBy = { document: orderByForSort(sort) };
  const result = await paginate<{ document: DocRowWithStatus }>(
    (args) => db.documentFavorite.findMany({ where, include: { document: { include: { status: true } } }, orderBy, ...args }),
    () => db.documentFavorite.count({ where }),
    page,
    pageSize,
  );
  return { ...result, items: result.items.map((r) => toSummary(r.document)) };
}
