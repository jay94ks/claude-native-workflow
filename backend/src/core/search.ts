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

// meilisearch SDK의 addDocuments()/deleteDocument()는 "큐에 들어갔다"는
// 응답만 오면 바로 resolve되는 EnqueuedTaskPromise를 반환한다 - 이 값
// 자체를 await해도 Meilisearch가 실제로 색인을 끝냈다는 보장이 없다
// (실측으로 발견: 문서를 만든 직후 같은 요청 흐름 안에서 바로 그
// 문서를 대상으로 링크를 걸면 "not found"로 실패하는 경합 - 가이디드
// 마이그레이션처럼 생성을 쉼 없이 연달아 호출하는 경로에서 특히 잘
// 드러남). SDK가 각 EnqueuedTaskPromise에 실어주는 `.waitTask()`로
// 실제 처리 완료까지 기다려야 "쓰기 직후 바로 읽어도 항상 보인다"는
// write-through 설계 원칙이 이름값을 한다.
export async function indexSyncUpsert(doc: SearchableDocument): Promise<void> {
  await meili().index(DOCUMENTS_INDEX).addDocuments([doc]).waitTask();
}

export async function indexSyncDelete(trackingCode: string): Promise<void> {
  await meili().index(DOCUMENTS_INDEX).deleteDocument(trackingCode).waitTask();
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
  /** offset 기반 페이지네이션 - Meilisearch의 estimatedTotalHits와
   * 함께 쓴다(listDocumentsFromIndexPaged 참고). */
  offset?: number;
  /** 예: ["updatedAt:desc"] - ensureSearchIndexes()가 등록한 sortable
   * 속성(createdAt/updatedAt)만 쓸 수 있다. */
  sort?: string[];
}

export interface SearchPage {
  hits: SearchableDocument[];
  total: number;
}

function buildFilter(opts: SearchOptions): string | undefined {
  const filters: string[] = [];
  if (opts.projectId) filters.push(`projectId = "${opts.projectId}"`);
  if (opts.docTypeId) filters.push(`docTypeId = "${opts.docTypeId}"`);
  if (opts.statusCode) filters.push(`statusCode = "${opts.statusCode}"`);
  return filters.length ? filters.join(" AND ") : undefined;
}

async function rawSearch(query: string, opts: SearchOptions = {}): Promise<SearchPage> {
  const res = await meili()
    .index(DOCUMENTS_INDEX)
    .search(query, {
      filter: buildFilter(opts),
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      sort: opts.sort,
    });
  return { hits: res.hits as SearchableDocument[], total: res.estimatedTotalHits ?? res.hits.length };
}

export async function searchDocuments(query: string, opts: SearchOptions = {}): Promise<SearchableDocument[]> {
  return (await rawSearch(query, opts)).hits;
}

/** query 없이 필터/정렬만으로 목록을 가져올 때 쓴다(get/list/tree류) -
 * 빈 문자열 검색은 Meilisearch에서 "필터만 적용, 관련도 정렬 없음"으로
 * 동작한다. */
export async function listDocumentsFromIndex(opts: SearchOptions = {}): Promise<SearchableDocument[]> {
  return searchDocuments("", opts);
}

/** 웹 전용 페이지네이션 목록 - hits와 함께 총 개수를 반환한다(CLI/MCP는
 * 여전히 배열만 주는 listDocumentsFromIndex를 그대로 쓴다). */
export async function listDocumentsFromIndexPaged(opts: SearchOptions = {}): Promise<SearchPage> {
  return rawSearch("", opts);
}
