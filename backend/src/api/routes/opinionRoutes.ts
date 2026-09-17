// 배치 7c(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 의견(Opinion) - 코멘트와 정반대 채널. server.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { addOpinion, listOpinions, resolveOpinion, getOpinionProjectId, type OpinionListFilter } from "../../core/opinions.js";
import { resolveTargetByTrackingCode } from "../../core/questions.js";
import { getMemberRole } from "../../core/members.js";
import { authenticate } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, requireEditorForTarget } from "../shared.js";

const router = Router();

// 코멘트는 "설계자들끼리만 공유, AI 참고 지표가 될 수 없다"는 원칙으로
// CLI/MCP가 없는데, 의견은 AI가 참고해야 하는 채널이라 그 반대다 -
// 생성은 여기 웹 전용 라우트로만(설계자가 문서/계획 화면의 "의견"
// 버튼으로), 조회/확인 완료는 CLI/MCP로도 노출한다. targetType은
// document/plan만 지원 - resolveTargetByTrackingCode가 kanbanCard로
// 판별하면 명확히 거부한다.

router.post(
  "/api/opinions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCode, body } = req.body as { trackingCode?: string; body?: string };
    if (!trackingCode || !body) { res.status(400).json({ error: "trackingCode/body가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target || target.targetType === "kanbanCard") { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(target.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await addOpinion(target.projectId, target.targetType, trackingCode, body, req.userId!));
  }),
);

router.get(
  "/api/opinions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { projectId, targetKey, status } = req.query as { projectId?: string; targetKey?: string; status?: string };
    assertTruthy(projectId, "projectId 쿼리가 필요합니다");
    const role = await getMemberRole(projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listOpinions(projectId, { targetKey, status: status as OpinionListFilter["status"] }));
  }),
);

router.post(
  "/api/opinions/:id/resolve",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getOpinionProjectId(req.params.id);
    if (!projectId) { res.status(404).json({ error: "의견을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await resolveOpinion(req.params.id, req.userId!));
  }),
);

export default router;
