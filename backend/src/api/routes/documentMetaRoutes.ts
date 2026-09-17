// 배치 5a(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 문서 목록/내보내기/최근/대시보드/활동/페이지네이션 + 검색/검색전체/
// 프로젝트 사용 통계/refs-status/다중 스코프 검색. server.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
//
// **주의**: 뒤쪽 절반(search/search-all/monitoring/refs-status/
// search-multi)은 "문서" 도메인이 아니지만 원본 파일에서 "문서" 헤더
// 아래에 물리적으로 섞여 있었다(#58 배치 작업 중 실측으로 발견한
// 또 다른 헤더-내용 불일치 사례 - 배치 2b의 팀/그룹/프로젝트와 같은
// 종류). 억지로 분리하기보다 원래 있던 자리 그대로 이 파일에 함께
// 뒀다 - 도메인 순수성보다 "실제로 뭐가 있었는지 정확히 옮긴다"는
// 원칙을 우선.
import { Router } from "express";
import {
  createDocument,
  listDocuments,
  listDocumentsForExport,
  listRecentDocuments,
  listDocumentsPaged,
  searchProjectDocuments,
  searchProjectDocumentsPaged,
} from "../../core/documents.js";
import { getProjectDashboard } from "../../core/dashboard.js";
import { listProjectActivity } from "../../core/activity.js";
import { listAllPlans } from "../../core/plans.js";
import { getMonitoringStats } from "../../core/monitoring.js";
import { getRefsStatus, getRefsStatusSourceProjectId } from "../../core/refsStatus.js";
import { getMemberRole } from "../../core/members.js";
import { listAccessibleProjectIdsInScope, getProjectNamesByIds, type SearchScope } from "../../core/projects.js";
import { searchDocumentsWithSnippets, searchSourceFiles } from "../../core/search.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { asyncRoute, parseDocumentSort } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/documents",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { docTypeCode, title, body } = req.body as { docTypeCode?: string; title?: string; body?: string };
    if (!docTypeCode || !title || body === undefined) {
      res.status(400).json({ error: "docTypeCode/title/body가 필요합니다" });
      return;
    }
    res.json(
      await createDocument({
        projectId: req.params.projectId,
        docTypeCode,
        title,
        body,
        createdBy: req.userId!,
      }),
    );
  }),
);

router.get(
  "/api/projects/:projectId/documents",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listDocuments(
        req.params.projectId,
        req.query.docTypeId as string | undefined,
        req.query.statusCode as string | undefined,
      ),
    );
  }),
);

// `docs cache sync`(로컬 문서 캐시 내보내기, `#document-cache-export`)
// 전용 - body가 포함된 전체 문서를 한 번에 돌려준다(위 목록 라우트는
// #document-list-lightweight로 본문을 뺌). 응답을 그대로 AI 컨텍스트에
// 남기지 않고 로컬 파일로 쓰는 CLI/MCP 호출부에서만 쓰는 걸 전제한다.
router.get(
  "/api/projects/:projectId/documents/export",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json({ items: await listDocumentsForExport(req.params.projectId) });
  }),
);

// 홈 대시보드 "최근 변경 문서" + 그 "더보기"(더 큰 limit으로 재호출)
// 둘 다 이 라우트 하나를 쓴다.
router.get(
  "/api/projects/:projectId/documents/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 5);
    res.json(await listRecentDocuments(req.params.projectId, limit));
  }),
);

// 프로젝트 홈(대시보드) 집계 - 문서 상태 분포+정체 문서, 미답변 Q&A/
// 처리 안 된 메시지, 칸반 컬럼별 카드 수, 통합 최근 활동을 한 번에
// (#project-dashboard).
router.get(
  "/api/projects/:projectId/dashboard",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const staleDays = req.query.staleDays !== undefined ? Number(req.query.staleDays) : undefined;
    res.json(await getProjectDashboard(req.params.projectId, { staleDays }));
  }),
);

// 대시보드의 "최근 활동" 위젯은 20건 고정(getProjectDashboard 내부) -
// 그 "더보기"가 부르는 전체 목록 전용 라우트(#project-dashboard 후속,
// RecentCommentsView.vue의 `?limit=100` 관례와 동일 - 실제 페이지네이션
// 없이 더 큰 limit 하나로 "더 보여준다").
router.get(
  "/api/projects/:projectId/activity",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    res.json(await listProjectActivity(req.params.projectId, limit));
  }),
);

// 웹 문서 목록 화면 전용 페이지네이션(요청 4번, #documents-tab-redesign
// 라운드에서 sort 추가) - CLI/MCP가 쓰는 위 배열 응답 라우트는 그대로 둔다.
router.get(
  "/api/projects/:projectId/documents/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(
      await listDocumentsPaged(
        req.params.projectId,
        req.query.docTypeId as string | undefined,
        page,
        pageSize,
        req.query.statusCode as string | undefined,
        parseDocumentSort(req.query.sort),
      ),
    );
  }),
);

router.get(
  "/api/projects/:projectId/search",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    const lines = req.query.lines !== undefined ? Number(req.query.lines) : undefined;
    // codesOnly는 순수 응답 모양 변환이라(도메인 로직 없음) core 계층을
    // 안 건드리고 라우트에서 바로 trackingCode 배열로 축소한다 -
    // lines와 같이 줘도 무해(어차피 body를 버리므로).
    const codesOnly = req.query.codesOnly === "true";
    if (req.query.page !== undefined || req.query.pageSize !== undefined) {
      const page = await searchProjectDocumentsPaged(
        req.params.projectId,
        q,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
        lines,
      );
      res.json(codesOnly ? { ...page, items: page.items.map((h) => h.trackingCode) } : page);
      return;
    }
    const hits = await searchProjectDocuments(req.params.projectId, q, lines);
    res.json(codesOnly ? hits.map((h) => h.trackingCode) : hits);
  }),
);

// SP-4187EBE7 - 문서(Meilisearch 전문 검색)와 계획(Prisma 부분 일치,
// #plan-list-dependency-sort 주석대로 계획은 프로젝트당 보통 소수라
// 별도 Meilisearch 인덱스를 새로 만들 만큼 크지 않음)를 한 번에
// 훑고 싶을 때 쓰는 메타 검색 - 기존 /search(문서 전용)는 그대로
// 두고(이미 익숙하게 쓰는 세션들의 기본 응답 모양을 안 바꿈) 새
// 엔드포인트만 추가한다. 정렬은 종류별로 묶어서(문서 먼저, Meilisearch
// 관련도 순 그대로 → 계획 이어붙임) - 서로 다른 검색 엔진의 점수를
// 하나로 인터리빙하는 건 범위 밖.
router.get(
  "/api/projects/:projectId/search-all",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    const [docHits, planHits] = await Promise.all([
      searchProjectDocuments(req.params.projectId, q),
      listAllPlans(req.params.projectId, { q }),
    ]);
    res.json([
      ...docHits.map((h) => ({ kind: "document" as const, trackingCode: h.trackingCode, title: h.title, statusCode: h.statusCode })),
      ...planHits.map((p) => ({ kind: "plan" as const, trackingCode: p.trackingCode, title: p.title, statusCode: p.status })),
    ]);
  }),
);

// #usage-monitoring - 이 프로젝트의 사용 통계(요청 패턴 빈도 + 연이은
// 패턴). 설치 전체 통계는 /api/monitoring/stats(superAdmin 전용) 참고.
router.get(
  "/api/projects/:projectId/monitoring/stats",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json(await getMonitoringStats(req.params.projectId, limit));
  }),
);

// SP-47F91774 - source(문서/계획/칸반 카드) 본문에 언급된 모든 추적
// 코드의 현재 title/status를 한 번에 모아 본다("완료된 계획이 참조
// 문서에 반영 안 됨" 패턴을 눈으로 하나씩 대조하던 걸 대체). 프로젝트
// 경로 파라미터가 없다 - questions.ts의 resolveTargetByTrackingCode와
// 같은 이유로 trackingCode만으로 대상과 그 프로젝트를 알아낸다.
router.get(
  "/api/refs-status/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getRefsStatusSourceProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await getRefsStatus(req.params.trackingCode));
  }),
);

// 사이드바 다중 스코프 검색(웹 전용) - CLI/MCP는 위 단일 프로젝트
// /search를 그대로 쓰고, 이 라우트는 AI가 아니라 설계자의 브라우징
// 편의 기능이라 완전성 원칙 대상이 아니다. scope가 "team"인데 앵커
// 프로젝트가 팀에 속하지 않으면 listAccessibleProjectIdsInScope()가
// 명확한 에러를 던진다(팝업이 사전 조회 없이 "먼저 시도, 실패하면
// 안내" 방식으로 처리).
router.get(
  "/api/projects/:projectId/search/multi",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    const scope = (req.query.scope as string | undefined) ?? "project";
    if (scope !== "project" && scope !== "group" && scope !== "team") {
      res.status(400).json({ error: "scope는 project|group|team 중 하나여야 합니다" });
      return;
    }
    const includeSource = req.query.includeSource === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const projectIds = await listAccessibleProjectIdsInScope(req.params.projectId, scope as SearchScope, req.userId!);
    if (projectIds.length === 0) {
      res.json({ documents: [], sourceFiles: [] });
      return;
    }

    const docHits = await searchDocumentsWithSnippets(q, { projectIds, limit });
    const docProjectNames = await getProjectNamesByIds([...new Set(docHits.map((h) => h.projectId))]);
    const documents = docHits.map((h) => ({ ...h, projectName: docProjectNames.get(h.projectId) ?? h.projectId }));

    let sourceFiles: (Awaited<ReturnType<typeof searchSourceFiles>>[number] & { projectName: string })[] = [];
    if (includeSource) {
      const srcHits = await searchSourceFiles(q, { projectIds, limit });
      const srcProjectNames = await getProjectNamesByIds([...new Set(srcHits.map((h) => h.projectId))]);
      sourceFiles = srcHits.map((h) => ({ ...h, projectName: srcProjectNames.get(h.projectId) ?? h.projectId }));
    }

    res.json({ documents, sourceFiles });
  }),
);

export default router;
