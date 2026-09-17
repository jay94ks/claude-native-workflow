import { MeiliSearchRequestError } from "meilisearch";
import { diffLines, type Change } from "diff";
import { sliceLines, grepLines, type LinesResult, type GrepMatch, type GrepOptions } from "./textLines.js";
import * as docChapters from "./docChapters.js";
import type { ChapterInfo, ChapterInsertPosition } from "./docChapters.js";
import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { findDocTypeByCode, findDocStatusByCode, initialStatusFor, allowedNextStatuses, STANDARD_DOC_STATUSES } from "./docTypes.js";
import { indexSyncUpsert, indexSyncDelete, getDocumentFromIndex, listDocumentsFromIndex, listDocumentsFromIndexPaged, searchDocuments, rawSearchDocuments } from "./search.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { enqueueSearchSync } from "./searchSyncQueue.js";
import type { SearchableDocument } from "./search.js";
import { paginate, type Page } from "./pagination.js";

export interface DocumentDetail {
  trackingCode: string;
  projectId: string;
  docTypeId: string;
  title: string;
  body: string;
  statusId: string;
  statusCode: string;
  priority: number | null;
  createdBy: string;
  updatedAt: number;
}

function toSearchable(doc: {
  id: string;
  projectId: string;
  docTypeId: string;
  trackingCode: string;
  title: string;
  body: string;
  statusId: string;
  priority: number | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}, statusCode: string): SearchableDocument {
  return {
    trackingCode: doc.trackingCode,
    id: doc.id,
    projectId: doc.projectId,
    docTypeId: doc.docTypeId,
    title: doc.title,
    body: doc.body,
    statusId: doc.statusId,
    statusCode,
    priority: doc.priority,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.getTime(),
    updatedAt: doc.updatedAt.getTime(),
  };
}

// review/pending은 문서 상태(DocStatus.code)의 표준 어휘 - Q&A의
// Question.status에도 같은 이름 "pending"이 있지만 완전히 다른
// 개념(설계자 답변 완료 대기)이다. 여기서 검사하는 건 항상 문서 자체의
// 상태.
const PRIORITY_ALLOWED_STATUS_CODES = new Set(["review", "pending"]);

async function syncAndPublish(
  doc: SearchableDocument,
  action: "create" | "update" | "delete",
): Promise<void> {
  try {
    if (action === "delete") {
      await indexSyncDelete(doc.trackingCode);
    } else {
      await indexSyncUpsert(doc);
    }
  } catch (err) {
    // Meilisearch에 연결할 수 없을 때만 큐에 적재하고 삼킨다 - DB 커밋은
    // 이미 끝난 뒤라, 여기서 다시 던지면 이미 성공한 문서 생성/수정까지
    // 실패로 보이게 된다(#meilisearch-spof가 고치는 핵심 버그). 다른
    // 종류의 에러(예: 실제 색인 작업 실패)는 그대로 드러내야 하므로 던진다.
    if (err instanceof MeiliSearchRequestError) {
      await enqueueSearchSync(action === "delete" ? "deleteDocument" : "upsertDocument", { trackingCode: doc.trackingCode });
    } else {
      throw err;
    }
  }
  const event: ChangeEvent = {
    entity: "document",
    action,
    id: doc.id,
    trackingCode: doc.trackingCode,
    at: new Date().toISOString(),
  };
  await realtimePublish(projectChangesTopic(doc.projectId), event);
}

export interface CreateDocumentInput {
  projectId: string;
  docTypeCode: string;
  title: string;
  body: string;
  createdBy: string;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentMutationSummary> {
  const db = getDb();
  const docType = await findDocTypeByCode(input.projectId, input.docTypeCode);
  if (!docType) {
    throw new Error(`이 프로젝트에 "${input.docTypeCode}" 타입이 정의돼 있지 않습니다`);
  }
  const status = await initialStatusFor(docType.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(input.projectId, input.docTypeCode, "document", (trackingCode) =>
    db.document.create({
      data: {
        projectId: input.projectId,
        docTypeId: docType.id,
        trackingCode,
        title: input.title,
        body: input.body,
        statusId: status.id,
        createdBy: input.createdBy,
      },
    }),
  );

  const searchable = toSearchable(row, status.code);
  await syncAndPublish(searchable, "create");

  return toMutationSummary({
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.getTime(),
  });
}

/** "조회는 DB가 아니라 Meilisearch를 거친다" 원칙 - get/list/tree/search
 * 전부 이 인덱스 조회 함수들 위에서 구현된다. */
export async function getDocument(trackingCode: string): Promise<SearchableDocument | null> {
  return getDocumentFromIndex(trackingCode);
}

export interface DocumentAccessInfo {
  id: string;
  projectId: string;
  docTypeId: string;
  statusId: string;
}

/** 권한 확인 전용 최소 조회 - DB에서 직접 읽는다(검색 엔진 안
 * 거침). PUT/DELETE/전이 등 "일단 존재/권한만 확인하고 실제 작업은
 * core 함수가 따로 DB를 다시 읽어 처리하는" 라우트들이 그 사전
 * 확인에 쓴다 - 실제 문서 "조회"(GET 단건 응답 본문)는 여전히
 * getDocument()(검색 엔진 경유)를 쓴다(모든 조회는 검색 엔진을
 * 거친다는 원칙은 진짜 조회에만 적용, 이건 조회가 아니라 내부
 * 권한 게이트). 이 분리로 Meilisearch가 죽어 있어도 기존 문서의
 * 수정/삭제/전이가 막히지 않는다(#document-write-gate-bypass-search) -
 * #meilisearch-spof가 큐로 보호한 실제 쓰기 단계까지 도달 가능해짐. */
export async function getDocumentAccessInfo(trackingCode: string): Promise<DocumentAccessInfo | null> {
  const db = getDb();
  return db.document.findUnique({
    where: { trackingCode },
    select: { id: true, projectId: true, docTypeId: true, statusId: true },
  });
}

/** `list`류(목차/색인 조회)가 반환하는 가벼운 요약 - `body`가 빠진
 * `SearchableDocument`. 설계자가 실사용 중 지적 - "이 프로젝트에 어떤
 * 문서가 있는지 훑어보려는" 목적의 호출인데도 문서마다 본문 전체가
 * 그대로 실려 있어서(141개 문서 프로젝트로 실측 - 응답이 650KB,
 * 그중 본문만 316KB), 정작 무엇을 볼지 고르기도 전에 컨텍스트가 죄다
 * 본문으로 채워졌다. "훑어보고 고른 뒤 `get`/`read`/`grep`으로 필요한
 * 것만 본다"는 흐름에 맞게, 색인 조회는 처음부터 본문을 안 실어야
 * 한다(#document-list-lightweight). */
export type DocumentSummary = Omit<SearchableDocument, "body">;

function toDocumentSummary(doc: SearchableDocument): DocumentSummary {
  const { body: _body, ...summary } = doc;
  return summary;
}

/** 변형(생성/저장/전이/우선순위) 계열이 반환하는 가벼운 결과 - `body`가
 * 빠진 `DocumentDetail`. 호출자는 생성/저장이면 이미 그 본문을 알고
 * 있고, 전이/우선순위는 본문을 건드리지도 않는데도 지금까지 전부 전체
 * 본문을 그대로 돌려주고 있었다(`#document-list-lightweight`와 같은
 * 문제, MCP 호출에서는 AI 컨텍스트 낭비로 직결). "본문이 바뀌었을
 * 수도 있다"는 신호는 `updatedAt`(모든 갱신에 공통으로 존재하는 기존
 * 필드)으로 충분 - 정확히 본문만 바뀐 건지는 구분 안 하지만, 필요하면
 * 호출자가 `docs get`/`document_get`으로 이어서 조회하면 된다. */
export type DocumentMutationSummary = Omit<DocumentDetail, "body">;

function toMutationSummary(detail: DocumentDetail): DocumentMutationSummary {
  const { body: _body, ...summary } = detail;
  return summary;
}

// CLI/MCP가 "이 프로젝트의 전체 문서 목록"으로 쓰는 함수라 limit을
// 명시적으로 크게 잡아야 한다 - 안 그러면 rawSearch()의 기본값(50)이
// 조용히 적용돼, 문서가 50건을 넘는 프로젝트에서 뒤쪽 문서가 아무
// 경고 없이 목록에서 통째로 빠진다(대량 문서 QA 라운드 중 실제
// 200건 프로젝트로 재현해 발견). 1000은 Meilisearch 기본
// maxTotalHits와 같은 값 - 그 이상은 애초에 한 번에 못 받아오므로,
// total로 실제 건수를 확인해 정확히 그 상황이면(1000건보다 많음)
// 자른 채로 돌려주지 않고 명확한 에러로 거부한다(#document-list-page-required-at-scale
// - "안전한 실패"가 조용한 데이터 누락보다 낫다는 이 저장소의 일관된
// 원칙). 정확히 1000건인 흔치 않은 경우는 total도 1000이라 오탐 없이
// 그대로 전부 반환된다.
export async function listDocuments(projectId: string, docTypeId?: string, statusCode?: string): Promise<DocumentSummary[]> {
  const { hits, total } = await listDocumentsFromIndexPaged({ projectId, docTypeId, statusCode, limit: 1000, offset: 0 });
  if (total > 1000) {
    throw new Error(
      `이 프로젝트에는 문서가 ${total}건 있어 한 번에 다 조회할 수 없습니다 - ` +
        `docs list ${projectId} --page 1 --count 100처럼 --page/--count로 나눠 조회하세요.`,
    );
  }
  return hits.map(toDocumentSummary);
}

/** `docs cache sync`(로컬 문서 캐시 내보내기, `#document-cache-export`)
 * 전용 - listDocuments()와 똑같이 색인을 거치지만(본문 조회는 항상
 * Meilisearch를 거친다는 기존 원칙 유지, line 142 주석 참고) body를
 * 그대로 남긴다(toDocumentSummary로 벗기지 않음) - 캐시 파일 하나하나가
 * 본문 자체이기 때문에 이번만은 DocumentSummary가 아니라 전체가
 * 필요하다. 1000건 초과 시 에러로 거부하는 안전장치는 listDocuments와
 * 동일하게 유지.*/
export async function listDocumentsForExport(projectId: string): Promise<SearchableDocument[]> {
  const { hits, total } = await listDocumentsFromIndexPaged({ projectId, limit: 1000, offset: 0 });
  if (total > 1000) {
    throw new Error(`이 프로젝트에는 문서가 ${total}건 있어 한 번에 캐시로 내보낼 수 없습니다(최대 1000건).`);
  }
  return hits;
}

/** 홈 대시보드 "최근 변경 문서" + 그 "더보기" 전체 목록 둘 다 이걸
 * 쓴다(limit만 다르게 호출) - 변경(updatedAt) 순 정렬. */
export async function listRecentDocuments(projectId: string, limit = 5): Promise<SearchableDocument[]> {
  return searchDocuments("", { projectId, limit, sort: ["updatedAt:desc"] });
}

export interface DocStatusCount {
  code: string;
  label: string;
  count: number;
}

/** 대시보드용 - 상태 코드별 문서 수. DocStatus는 DocType마다 별도
 * 행이라(같은 "draft"라도 DocType 6개짜리 프로젝트면 DocStatus.id가
 * 6개 따로 있음) statusId가 아니라 DocStatus.code 문자열 기준으로
 * 합산해야 한다 - 안 그러면 같은 "초안"이 DocType 수만큼 쪼개져
 * 보인다. 검색 인덱스 대신 DB를 직접 findMany+집계(이 코드베이스에
 * groupBy 선례가 전혀 없어 기존 패턴을 그대로 따름 - #project-dashboard).
 * 출력 순서는 STANDARD_DOC_STATUSES 선언 순서로 고정해 매번 같은
 * 막대 순서가 나오게 한다. */
export async function countDocumentsByStatus(projectId: string): Promise<DocStatusCount[]> {
  const db = getDb();
  const rows: { statusId: string }[] = await db.document.findMany({ where: { projectId }, select: { statusId: true } });
  if (rows.length === 0) return [];
  const statusIds = [...new Set(rows.map((r) => r.statusId))];
  const statuses: { id: string; code: string; label: string }[] = await db.docStatus.findMany({
    where: { id: { in: statusIds } },
    select: { id: true, code: true, label: true },
  });
  const labelByCode = new Map(statuses.map((s) => [s.code, s.label]));
  const codeById = new Map(statuses.map((s) => [s.id, s.code]));
  const countByCode = new Map<string, number>();
  for (const r of rows) {
    const code = codeById.get(r.statusId);
    if (!code) continue;
    countByCode.set(code, (countByCode.get(code) ?? 0) + 1);
  }
  const knownOrder = STANDARD_DOC_STATUSES.map((s) => s.code);
  const orderedCodes = [...countByCode.keys()].sort((a, b) => {
    const ia = knownOrder.indexOf(a);
    const ib = knownOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return orderedCodes.map((code) => ({ code, label: labelByCode.get(code) ?? code, count: countByCode.get(code)! }));
}

export interface StaleDocumentView {
  trackingCode: string;
  title: string;
  statusCode: string;
  updatedAt: number;
}

/** 대시보드용 - 종료 상태(isTerminal:true, 표준상 "archived"만)가
 * 아니면서 staleDays일 넘게 안 건드려진 문서. 검색 인덱스를 거치지
 * 않고 DB를 직접 조회한다(isTerminal 조인 + updatedAt 범위 조건은
 * 검색 인덱스가 다루는 대상이 아님 - getDocumentAccessInfo와 같은
 * "내부 게이트/집계, 진짜 조회 아님" 성격). */
export async function listStaleDocuments(projectId: string, staleDays = 14, limit = 10): Promise<StaleDocumentView[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const rows: { trackingCode: string; title: string; updatedAt: Date; status: { code: string } }[] = await db.document.findMany({
    where: { projectId, updatedAt: { lt: cutoff }, status: { isTerminal: false } },
    include: { status: { select: { code: true } } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  return rows.map((r) => ({ trackingCode: r.trackingCode, title: r.title, statusCode: r.status.code, updatedAt: r.updatedAt.getTime() }));
}

// 검색 결과는 본문을 그대로 다 담아서(SearchableDocument.body) 돌려주는데,
// 히트가 여러 건이면 그게 그대로 쌓여 읽지도 않을 본문까지 응답에 끌고
// 오는 경우가 많다(#search-lines-limit, 설계자 지시 - "search 명령에도
// ... 라인 갯수를 제한하는 옵션"). linesLimit을 주면 각 히트의 body를
// sliceLines()로 앞 N줄만 남기고, 실제로 잘렸으면 bodyTruncated:true를
// 얹는다(호출부가 "이 본문은 더 있다"는 걸 구분할 수 있게).
function truncateHitBody(doc: SearchableDocument, linesLimit?: number): SearchableDocument & { bodyTruncated?: boolean } {
  if (!linesLimit || linesLimit <= 0) return doc;
  const { lines, totalLines } = sliceLines(doc.body, 1, linesLimit);
  if (totalLines <= linesLimit) return doc;
  return { ...doc, body: lines.join("\n"), bodyTruncated: true };
}

export async function searchProjectDocuments(
  projectId: string,
  query: string,
  linesLimit?: number,
): Promise<SearchableDocument[]> {
  const hits = await searchDocuments(query, { projectId });
  return hits.map((h) => truncateHitBody(h, linesLimit));
}

export async function searchProjectDocumentsPaged(
  projectId: string,
  query: string,
  page: number,
  pageSize: number,
  linesLimit?: number,
): Promise<Page<SearchableDocument>> {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.max(1, Math.trunc(pageSize) || 20);
  const { hits, total } = await rawSearchDocuments(query, { projectId, limit: safeSize, offset: (safePage - 1) * safeSize });
  return {
    items: hits.map((h) => truncateHitBody(h, linesLimit)),
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export interface DocumentPage {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type DocumentSortKey = "createdAt:desc" | "createdAt:asc" | "updatedAt:desc";
const DEFAULT_DOCUMENT_SORT: DocumentSortKey = "createdAt:desc";

/** 웹 문서 목록 화면 전용(요청 4번 페이지네이션) - 정렬 없이 페이지를
 * 넘기면 Meilisearch가 페이지마다 다른 순서를 줄 수 있어 항상 명시
 * 정렬을 건다(기본 createdAt:desc = "최신순"). "리스트"/"폴더" 탭의
 * 정렬 콤보박스(최신순/최근 수정순/오래된 순, #documents-tab-redesign)
 * 가 그대로 이 값을 넘긴다. CLI/MCP가 쓰는 listDocuments()와 마찬가지로
 * 본문은 뺀 요약만 반환한다. */
export async function listDocumentsPaged(
  projectId: string,
  docTypeId: string | undefined,
  page: number,
  pageSize: number,
  statusCode?: string,
  sort: DocumentSortKey = DEFAULT_DOCUMENT_SORT,
): Promise<DocumentPage> {
  const safePage = Math.max(1, page);
  const { hits, total } = await listDocumentsFromIndexPaged({
    projectId,
    docTypeId,
    statusCode,
    limit: pageSize,
    offset: (safePage - 1) * pageSize,
    sort: [sort],
  });
  return {
    items: hits.map(toDocumentSummary),
    page: safePage,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface DocumentRevisionSummary {
  id: string;
  body: string;
  editedBy: string;
  editedAt: string;
}

// saveDocumentBody()가 수정 직전 스냅샷을 매번 여기 쌓아왔다(Phase 0부터) -
// 지금까지 조회 API가 없었다. 가장 최신 상태는 이 테이블이 아니라
// Document.body 자체이므로(리비전 = "그 시점까지의" 스냅샷), 호출부가
// 현재 본문(GET /api/documents/:trackingCode)과 합쳐서 타임라인을 구성한다.
export async function listDocumentRevisions(trackingCode: string): Promise<DocumentRevisionSummary[]> {
  const db = getDb();
  const doc = await db.document.findUnique({ where: { trackingCode } });
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const revisions = await db.documentRevision.findMany({
    where: { documentId: doc.id },
    orderBy: { editedAt: "asc" },
  });
  return (revisions as { id: string; body: string; editedBy: string; editedAt: Date }[]).map((r) => ({
    id: r.id,
    body: r.body,
    editedBy: r.editedBy,
    editedAt: r.editedAt.toISOString(),
  }));
}

export async function listDocumentRevisionsPaged(
  trackingCode: string,
  page: number,
  pageSize: number,
): Promise<Page<DocumentRevisionSummary>> {
  const db = getDb();
  const doc = await db.document.findUnique({ where: { trackingCode } });
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const result = await paginate(
    (args) => db.documentRevision.findMany({ where: { documentId: doc.id }, orderBy: { editedAt: "asc" }, ...args }),
    () => db.documentRevision.count({ where: { documentId: doc.id } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: (result.items as { id: string; body: string; editedBy: string; editedAt: Date }[]).map((r) => ({
      id: r.id,
      body: r.body,
      editedBy: r.editedBy,
      editedAt: r.editedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------- 부분 읽기/검색/비교
// 큰 문서(예: 이 저장소 자신을 이주하며 만든 DN 문서들)를 매번 전체
// 본문으로 컨텍스트에 올리지 않아도 되도록 - Read/Grep 도구가 파일에
// 대해 하는 것과 같은 일을 문서 본문에 대해 한다. 셋 다 getDocument()
// (검색 엔진 경유 - "모든 조회는 검색 엔진을 거친다" 원칙)로 이미 가져온
// 본문 위에서 순수하게 문자열만 다루는 후처리라, 이 원칙을 우회하는
// 별도 조회 경로가 아니다.

export type DocumentLinesResult = LinesResult;

/** offset(1부터)부터 최대 limit줄 - 둘 다 생략하면 처음부터 2000줄
 * (Read 도구의 offset/limit 관례와 동일). */
export async function readDocumentLines(trackingCode: string, offset?: number, limit?: number): Promise<DocumentLinesResult> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  return sliceLines(doc.body, offset, limit);
}

export type DocumentGrepMatch = GrepMatch;
export type DocumentGrepOptions = GrepOptions;

/** POSIX ERE(#posix-regex-parser, core/posixRegex.ts) 패턴으로 본문을
 * 줄 단위 검색한다 - Grep 도구의 "content" 출력 모드와 같은 모양
 * (줄 번호+텍스트). 패턴이 실제로 잘못됐으면 에러를 던진다. */
export async function grepDocument(trackingCode: string, pattern: string, opts: DocumentGrepOptions = {}): Promise<DocumentGrepMatch[]> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  return grepLines(doc.body, pattern, opts);
}

export interface DocumentDiffResult {
  from: string;
  to: string;
  changes: Change[];
}

/** revisionId 하나 또는 리터럴 "current"(지금 저장된 본문)를 받아 두
 * 시점의 본문을 줄 단위로 비교한다 - `diff` 라이브러리(jsdiff)의
 * diffLines 결과를 그대로 반환(added/removed/value로 이미 구조화돼
 * 있어 그대로 렌더링하기 좋음). */
export async function diffDocument(trackingCode: string, from: string, to: string): Promise<DocumentDiffResult> {
  const db = getDb();
  const doc = await db.document.findUnique({ where: { trackingCode } });
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  async function resolveBody(ref: string): Promise<string> {
    if (ref === "current") return doc!.body;
    const revision = await db.documentRevision.findUnique({ where: { id: ref } });
    if (!revision || revision.documentId !== doc!.id) {
      throw new Error(`이 문서의 리비전이 아니거나 존재하지 않습니다: ${ref}`);
    }
    return revision.body;
  }

  const [fromBody, toBody] = await Promise.all([resolveBody(from), resolveBody(to)]);
  return { from, to, changes: diffLines(fromBody, toBody) };
}

export async function saveDocumentBody(
  trackingCode: string,
  newBody: string,
  editedBy: string,
): Promise<DocumentMutationSummary> {
  const db = getDb();
  const existing = await db.document.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  await db.documentRevision.create({
    data: { documentId: existing.id, body: existing.body, editedBy },
  });
  const row = await db.document.update({
    where: { trackingCode },
    data: { body: newBody },
  });
  const status = await db.docStatus.findUnique({ where: { id: row.statusId } });

  const searchable = toSearchable(row, status.code);
  await syncAndPublish(searchable, "update");

  return toMutationSummary({
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.getTime(),
  });
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/** Artifact 데이터베이스의 str_replace와 같은 의도 - 본문 몇 단어만
 * 바꾸려고 전체를 다시 구성해 saveDocumentBody()로 통째로 보내야
 * 했던 문제(minicore 세션 제안, SP-85D7DA9F 2번)를 없앤다. oldStr이
 * 본문에 정확히 한 번만 나타날 때만 적용하고(찾을 수 없거나 여러
 * 번 나타나면 아무것도 안 바꾸고 실패), replaceAll을 주면 전부
 * 바꾼다. 실제 쓰기는 그대로 saveDocumentBody()를 거쳐(리비전 스냅샷
 * +검색 재동기화 유지) 이 함수는 "어떤 내용으로 바꿀지"만 계산한다. */
export async function patchDocumentBody(
  trackingCode: string,
  oldStr: string,
  newStr: string,
  editedBy: string,
  replaceAll = false,
): Promise<DocumentMutationSummary> {
  if (!oldStr) throw new Error("oldStr이 필요합니다");
  const db = getDb();
  const existing = await db.document.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  const occurrences = countOccurrences(existing.body, oldStr);
  if (occurrences === 0) throw new Error("oldStr과 일치하는 내용이 본문에 없습니다");
  if (!replaceAll && occurrences > 1) {
    throw new Error(`oldStr이 본문에 ${occurrences}번 나타나 어느 자리를 바꿀지 알 수 없습니다 - replaceAll을 쓰거나 더 구체적인 문자열을 주세요`);
  }

  const newBody = replaceAll ? existing.body.split(oldStr).join(newStr) : existing.body.replace(oldStr, newStr);
  return saveDocumentBody(trackingCode, newBody, editedBy);
}

// ---------------------------------------------------------------- 챕터(헤딩 섹션) CRUD
// 긴 문서(라운드가 쌓이는 DN류, 긴 SP/PL 스펙 등)를 매번 전체 본문으로
// 안 읽고/안 덮어써도 되도록 - docChapters.ts의 순수 함수 위에서 읽기는
// 기존 getDocumentFromIndex(검색 엔진 경유) 경로를, 쓰기는 반드시
// saveDocumentBody()를 거친다(리비전 생성·검색 재동기화를 그대로
// 재사용 - 별도 쓰기 경로를 새로 안 만듦). 쓰기 응답도 다른 변형
// 함수들과 마찬가지로 본문 전체 대신 DocumentMutationSummary(+ 갱신된
// chapters 목록)만 돌려준다.

export type { ChapterInfo, ChapterInsertPosition } from "./docChapters.js";

export async function listDocumentChapters(trackingCode: string): Promise<ChapterInfo[]> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  return docChapters.listChapters(doc.body);
}

export async function getDocumentChapter(trackingCode: string, ordinal: number): Promise<{ chapter: ChapterInfo; content: string }> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  return docChapters.getChapterContent(doc.body, ordinal);
}

export interface DocumentChapterMutationResult {
  document: DocumentMutationSummary;
  chapters: ChapterInfo[];
}

export async function replaceDocumentChapter(
  trackingCode: string,
  ordinal: number,
  newContent: string,
  editedBy: string,
): Promise<DocumentChapterMutationResult> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const newBody = docChapters.replaceChapter(doc.body, ordinal, newContent);
  const document = await saveDocumentBody(trackingCode, newBody, editedBy);
  return { document, chapters: docChapters.listChapters(newBody) };
}

export async function insertDocumentChapter(
  trackingCode: string,
  position: ChapterInsertPosition,
  content: string,
  editedBy: string,
): Promise<DocumentChapterMutationResult> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const newBody = docChapters.insertChapter(doc.body, position, content);
  const document = await saveDocumentBody(trackingCode, newBody, editedBy);
  return { document, chapters: docChapters.listChapters(newBody) };
}

export async function deleteDocumentChapter(
  trackingCode: string,
  ordinal: number,
  editedBy: string,
): Promise<DocumentChapterMutationResult> {
  const doc = await getDocumentFromIndex(trackingCode);
  if (!doc) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const newBody = docChapters.deleteChapter(doc.body, ordinal);
  const document = await saveDocumentBody(trackingCode, newBody, editedBy);
  return { document, chapters: docChapters.listChapters(newBody) };
}

export async function transitionDocumentStatus(trackingCode: string, toStatusCode: string): Promise<DocumentMutationSummary> {
  const db = getDb();
  const existing = await db.document.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  const next = await allowedNextStatuses(existing.docTypeId, existing.statusId);
  const target = next.find((s) => s.code === toStatusCode);
  if (!target) {
    const currentStatus = await db.docStatus.findUnique({ where: { id: existing.statusId } });
    throw new Error(
      `"${currentStatus?.code ?? existing.statusId}"에서 "${toStatusCode}"로 전이할 수 없습니다(이 문서 타입에 없는 상태이거나, draft로는 어떤 상태에서도 되돌아갈 수 없습니다)`,
    );
  }

  const row = await db.document.update({ where: { trackingCode }, data: { statusId: target.id } });
  const searchable = toSearchable(row, target.code);
  await syncAndPublish(searchable, "update");

  return toMutationSummary({
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: target.code,
    priority: row.priority,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.getTime(),
  });
}

/** review/pending 상태일 때만 우선순위(정수)를 설정/갱신할 수 있다
 * (설계자 확정) - 그 범위를 벗어나도 기존 값을 자동으로 지우진
 * 않는다(요청 문구엔 "그 범위일 때만 설정 가능"만 있고 자동 초기화는
 * 없음, 필요해지면 별도 요청으로). */
export async function setDocumentPriority(trackingCode: string, priority: number): Promise<DocumentMutationSummary> {
  const db = getDb();
  const existing = await db.document.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const status = await db.docStatus.findUnique({ where: { id: existing.statusId } });
  if (!status || !PRIORITY_ALLOWED_STATUS_CODES.has(status.code)) {
    throw new Error(
      `문서 상태가 "review" 또는 "pending"일 때만 우선순위를 설정할 수 있습니다(현재: "${status?.code ?? existing.statusId}")`,
    );
  }

  const row = await db.document.update({ where: { trackingCode }, data: { priority } });
  const searchable = toSearchable(row, status.code);
  await syncAndPublish(searchable, "update");

  return toMutationSummary({
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.getTime(),
  });
}

/** DB에서 현재 상태 그대로 다시 읽어 검색 인덱스/실시간 발행을 재동기화
 * - questions.ts의 answerQuestion()이 질문 전부 답변 시 문서 상태를
 * 자동 전이시킨 뒤 호출한다(documents.ts가 questions.ts를 몰라도 되게,
 * 반대 방향으로만 의존하는 얇은 재동기화 진입점). */
export async function resyncDocumentIndex(trackingCode: string): Promise<void> {
  const db = getDb();
  const row = await db.document.findUnique({ where: { trackingCode } });
  if (!row) return;
  const status = await db.docStatus.findUnique({ where: { id: row.statusId } });
  await syncAndPublish(toSearchable(row, status.code), "update");
}

// 문서간 링크(addDocumentLink/listDocumentLinksOut/reorderDocumentLinks/
// removeDocumentLink/listBacklinks*/getProjectDocumentLinkGraph)는
// documentLinks.ts로 분리됐다(#documents-links-split, BL-57F8DF17 #62).

/** 문서 삭제 - 리비전/링크(양쪽)/질의 참고 태깅까지는 스키마의
 * onDelete: Cascade로 정리되지만, 코멘트/질문은 Comment/Question이
 * targetType/targetKey로 다형화되면서 Document로의 직접 FK가 없어져
 * (Prisma가 폴리모픽 관계를 못 지원함) 더 이상 자동으로 안 지워진다 -
 * 문서 삭제와 한 트랜잭션으로 명시적으로 같이 지운다(Question을
 * 지우면 그 자식인 Answer/QuestionReference는 각각의 FK로 계속
 * cascade됨). 검색 인덱스에서도 제거하고 실시간 "delete" 이벤트를
 * 발행한다. */
export async function deleteDocument(trackingCode: string): Promise<void> {
  const db = getDb();
  const existing = await db.document.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  await db.$transaction([
    db.comment.deleteMany({ where: { targetType: "document", targetKey: trackingCode } }),
    db.question.deleteMany({ where: { targetType: "document", targetKey: trackingCode } }),
    db.document.delete({ where: { trackingCode } }),
  ]);
  try {
    await indexSyncDelete(trackingCode);
  } catch (err) {
    if (err instanceof MeiliSearchRequestError) {
      await enqueueSearchSync("deleteDocument", { trackingCode });
    } else {
      throw err;
    }
  }
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "document",
    action: "delete",
    id: existing.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}
