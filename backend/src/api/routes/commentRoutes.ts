// 배치 7b(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 코멘트(설계자 전용 채널). server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { Router } from "express";
import { addComment, listComments, editComment, deleteComment, listRecentComments, setCommentStatus } from "../../core/comments.js";
import { resolveTargetByTrackingCode } from "../../core/questions.js";
import { getMemberRole } from "../../core/members.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, requireEditorForTarget } from "../shared.js";

const router = Router();

// 설계자들끼리만 공유되는 채널이라 CLI/MCP엔 없다(완전성 원칙의
// 의도적 예외 - 소스 코드/칸반 카드 코멘트도 동일하게 적용). 질의와
// 같은 방식으로 document/kanbanCard는 트래킹 코드로, source는 별도
// 프로젝트 스코프 진입점으로 주소 지정한다.

router.post(
  "/api/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCode, body } = req.body as { trackingCode?: string; body?: string };
    if (!trackingCode || !body) { res.status(400).json({ error: "trackingCode/body가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(target.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await addComment(target.projectId, target.targetType, trackingCode, body, req.userId!));
  }),
);

router.post(
  "/api/projects/:projectId/comments/source",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path, body } = req.body as { path?: string; body?: string };
    if (!path || !body) { res.status(400).json({ error: "path/body가 필요합니다" }); return; }
    res.json(await addComment(req.params.projectId, "source", path, body, req.userId!));
  }),
);

router.get(
  "/api/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    assertTruthy(trackingCode, "trackingCode 쿼리가 필요합니다");
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listComments(target.targetType, trackingCode, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/comments/source",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path as string | undefined;
    assertTruthy(path, "path 쿼리가 필요합니다");
    res.json(await listComments("source", path, req.userId!));
  }),
);

router.put(
  "/api/comments/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    assertTruthy(body, "body가 필요합니다");
    res.json(await editComment(req.params.id, body, req.userId!));
  }),
);

router.delete(
  "/api/comments/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    await deleteComment(req.params.id, req.userId!);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/comments/:id/status",
  authenticate,
  asyncRoute(async (req, res) => {
    const { status } = req.body as { status?: string };
    assertTruthy(status, "status가 필요합니다");
    res.json(await setCommentStatus(req.params.id, status, req.userId!));
  }),
);

// 홈 대시보드 "최근 코멘트" + 그 "더보기" - 웹 전용(코멘트는 CLI/MCP에
// 의도적으로 없음, 완전성 원칙의 예외 그대로 유지).
router.get(
  "/api/projects/:projectId/comments/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 5);
    res.json(await listRecentComments(req.params.projectId, limit));
  }),
);

export default router;
