import crypto from "node:crypto";
import { MeiliSearch, MeiliSearchApiError, type Task } from "meilisearch";

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
const SOURCE_FILES_INDEX = "sourceFiles";

// 검색 결과 스니펫에 매치 구간을 표시하되, 그 내용이 임의의 소스
// 코드(리터럴 <script>/<img onerror=...> 텍스트일 수 있음)라 절대
// v-html로 안전하지 않다 - 그래서 <mark> 같은 HTML 태그 대신 일반
// 텍스트에 나타날 일이 없는 제어 문자 한 쌍을 구분자로 쓴다.
// 프런트엔드는 이 두 문자로 문자열을 쪼개 각 조각을 텍스트 노드로만
// 렌더링하고, 구분자 사이 조각만 <mark>로 감싼다(v-html 전혀 안 씀).
export const SNIPPET_HIGHLIGHT_START = "";
export const SNIPPET_HIGHLIGHT_END = "";

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
  priority: number | null;
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
  await index.updateFilterableAttributes(["projectId", "docTypeId", "statusId", "statusCode", "priority"]);
  await index.updateSortableAttributes(["createdAt", "updatedAt", "priority"]);

  const sourceIndex = meili().index(SOURCE_FILES_INDEX);
  await meili().createIndex(SOURCE_FILES_INDEX, { primaryKey: "id" }).catch(() => {});
  await sourceIndex.updateFilterableAttributes(["projectId"]);
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
//
// waitTask()는 실패한 태스크에도 그냥 resolve한다(throw 안 함 - SDK가
// 보장하는 건 "처리가 끝날 때까지 기다린다"이지 "성공했다"가 아니다) -
// 반환값을 확인 안 하고 버리면 색인 쓰기가 조용히 실패해도 호출부는
// 성공한 줄 안다(소스 코드 색인 기능 추가 중 실제로 이렇게
// 겪었다 - 잘못된 문서 id 형식으로 매 쓰기가 계속 실패했는데 아무
// 에러도 안 나서 한참 헤맴). 그래서 모든 waitTask() 뒤에 이 함수로
// status를 확인한다.
function assertTaskSucceeded(task: Task): void {
  if (task.status !== "succeeded") {
    throw new Error(`Meilisearch 색인 작업 실패(status=${task.status}): ${JSON.stringify(task.error)}`);
  }
}

export async function indexSyncUpsert(doc: SearchableDocument): Promise<void> {
  assertTaskSucceeded(await meili().index(DOCUMENTS_INDEX).addDocuments([doc]).waitTask());
}

export async function indexSyncDelete(trackingCode: string): Promise<void> {
  assertTaskSucceeded(await meili().index(DOCUMENTS_INDEX).deleteDocument(trackingCode).waitTask());
}

export async function getDocumentFromIndex(trackingCode: string): Promise<SearchableDocument | null> {
  try {
    return (await meili().index(DOCUMENTS_INDEX).getDocument(trackingCode)) as SearchableDocument;
  } catch (err) {
    // Meilisearch가 응답은 했지만 진짜 404인 경우만 "못 찾음"으로 본다 -
    // 그 외(연결 실패 등 MeiliSearchRequestError)를 여기서 삼키면
    // "검색 엔진에 연결할 수 없다"가 "문서가 없다"로 둔갑해버린다(실제
    // 버그였음 - #meilisearch-spof 조사로 발견).
    if (err instanceof MeiliSearchApiError && err.response.status === 404) return null;
    throw err;
  }
}

export interface SearchOptions {
  projectId?: string;
  /** 여러 프로젝트를 한 번에(다중 스코프 검색 - 그룹/팀) - projectId와
   * 함께 오면 둘 다 AND로 적용되지만, 호출부는 보통 둘 중 하나만 쓴다. */
  projectIds?: string[];
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
  if (opts.projectIds && opts.projectIds.length > 0) {
    filters.push(`projectId IN [${opts.projectIds.map((id) => `"${id}"`).join(", ")}]`);
  }
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

// searchProjectDocuments()(CLI/MCP `docs search`)의 페이지네이션
// 변형 - Meilisearch가 이미 limit/offset을 받으므로 새 DB 쿼리 없이
// rawSearch()를 그대로 연결만 한다.
export { rawSearch as rawSearchDocuments };

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

// ---------------------------------------------------------------- 사이드바 다중 스코프 검색(웹 전용) - 스니펫 포함

export interface DocumentSnippetHit {
  trackingCode: string;
  projectId: string;
  title: string;
  statusCode: string;
  snippet: string;
}

/** 사이드바 검색 결과 전용 - 문서 본문 전체가 아니라 매치 주변만 잘라
 * 반환한다(여러 프로젝트를 넘나드는 결과라 payload를 작게 유지). 하이라이트
 * 구분자는 <mark>가 아니라 SNIPPET_HIGHLIGHT_START/END 제어 문자 - 문서
 * 본문도 결국 사람이 쓴 마크다운이라 원칙적으론 안전하지만, 소스 코드
 * 검색과 응답 형태를 통일해 프런트엔드가 하나의 렌더링 로직만 쓰게 한다. */
export async function searchDocumentsWithSnippets(query: string, opts: SearchOptions = {}): Promise<DocumentSnippetHit[]> {
  const res = await meili()
    .index(DOCUMENTS_INDEX)
    .search(query, {
      filter: buildFilter(opts),
      limit: opts.limit ?? 20,
      attributesToCrop: ["body"],
      cropLength: 40,
      attributesToHighlight: ["body"],
      highlightPreTag: SNIPPET_HIGHLIGHT_START,
      highlightPostTag: SNIPPET_HIGHLIGHT_END,
    });
  return (res.hits as (SearchableDocument & { _formatted?: { body?: string } })[]).map((hit) => ({
    trackingCode: hit.trackingCode,
    projectId: hit.projectId,
    title: hit.title,
    statusCode: hit.statusCode,
    snippet: hit._formatted?.body ?? "",
  }));
}

// ---------------------------------------------------------------- 소스 파일 색인(웹 전용) - core/sourceIndex.ts가 이 함수들을 조합해서 씀

export interface SearchableSourceFile {
  id: string; // sourceFileId(projectId, path) - Meilisearch primary key
  projectId: string;
  path: string;
  content: string;
  updatedAt: number; // epoch ms
}

// Meilisearch 문서 id는 영숫자/하이픈/언더스코어만 허용한다(":"나 "/"는
// 안 됨) - 파일 경로는 거의 항상 "/"를 포함하므로 그대로 못 쓴다. 경로를
// 해시로 바꿔 projectId와 언더스코어로 합치면 경로에 어떤 문자가 와도
// 항상 안전하다(실측으로 발견 - "<projectId>:<path>"를 그대로 썼더니
// Meilisearch가 매 upsert를 invalid_document_id로 조용히 실패시켰다,
// waitTask()가 실패해도 throw하지 않는 것과 맞물려 한참 못 알아챔).
export function sourceFileId(projectId: string, path: string): string {
  const hash = crypto.createHash("sha1").update(path).digest("hex");
  return `${projectId}_${hash}`;
}

export async function indexSourceFileUpsert(doc: SearchableSourceFile): Promise<void> {
  assertTaskSucceeded(await meili().index(SOURCE_FILES_INDEX).addDocuments([doc]).waitTask());
}

/** 백필/푸시 증분 동기화처럼 여러 파일을 한 번에 넣을 때 - addDocuments
 * 한 번 호출 + waitTask 한 번으로 묶어서, 파일마다 개별 upsert보다
 * 훨씬 빠르다. */
export async function indexSourceFilesBulkUpsert(docs: SearchableSourceFile[]): Promise<void> {
  if (docs.length === 0) return;
  assertTaskSucceeded(await meili().index(SOURCE_FILES_INDEX).addDocuments(docs).waitTask());
}

export async function indexSourceFileDelete(projectId: string, path: string): Promise<void> {
  assertTaskSucceeded(await meili().index(SOURCE_FILES_INDEX).deleteDocument(sourceFileId(projectId, path)).waitTask());
}

export async function indexSourceFilesBulkDelete(projectId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  assertTaskSucceeded(
    await meili()
      .index(SOURCE_FILES_INDEX)
      .deleteDocuments(paths.map((p) => sourceFileId(projectId, p)))
      .waitTask(),
  );
}

/** 저장소를 새로 연결했을 때 그 프로젝트의 이전 색인을 깨끗이 비운다 -
 * 재연결(다른 저장소로 바뀌는 경우)에 대비한 안전장치. */
export async function clearSourceFileIndexForProject(projectId: string): Promise<void> {
  assertTaskSucceeded(
    await meili()
      .index(SOURCE_FILES_INDEX)
      .deleteDocuments({ filter: `projectId = "${projectId}"` })
      .waitTask(),
  );
}

export interface SourceFileSnippetHit {
  projectId: string;
  path: string;
  snippet: string;
}

export async function searchSourceFiles(query: string, opts: { projectIds: string[]; limit?: number }): Promise<SourceFileSnippetHit[]> {
  if (opts.projectIds.length === 0) return [];
  const res = await meili()
    .index(SOURCE_FILES_INDEX)
    .search(query, {
      filter: `projectId IN [${opts.projectIds.map((id) => `"${id}"`).join(", ")}]`,
      limit: opts.limit ?? 20,
      attributesToCrop: ["content"],
      cropLength: 40,
      attributesToHighlight: ["content"],
      highlightPreTag: SNIPPET_HIGHLIGHT_START,
      highlightPostTag: SNIPPET_HIGHLIGHT_END,
    });
  return (res.hits as (SearchableSourceFile & { _formatted?: { content?: string } })[]).map((hit) => ({
    projectId: hit.projectId,
    path: hit.path,
    snippet: hit._formatted?.content ?? "",
  }));
}
