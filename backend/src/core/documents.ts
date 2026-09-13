import { MeiliSearchRequestError } from "meilisearch";
import { diffLines, type Change } from "diff";
import { sliceLines, grepLines, type LinesResult, type GrepMatch, type GrepOptions } from "./textLines.js";
import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { findDocTypeByCode, findDocStatusByCode, initialStatusFor, allowedNextStatuses } from "./docTypes.js";
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

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDetail> {
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

  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
  };
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

// CLI/MCP가 "이 프로젝트의 전체 문서 목록"으로 쓰는 함수라 limit을
// 명시적으로 크게 잡아야 한다 - 안 그러면 rawSearch()의 기본값(50)이
// 조용히 적용돼, 문서가 50건을 넘는 프로젝트에서 뒤쪽 문서가 아무
// 경고 없이 목록에서 통째로 빠진다(대량 문서 QA 라운드 중 실제
// 200건 프로젝트로 재현해 발견). 1000은 Meilisearch 기본
// maxTotalHits와 같은 값 - 이 한도까지도 넘는 프로젝트는 이번
// 수정 범위 밖(QA-SCENARIOS.md에 잔여 한계로 기록).
export async function listDocuments(projectId: string, docTypeId?: string, statusCode?: string): Promise<SearchableDocument[]> {
  return listDocumentsFromIndex({ projectId, docTypeId, statusCode, limit: 1000 });
}

/** 홈 대시보드 "최근 변경 문서" + 그 "더보기" 전체 목록 둘 다 이걸
 * 쓴다(limit만 다르게 호출) - 변경(updatedAt) 순 정렬. */
export async function listRecentDocuments(projectId: string, limit = 5): Promise<SearchableDocument[]> {
  return searchDocuments("", { projectId, limit, sort: ["updatedAt:desc"] });
}

export async function searchProjectDocuments(
  projectId: string,
  query: string,
): Promise<SearchableDocument[]> {
  return searchDocuments(query, { projectId });
}

export async function searchProjectDocumentsPaged(
  projectId: string,
  query: string,
  page: number,
  pageSize: number,
): Promise<Page<SearchableDocument>> {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.max(1, Math.trunc(pageSize) || 20);
  const { hits, total } = await rawSearchDocuments(query, { projectId, limit: safeSize, offset: (safePage - 1) * safeSize });
  return { items: hits, page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)) };
}

export interface DocumentPage {
  items: SearchableDocument[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 웹 문서 목록 화면 전용(요청 4번 페이지네이션) - createdAt:desc로
 * 안정적인 순서를 보장한다(정렬 없이 페이지를 넘기면 Meilisearch가
 * 페이지마다 다른 순서를 줄 수 있음). CLI/MCP가 쓰는 listDocuments()는
 * 그대로 둔다. */
export async function listDocumentsPaged(
  projectId: string,
  docTypeId: string | undefined,
  page: number,
  pageSize: number,
  statusCode?: string,
): Promise<DocumentPage> {
  const safePage = Math.max(1, page);
  const { hits, total } = await listDocumentsFromIndexPaged({
    projectId,
    docTypeId,
    statusCode,
    limit: pageSize,
    offset: (safePage - 1) * pageSize,
    sort: ["createdAt:desc"],
  });
  return { items: hits, page: safePage, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
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

/** 정규식(JS 문법) 패턴으로 본문을 줄 단위 검색한다 - Grep 도구의
 * "content" 출력 모드와 같은 모양(줄 번호+텍스트). 잘못된 정규식은
 * 명확한 에러로 거부(추측해서 고쳐주지 않음). */
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
): Promise<DocumentDetail> {
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

  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
  };
}

export async function transitionDocumentStatus(trackingCode: string, toStatusCode: string): Promise<DocumentDetail> {
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

  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: target.code,
    priority: row.priority,
    createdBy: row.createdBy,
  };
}

/** review/pending 상태일 때만 우선순위(정수)를 설정/갱신할 수 있다
 * (설계자 확정) - 그 범위를 벗어나도 기존 값을 자동으로 지우진
 * 않는다(요청 문구엔 "그 범위일 때만 설정 가능"만 있고 자동 초기화는
 * 없음, 필요해지면 별도 요청으로). */
export async function setDocumentPriority(trackingCode: string, priority: number): Promise<DocumentDetail> {
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

  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    docTypeId: row.docTypeId,
    title: row.title,
    body: row.body,
    statusId: row.statusId,
    statusCode: status.code,
    priority: row.priority,
    createdBy: row.createdBy,
  };
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

export async function addDocumentLink(
  fromTrackingCode: string,
  toTrackingCode: string,
  linkType?: string,
): Promise<void> {
  const db = getDb();
  const from = await db.document.findUnique({ where: { trackingCode: fromTrackingCode } });
  if (!from) throw new Error(`문서를 찾을 수 없습니다: ${fromTrackingCode}`);
  const to = await db.document.findUnique({ where: { trackingCode: toTrackingCode } });
  if (!to) throw new Error(`링크 대상 문서를 찾을 수 없습니다: ${toTrackingCode}`);

  await db.documentLink.create({
    data: { fromDocumentId: from.id, toTrackingCode, linkType: linkType ?? null },
  });
}

/** 역참조: 이 문서를 링크한 문서 전부(JSON 배열로는 불가능했던 조회 -
 * DocumentLink를 join 테이블로 정규화한 이유). */
export async function listBacklinks(trackingCode: string): Promise<{ trackingCode: string; title: string }[]> {
  const db = getDb();
  const links = await db.documentLink.findMany({
    where: { toTrackingCode: trackingCode },
    include: { fromDocument: true },
  });
  return links.map((l: { fromDocument: { trackingCode: string; title: string } }) => ({
    trackingCode: l.fromDocument.trackingCode,
    title: l.fromDocument.title,
  }));
}

export async function listBacklinksPaged(
  trackingCode: string,
  page: number,
  pageSize: number,
): Promise<Page<{ trackingCode: string; title: string }>> {
  const db = getDb();
  const where = { toTrackingCode: trackingCode };
  const result = await paginate<{ fromDocument: { trackingCode: string; title: string } }>(
    (args) => db.documentLink.findMany({ where, include: { fromDocument: true }, ...args }),
    () => db.documentLink.count({ where }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((l: { fromDocument: { trackingCode: string; title: string } }) => ({
      trackingCode: l.fromDocument.trackingCode,
      title: l.fromDocument.title,
    })),
  };
}

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
