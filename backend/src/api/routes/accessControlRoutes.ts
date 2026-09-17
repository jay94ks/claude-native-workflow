// 배치 6a(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 세부 접근 권한(오너 전용). server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { Router } from "express";
import { setAccessOverride, listAccessOverrides, listAccessOverridesPaged } from "../../core/permissions.js";
import { getDocumentAccessInfo } from "../../core/documents.js";
import { getMemberRole } from "../../core/members.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.put(
  "/api/projects/:projectId/access",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { userId, canRead, canWrite, canDelete } = req.body as {
      userId?: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
    };
    assertTruthy(userId, "userId가 필요합니다");
    await setAccessOverride(req.params.projectId, userId, {}, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

router.put(
  "/api/projects/:projectId/doc-types/:docTypeId/access",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { userId, canRead, canWrite, canDelete } = req.body as {
      userId?: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
    };
    assertTruthy(userId, "userId가 필요합니다");
    await setAccessOverride(req.params.projectId, userId, { docTypeId: req.params.docTypeId }, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

router.put(
  "/api/documents/:trackingCode/access",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(doc.projectId, req.userId!);
    if (role !== "owner") { res.status(403).json({ error: "프로젝트 owner만 접근 권한을 설정할 수 있습니다" }); return; }
    const { userId, canRead, canWrite, canDelete } = req.body as {
      userId?: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
    };
    assertTruthy(userId, "userId가 필요합니다");
    await setAccessOverride(doc.projectId, userId, { documentId: doc.id }, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

router.get(
  "/api/projects/:projectId/access",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverrides(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/access/page",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(
      await listAccessOverridesPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

export default router;
