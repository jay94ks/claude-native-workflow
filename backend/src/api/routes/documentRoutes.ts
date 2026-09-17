// 배치 5b(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// trackingCode 기준 단건 문서 조작: 조회/저장/patch/전이/우선순위/
// 링크/백링크/문서그래프/리비전/부분읽기/grep/diff/챕터/소스링크/
// 브랜치링크/삭제. server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안
// 바뀜.
import { Router } from "express";
import {
  getDocument,
  getDocumentAccessInfo,
  saveDocumentBody,
  patchDocumentBody,
  transitionDocumentStatus,
  setDocumentPriority,
  listDocumentRevisions,
  listDocumentRevisionsPaged,
  readDocumentLines,
  grepDocument,
  diffDocument,
  listDocumentChapters,
  getDocumentChapter,
  replaceDocumentChapter,
  insertDocumentChapter,
  deleteDocumentChapter,
  deleteDocument,
} from "../../core/documents.js";
import { moveDocumentToFolder } from "../../core/folders.js";
import {
  addDocumentLink,
  listBacklinks,
  listBacklinksPaged,
  listDocumentLinksOut,
  reorderDocumentLinks,
  removeDocumentLink,
  getProjectDocumentLinkGraph,
} from "../../core/documentLinks.js";
import { countOpenOpinionsForTarget } from "../../core/opinions.js";
import { resolveEffectivePermission } from "../../core/permissions.js";
import { allowedNextStatuses } from "../../core/docTypes.js";
import { addSourceLink, removeSourceLink, listSourceLinks, listSourceLinksPaged } from "../../core/documentSourceLinks.js";
import { addBranchLink, removeBranchLink, listBranchLinks, listBranchLinksPaged } from "../../core/documentBranchLinks.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { findConflictNotices } from "../../core/sessions.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertDefined, assertNonEmpty } from "../httpValidation.js";
import { asyncRoute, withNotices, openOpinionNotice, resolveSessionId } from "../shared.js";

const router = Router();

// 문서는 trackingCode로만 식별되고(경로에 projectId 없음) 지금까지
// requireProjectRole을 못 걸어 GET/PUT/transition/links가 authenticate만
// 걸린 채 남아있었다(신규 버그 수정 - questions/comments 라우트에서
// 이미 겪은 것과 같은 원인). resolveEffectivePermission()으로
// read/write/delete를 확인하고, 오버라이드가 적용됐으면 notices 배열에
// 안내 배너를 얹는다(없으면 필드 생략 - 평소엔 노이즈 없음).
router.get(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    // 문서 단건 조회 응답에 연관 문서(DocumentLink 양방향) 추적코드를
    // 명시한다(#document-detail-related-codes, 설계자 지시) - 본문만
    // 보고는 다른 문서를 언급/참조하는지 알 수 없어, CLI/MCP로 문서를
    // 훑는 세션이 매번 doc-graph/links-out/backlinks를 따로 조회하지
    // 않아도 되게 한다.
    const [linksOut, backlinks, openOpinions] = await Promise.all([
      listDocumentLinksOut(req.params.trackingCode),
      listBacklinks(req.params.trackingCode),
      countOpenOpinionsForTarget("document", req.params.trackingCode),
    ]);
    res.json(
      withNotices(
        { ...doc, linksOut, backlinks, perm: { read: perm.read, write: perm.write, delete: perm.delete } },
        perm.notice,
        openOpinionNotice(openOpinions, req.params.trackingCode),
      ),
    );
  }),
);

// "bulk-folder"가 아래 "/api/documents/:trackingCode"의 :trackingCode
// 파라미터로 잘못 매칭되지 않도록, 그 와일드카드 라우트보다 먼저
// 등록해야 한다(Express는 등록 순서대로 매칭) - 폴더는 AI(CLI/MCP)가
// 그 개념 자체를 모르는 웹 전용 기능이라 이 일괄 버전도 CLI/MCP엔
// 노출하지 않는다(단건 .../folder와 동일).
router.put(
  "/api/documents/bulk-folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, folderId } = req.body as { trackingCodes?: string[]; folderId?: string | null };
    if (!trackingCodes?.length) {
      res.status(400).json({ error: "trackingCodes가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const doc = await getDocumentAccessInfo(trackingCode);
          if (!doc) return { trackingCode, ok: false, error: "문서를 찾을 수 없습니다" };
          const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
          if (!perm.read) return { trackingCode, ok: false, error: "이 문서에 대한 읽기 권한이 없습니다" };
          await moveDocumentToFolder(trackingCode, folderId ?? null, req.userId!);
          return { trackingCode, ok: true };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

router.put(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { body } = req.body as { body?: string };
    assertDefined(body, "body가 필요합니다");
    const conflictNotices = await findConflictNotices(doc.projectId, "document", req.params.trackingCode, resolveSessionId(req));
    res.json(withNotices(await saveDocumentBody(req.params.trackingCode, body, req.userId!), perm.notice, conflictNotices));
  }),
);

// str_replace 스타일 부분 치환(#document-patch, SP-85D7DA9F 2번 제안) -
// oldStr이 본문에 정확히 한 번만 있을 때만 적용(또는 replaceAll)하고,
// 본문 전체를 응답에 안 돌려준다(save와 동일 원칙 - 호출자가 이미
// 보낸 내용이라 되돌려줄 필요 없음).
router.put(
  "/api/documents/:trackingCode/patch",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { oldStr, newStr, replaceAll } = req.body as { oldStr?: string; newStr?: string; replaceAll?: boolean };
    if (!oldStr || newStr === undefined) { res.status(400).json({ error: "oldStr/newStr이 필요합니다" }); return; }
    res.json(withNotices(await patchDocumentBody(req.params.trackingCode, oldStr, newStr, req.userId!, replaceAll), perm.notice));
  }),
);

// bulk-folder/bulk-transition과 같은 원칙 - 서로 다른 문서에 각자 다른
// oldStr/newStr을 걸 수 있어야(#document-patch 사용 사례: 여러 문서에
// 각각 다른 교차 참조 태그 삽입) 값 하나를 여러 trackingCode에 적용하는
// 모양이 아니라 항목 배열을 받는다(relations/bulk, plans/import와
// 같은 모양).
router.post(
  "/api/documents/patch-batch",
  authenticate,
  asyncRoute(async (req, res) => {
    const { items } = req.body as {
      items?: { trackingCode?: string; oldStr?: string; newStr?: string; replaceAll?: boolean }[];
    };
    assertNonEmpty(items, "items가 필요합니다");
    const results = await Promise.all(
      items.map(async (item) => {
        const trackingCode = item.trackingCode;
        try {
          if (!trackingCode || !item.oldStr || item.newStr === undefined) {
            return { trackingCode, ok: false, error: "trackingCode/oldStr/newStr이 필요합니다" };
          }
          const doc = await getDocumentAccessInfo(trackingCode);
          if (!doc) return { trackingCode, ok: false, error: "문서를 찾을 수 없습니다" };
          const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
          if (!perm.write) return { trackingCode, ok: false, error: "이 문서에 대한 쓰기 권한이 없습니다" };
          await patchDocumentBody(trackingCode, item.oldStr, item.newStr, req.userId!, item.replaceAll);
          return { trackingCode, ok: true };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

router.post(
  "/api/documents/:trackingCode/transition",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { toStatusCode } = req.body as { toStatusCode?: string };
    assertTruthy(toStatusCode, "toStatusCode가 필요합니다");
    const conflictNotices = await findConflictNotices(doc.projectId, "document", req.params.trackingCode, resolveSessionId(req));
    res.json(withNotices(await transitionDocumentStatus(req.params.trackingCode, toStatusCode), perm.notice, conflictNotices));
  }),
);

// 선택한 문서 집합이 서로 다른 프로젝트/타입/권한을 가질 수 있어
// 전부-성공/전부-실패가 아니라 항목별 결과를 반환한다 - 하나가
// 막혀도(권한 없음, 그 타입에 정의 안 된 전이 등) 나머지는 계속
// 진행된다. 새 core 함수 없이 기존 단건 함수를 그대로 반복 호출한다.
router.post(
  "/api/documents/bulk-transition",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, toStatusCode } = req.body as { trackingCodes?: string[]; toStatusCode?: string };
    if (!trackingCodes?.length || !toStatusCode) {
      res.status(400).json({ error: "trackingCodes/toStatusCode가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const doc = await getDocumentAccessInfo(trackingCode);
          if (!doc) return { trackingCode, ok: false, error: "문서를 찾을 수 없습니다" };
          const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
          if (!perm.write) return { trackingCode, ok: false, error: "이 문서에 대한 쓰기 권한이 없습니다" };
          const updated = await transitionDocumentStatus(trackingCode, toStatusCode);
          return { trackingCode, ok: true, statusCode: updated.statusCode };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

// review/pending 상태일 때만 설정 가능(setDocumentPriority가 검증) -
// 그 외 권한 요구는 transition/save와 동일(쓰기 권한).
router.put(
  "/api/documents/:trackingCode/priority",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { priority } = req.body as { priority?: number };
    if (priority === undefined || !Number.isInteger(priority)) {
      res.status(400).json({ error: "priority(정수)가 필요합니다" });
      return;
    }
    res.json(withNotices(await setDocumentPriority(req.params.trackingCode, priority), perm.notice));
  }),
);

router.get(
  "/api/documents/:trackingCode/next-statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await allowedNextStatuses(doc.docTypeId, doc.statusId));
  }),
);

router.post(
  "/api/documents/:trackingCode/links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { toTrackingCode, linkType } = req.body as { toTrackingCode?: string; linkType?: string };
    assertTruthy(toTrackingCode, "toTrackingCode가 필요합니다");
    await addDocumentLink(req.params.trackingCode, toTrackingCode, linkType);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/documents/:trackingCode/backlinks",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBacklinks(req.params.trackingCode));
  }),
);

router.get(
  "/api/documents/:trackingCode/backlinks/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBacklinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// 정방향 링크(이 문서가 링크한 문서들, 순서대로) - report/여러 문서를
// 엮은 챕터 구조 조회용(#document-link-ordering). 기존 POST
// "/links"(addDocumentLink)와 대칭.
router.get(
  "/api/documents/:trackingCode/links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listDocumentLinksOut(req.params.trackingCode));
  }),
);

router.put(
  "/api/documents/:trackingCode/links/reorder",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { orderedTrackingCodes } = req.body as { orderedTrackingCodes?: string[] };
    assertNonEmpty(orderedTrackingCodes, "orderedTrackingCodes가 필요합니다");
    await reorderDocumentLinks(req.params.trackingCode, orderedTrackingCodes);
    res.json({ ok: true });
  }),
);

router.delete(
  "/api/documents/:trackingCode/links/:toTrackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    await removeDocumentLink(req.params.trackingCode, req.params.toTrackingCode, req.query.linkType as string | undefined);
    res.json({ ok: true });
  }),
);

// 프로젝트 전체 문서 간 링크 그래프(#document-link-graph) - 위 단건
// 문서 기준 links-out/backlinks와 달리 한 번에 전체를 그린다("문서"
// 탭의 "문서간 관계" 서브탭이 씀).
router.get(
  "/api/projects/:projectId/document-graph",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getProjectDocumentLinkGraph(req.params.projectId));
  }),
);

router.get(
  "/api/documents/:trackingCode/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listDocumentRevisions(req.params.trackingCode));
  }),
);

router.get(
  "/api/documents/:trackingCode/revisions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listDocumentRevisionsPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

// 큰 문서를 매번 전체 본문으로 컨텍스트에 올리지 않아도 되도록-
// Read/Grep 도구가 파일에 대해 하는 일을 문서 본문에 대해 한다
// (#document-partial-read-grep-diff).
router.get(
  "/api/documents/:trackingCode/lines",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(await readDocumentLines(req.params.trackingCode, offset, limit));
  }),
);

router.get(
  "/api/documents/:trackingCode/grep",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { q } = req.query as { q?: string };
    assertTruthy(q, "q가 필요합니다");
    const matches = await grepDocument(req.params.trackingCode, q, {
      caseInsensitive: req.query.caseInsensitive === "true",
      context: req.query.context !== undefined ? Number(req.query.context) : undefined,
    });
    res.json(matches);
  }),
);

router.get(
  "/api/documents/:trackingCode/diff",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { from, to } = req.query as { from?: string; to?: string };
    assertTruthy(from, "from이 필요합니다");
    res.json(await diffDocument(req.params.trackingCode, from, to ?? "current"));
  }),
);

// 챕터(헤딩 섹션) CRUD - 긴 문서를 매번 전체 본문으로 안 읽고/안
// 덮어써도 되도록(#document-chapters). 쓰기는 documents.ts 내부에서
// saveDocumentBody를 거치므로 리비전/검색 재동기화가 그대로 유지된다.
router.get(
  "/api/documents/:trackingCode/chapters",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listDocumentChapters(req.params.trackingCode));
  }),
);

router.get(
  "/api/documents/:trackingCode/chapters/:ordinal",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await getDocumentChapter(req.params.trackingCode, Number(req.params.ordinal)));
  }),
);

router.put(
  "/api/documents/:trackingCode/chapters/:ordinal",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { content } = req.body as { content?: string };
    assertDefined(content, "content가 필요합니다");
    res.json(await replaceDocumentChapter(req.params.trackingCode, Number(req.params.ordinal), content, req.userId!));
  }),
);

router.post(
  "/api/documents/:trackingCode/chapters",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { content, after, before, atStart, atEnd } = req.body as {
      content?: string;
      after?: number;
      before?: number;
      atStart?: boolean;
      atEnd?: boolean;
    };
    assertDefined(content, "content가 필요합니다");
    const position =
      after !== undefined ? { after } : before !== undefined ? { before } : atStart ? { atStart: true as const } : atEnd ? { atEnd: true as const } : undefined;
    assertTruthy(position, "after|before|atStart|atEnd 중 하나가 필요합니다");
    res.json(await insertDocumentChapter(req.params.trackingCode, position, content, req.userId!));
  }),
);

router.delete(
  "/api/documents/:trackingCode/chapters/:ordinal",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    res.json(await deleteDocumentChapter(req.params.trackingCode, Number(req.params.ordinal), req.userId!));
  }),
);

// "연관된 소스코드" 링크 - 코멘트/폴더와 달리 AI 작업과 직접 관련된
// 신호라 CLI/MCP에도 노출된다(완전성 원칙).
router.post(
  "/api/documents/:trackingCode/source-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { filePath: rawFilePath } = req.body as { filePath?: string };
    assertTruthy(rawFilePath, "filePath가 필요합니다");
    res.json(await addSourceLink(req.params.trackingCode, normalizeGitPath(rawFilePath), req.userId!));
  }),
);

router.get(
  "/api/documents/:trackingCode/source-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listSourceLinks(req.params.trackingCode));
  }),
);

router.get(
  "/api/documents/:trackingCode/source-links/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listSourceLinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

router.delete(
  "/api/document-source-links/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    assertTruthy(trackingCode, "trackingCode 쿼리가 필요합니다");
    const doc = await getDocumentAccessInfo(trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    await removeSourceLink(req.params.id, trackingCode);
    res.json({ ok: true });
  }),
);

router.delete(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.delete) { res.status(403).json({ error: "이 문서에 대한 삭제 권한이 없습니다" }); return; }
    await deleteDocument(req.params.trackingCode);
    res.json({ ok: true });
  }),
);

// "연관된 브랜치" 링크 - DocumentSourceLink와 완전히 같은 완전성 원칙
// (CLI/MCP에도 노출), filePath 대신 branchName만 다르다(요구사항 10).
router.post(
  "/api/documents/:trackingCode/branch-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { branchName } = req.body as { branchName?: string };
    assertTruthy(branchName, "branchName이 필요합니다");
    res.json(await addBranchLink(req.params.trackingCode, branchName, req.userId!));
  }),
);

router.get(
  "/api/documents/:trackingCode/branch-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBranchLinks(req.params.trackingCode));
  }),
);

router.get(
  "/api/documents/:trackingCode/branch-links/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listBranchLinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

router.delete(
  "/api/document-branch-links/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    assertTruthy(trackingCode, "trackingCode 쿼리가 필요합니다");
    const doc = await getDocumentAccessInfo(trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    await removeBranchLink(req.params.id, trackingCode);
    res.json({ ok: true });
  }),
);

export default router;
