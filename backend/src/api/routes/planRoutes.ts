// 배치 6f(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 보류 계획(PN). server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  PLAN_STATUSES,
  createPlan,
  getPlanByTrackingCode,
  getPlanProjectId,
  listPlansPaged,
  updatePlan,
  setPlanStatus,
  deletePlan,
  addPlanDocumentRef,
  removePlanDocumentRef,
  addPlanDependency,
  removePlanDependency,
  listAllPlans,
  bulkCreatePlans,
  type PlanImportItem,
  type PlanSortKey,
} from "../../core/plans.js";
import { getMemberRole, roleSatisfies } from "../../core/members.js";
import { countOpenOpinionsForTarget } from "../../core/opinions.js";
import { findConflictNotices } from "../../core/sessions.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertNonEmpty } from "../httpValidation.js";
import { asyncRoute, withNotices, openOpinionNotice, resolveSessionId } from "../shared.js";

const router = Router();

// Document/DocType/DocStatus 체계와 완전히 별도로 관리되는 독립
// 엔티티(설계자 지시, core/plans.ts 참고) - 트래킹코드 전용 라우트
// (GET/PUT/status/DELETE/refs)는 경로에 projectId가 없어
// requireProjectRole을 못 쓴다 - 칸반 카드 라우트와 같은 원칙으로
// getPlanProjectId + getMemberRole/roleSatisfies를 인라인으로 쓴다.

router.post(
  "/api/projects/:projectId/plans",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { title, body, status, refs, dependsOn } = req.body as {
      title?: string;
      body?: string;
      status?: string;
      refs?: string[];
      dependsOn?: string[];
    };
    if (!title || body === undefined) { res.status(400).json({ error: "title/body가 필요합니다" }); return; }
    res.json(await createPlan(req.params.projectId, title, body, req.userId!, refs, status, dependsOn));
  }),
);

router.get(
  "/api/projects/:projectId/plans",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const status = req.query.status as string | undefined;
    const q = req.query.q as string | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const sort = req.query.sort as PlanSortKey | undefined;
    // 기본은 본문 제외(요약, SP-2D04DB3C) - ?full=true면 기존처럼 전체.
    if (req.query.full === "true") {
      res.json(await listPlansPaged(req.params.projectId, { status, q, page, pageSize, sort, includeBody: true }));
    } else {
      res.json(await listPlansPaged(req.params.projectId, { status, q, page, pageSize, sort }));
    }
  }),
);

// "계획을 하나의 파일로 bulk"(설계자 표현) - 목록(/plans, 페이지네이션)
// 과 달리 200건 상한 없이 조건에 맞는 전체를 한 번에 돌려준다. CLI가
// 이 응답을 그대로 로컬 파일에 써서 내보내기를 구현한다.
router.get(
  "/api/projects/:projectId/plans/export",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const status = req.query.status as string | undefined;
    const q = req.query.q as string | undefined;
    res.json(await listAllPlans(req.params.projectId, { status, q, sort: req.query.sort as PlanSortKey | undefined }));
  }),
);

// 내보내기의 반대 방향 - 로컬 파일(또는 MCP가 직접 넘긴 배열)의 계획
// 정의들을 한 번에 만든다. relations/bulk와 같은 원칙으로 항목별
// 성공/실패를 반환(부분 성공 허용) - refs/dependsOn은 이미 존재하는
// 문서/계획만 가리킬 수 있고, 같은 배치 안의 다른 항목은 못 가리킨다.
router.post(
  "/api/projects/:projectId/plans/import",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: PlanImportItem[] };
    assertNonEmpty(items, "items가 필요합니다");
    res.json(await bulkCreatePlans(req.params.projectId, req.userId!, items));
  }),
);

router.get(
  "/api/plans/statuses",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json(PLAN_STATUSES);
  }),
);

// PN-XXXXXXXX 코드 클릭(TrackingCodeText)이 씀 - #reserved-tracking-codes.
router.get(
  "/api/plans/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const plan = await getPlanByTrackingCode(req.params.trackingCode);
    if (!plan) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(plan.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    const openOpinions = await countOpenOpinionsForTarget("plan", req.params.trackingCode);
    res.json(withNotices(plan, openOpinionNotice(openOpinions, req.params.trackingCode)));
  }),
);

router.put(
  "/api/plans/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { title, body } = req.body as { title?: string; body?: string };
    const conflictNotices = await findConflictNotices(projectId, "plan", req.params.trackingCode, resolveSessionId(req));
    res.json(withNotices(await updatePlan(req.params.trackingCode, { title, body }), conflictNotices));
  }),
);

router.put(
  "/api/plans/:trackingCode/status",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { status } = req.body as { status?: string };
    assertTruthy(status, "status가 필요합니다");
    const conflictNotices = await findConflictNotices(projectId, "plan", req.params.trackingCode, resolveSessionId(req));
    res.json(withNotices(await setPlanStatus(req.params.trackingCode, status), conflictNotices));
  }),
);

router.delete(
  "/api/plans/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    await deletePlan(req.params.trackingCode);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/plans/:trackingCode/refs",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { trackingCode } = req.body as { trackingCode?: string };
    assertTruthy(trackingCode, "trackingCode가 필요합니다");
    res.json(await addPlanDocumentRef(req.params.trackingCode, trackingCode));
  }),
);

router.delete(
  "/api/plans/:trackingCode/refs/:docTrackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    res.json(await removePlanDocumentRef(req.params.trackingCode, req.params.docTrackingCode));
  }),
);

router.post(
  "/api/plans/:trackingCode/dependencies",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { trackingCode } = req.body as { trackingCode?: string };
    assertTruthy(trackingCode, "trackingCode가 필요합니다");
    res.json(await addPlanDependency(req.params.trackingCode, trackingCode));
  }),
);

router.delete(
  "/api/plans/:trackingCode/dependencies/:dependsOnTrackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getPlanProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "계획을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    res.json(await removePlanDependency(req.params.trackingCode, req.params.dependsOnTrackingCode));
  }),
);

// bulk-transition(documents)과 같은 원칙 - 새 core 함수 없이 기존
// 단건 함수를 trackingCode마다 반복 호출, 항목별 성공/실패를 반환
// (부분 성공 허용). 경로에 projectId가 없어(여러 프로젝트의 계획이
// 섞여 들어올 수 있음) 항목마다 개별적으로 권한을 확인한다.
router.post(
  "/api/plans/bulk-status",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, status } = req.body as { trackingCodes?: string[]; status?: string };
    if (!trackingCodes?.length || !status) { res.status(400).json({ error: "trackingCodes/status가 필요합니다" }); return; }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const projectId = await getPlanProjectId(trackingCode);
          if (!projectId) return { trackingCode, ok: false, error: "계획을 찾을 수 없습니다" };
          const role = await getMemberRole(projectId, req.userId!);
          if (!roleSatisfies(role, "editor")) return { trackingCode, ok: false, error: "이 작업은 최소 editor 권한이 필요합니다" };
          await setPlanStatus(trackingCode, status);
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
  "/api/plans/bulk-link",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, docTrackingCode } = req.body as { trackingCodes?: string[]; docTrackingCode?: string };
    if (!trackingCodes?.length || !docTrackingCode) { res.status(400).json({ error: "trackingCodes/docTrackingCode가 필요합니다" }); return; }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const projectId = await getPlanProjectId(trackingCode);
          if (!projectId) return { trackingCode, ok: false, error: "계획을 찾을 수 없습니다" };
          const role = await getMemberRole(projectId, req.userId!);
          if (!roleSatisfies(role, "editor")) return { trackingCode, ok: false, error: "이 작업은 최소 editor 권한이 필요합니다" };
          await addPlanDocumentRef(trackingCode, docTrackingCode);
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
  "/api/plans/bulk-depend",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, dependsOnTrackingCode } = req.body as { trackingCodes?: string[]; dependsOnTrackingCode?: string };
    if (!trackingCodes?.length || !dependsOnTrackingCode) {
      res.status(400).json({ error: "trackingCodes/dependsOnTrackingCode가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const projectId = await getPlanProjectId(trackingCode);
          if (!projectId) return { trackingCode, ok: false, error: "계획을 찾을 수 없습니다" };
          const role = await getMemberRole(projectId, req.userId!);
          if (!roleSatisfies(role, "editor")) return { trackingCode, ok: false, error: "이 작업은 최소 editor 권한이 필요합니다" };
          await addPlanDependency(trackingCode, dependsOnTrackingCode);
          return { trackingCode, ok: true };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

export default router;
