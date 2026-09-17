// 배치 8f(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 코드 리뷰(사후 검토) - core/codeReview.ts 참고. 머지 게이트가 아니라
// 기록이라 owner 전용 액션이 없다 - 조회는 viewer, 요청/제출/트리아지/
// 삭제는 전부 editor 이상. server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { Router } from "express";
import {
  requestReview as requestCodeReview,
  listPending as listPendingCodeReviews,
  listReviews as listCodeReviews,
  getReviewDetail as getCodeReviewDetail,
  submitFindings as submitCodeReviewFindings,
  resolveFinding as resolveCodeReviewFinding,
  deleteReview as deleteCodeReview,
  addComment as addCodeReviewComment,
  getFileHistory as getCodeReviewFileHistory,
} from "../../core/codeReview.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/git/code-review/request",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { prIndex, base, head, label } = req.body as { prIndex?: number; base?: string; head?: string; label?: string };
    if (!label?.trim()) { res.status(400).json({ error: "label이 필요합니다" }); return; }
    res.json(await requestCodeReview(req.params.projectId, { prIndex, base, head, label: label.trim() }, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/git/code-review/pending",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listPendingCodeReviews(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/git/code-review",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const prIndex = req.query.prIndex !== undefined ? Number(req.query.prIndex) : undefined;
    res.json(await listCodeReviews(req.params.projectId, prIndex));
  }),
);

// :reviewId 라우트보다 먼저 등록해야 한다 - 안 그러면 "file-history"가
// reviewId로 파싱된다(위 pending과 같은 순서 이유).
router.get(
  "/api/projects/:projectId/git/code-review/file-history",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path as string | undefined;
    assertTruthy(path, "path가 필요합니다");
    const line = req.query.line !== undefined ? Number(req.query.line) : undefined;
    res.json(await getCodeReviewFileHistory(req.params.projectId, path, line));
  }),
);

router.get(
  "/api/projects/:projectId/git/code-review/:reviewId",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getCodeReviewDetail(req.params.reviewId));
  }),
);

router.post(
  "/api/projects/:projectId/git/code-review/:reviewId/submit",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { aiSummary, findings } = req.body as { aiSummary?: string; findings?: unknown };
    if (!Array.isArray(findings)) { res.status(400).json({ error: "findings 배열이 필요합니다" }); return; }
    res.json(
      await submitCodeReviewFindings(req.params.projectId, req.params.reviewId, { aiSummary, findings: findings as never }, req.userId!),
    );
  }),
);

router.post(
  "/api/projects/:projectId/git/code-review/findings/:findingId/resolve",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { status, comment } = req.body as { status?: string; comment?: string };
    assertTruthy(status, "status가 필요합니다");
    await resolveCodeReviewFinding(req.params.findingId, status, req.userId!, comment);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/git/code-review/:reviewId/comments",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { body, findingId } = req.body as { body?: string; findingId?: string };
    if (!body?.trim()) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await addCodeReviewComment(req.params.projectId, req.params.reviewId, { body: body.trim(), findingId }, req.userId!));
  }),
);

router.delete(
  "/api/projects/:projectId/git/code-review/:reviewId",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await deleteCodeReview(req.params.projectId, req.params.reviewId);
    res.json({ ok: true });
  }),
);

export default router;
