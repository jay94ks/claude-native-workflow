// 배치 6e(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 보고서. server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { createReport } from "../../core/report.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/reports",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { title, body, links } = req.body as { title?: string; body?: string; links?: string[] };
    if (!title || body === undefined) { res.status(400).json({ error: "title/body가 필요합니다" }); return; }
    res.json(
      await createReport({ projectId: req.params.projectId, title, body, createdBy: req.userId!, links }),
    );
  }),
);

export default router;
