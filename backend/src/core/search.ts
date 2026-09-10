import { MeiliSearch } from "meilisearch";

// 클로드가 호출하는 모든 조회 경로(get/list/tree/pending/search 등)는
// DB를 직접 안 타고 이 검색 엔진을 거친다(설계자 지시) - Document는
// write-through로 여기 인덱스에 동기화된 사본을 쓴다. write(C/U/D)가
// 일어날 때마다 indexSync()를 호출하는 걸 빠뜨리면 검색 결과가 DB와
// 어긋나므로, core의 모든 쓰기 경로가 반드시 이 헬퍼 하나로 통일해서
// 부른다(개별 write 경로마다 따로 인덱싱 코드를 쓰지 않음).

let client: MeiliSearch | null = null;

function meili(): MeiliSearch {
  if (!client) {
    const host = process.env.MEILISEARCH_HOST;
    const apiKey = process.env.MEILISEARCH_API_KEY;
    if (!host) throw new Error("MEILISEARCH_HOST 환경변수가 필요합니다");
    client = new MeiliSearch({ host, apiKey });
  }
  return client;
}

const DOCUMENTS_INDEX = "documents";

// trackingCode를 Meilisearch의 primary key로 그대로 쓴다 - 호출부(CLI/
// MCP/API)가 문서를 가리킬 때 항상 trackingCode를 쓰므로, "get by
// trackingCode"가 필터 검색이 아니라 바로 단건 조회(getDocument)가
// 된다. 내부 id(cuid)는 DB 쪽 FK/조인용으로 필드에 같이 실어둔다.
export interface SearchableDocument {
  trackingCode: string; // Meilisearch primary key
  id: string; // Document.id
  projectId: string;
  docTypeId: string;
  title: string;
  body: string;
  statusId: string;
  statusCode: string;
  createdBy: string;
  createdAt: number; // epoch ms - Meilisearch 정렬/필터용
  updatedAt: number;
}

export async function ensureSearchIndexes(): Promise<void> {
  const index = meili().index(DOCUMENTS_INDEX);
  await meili().createIndex(DOCUMENTS_INDEX, { primaryKey: "trackingCode" }).catch(() => {
    // 이미 있으면 무시 - createIndex는 존재해도 에러 안 내는 버전도 있지만
    // 버전 차이를 신경 안 쓰려고 방어적으로 catch.
  });
  await index.updateFilterableAttributes(["projectId", "docTypeId", "statusId", "statusCode"]);
  await index.updateSortableAttributes(["createdAt", "updatedAt"]);
}

export async function indexSyncUpsert(doc: SearchableDocument): Promise<void> {
  await meili().index(DOCUMENTS_INDEX).addDocuments([doc]);
}

export async function indexSyncDelete(trackingCode: string): Promise<void> {
  await meili().index(DOCUMENTS_INDEX).deleteDocument(trackingCode);
}

export async function getDocumentFromIndex(trackingCode: string): Promise<SearchableDocument | null> {
  try {
    return (await meili().index(DOCUMENTS_INDEX).getDocument(trackingCode)) as SearchableDocument;
  } catch {
    return null; // 404 등 - 못 찾음
  }
}

export interface SearchOptions {
  projectId?: string;
  docTypeId?: string;
  statusCode?: string;
  limit?: number;
}

export async function searchDocuments(query: string, opts: SearchOptions = {}): Promise<SearchableDocument[]> {
  const filters: string[] = [];
  if (opts.projectId) filters.push(`projectId = "${opts.projectId}"`);
  if (opts.docTypeId) filters.push(`docTypeId = "${opts.docTypeId}"`);
  if (opts.statusCode) filters.push(`statusCode = "${opts.statusCode}"`);
  const res = await meili()
    .index(DOCUMENTS_INDEX)
    .search(query, {
      filter: filters.length ? filters.join(" AND ") : undefined,
      limit: opts.limit ?? 50,
    });
  return res.hits as SearchableDocument[];
}

/** query 없이 필터/정렬만으로 목록을 가져올 때 쓴다(get/list/tree류) -
 * 빈 문자열 검색은 Meilisearch에서 "필터만 적용, 관련도 정렬 없음"으로
 * 동작한다. */
export async function listDocumentsFromIndex(opts: SearchOptions = {}): Promise<SearchableDocument[]> {
  return searchDocuments("", opts);
}
