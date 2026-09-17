// 배치 4(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 문서 타입 체계. server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { createDocType, listDocTypes, listDocTypesPaged, listDocStatuses, getDocTypeById, updateDocType, deleteDocType, setDocTypeGuideline } from "../../core/docTypes.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertDefined } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { code, label, guideline } = req.body as { code?: string; label?: string; guideline?: string };
    if (!code || !label) { res.status(400).json({ error: "code/label이 필요합니다" }); return; }
    res.json(await createDocType(req.params.projectId, code, label, guideline));
  }),
);

// 문서 타입은 항상 그 프로젝트 자신에게만 정의된다(팀/그룹 단위로
// 획일화해 정하는 기능은 없음 - 설계자 확인) - 예전엔 이 라우트가
// "상속분까지 포함한 전체", 별도 "/own"이 "직접 정의분만"이었지만
// 상속 자체가 없어져 둘이 항상 같은 결과였다 - "/own"은 제거하고
// 이 라우트 하나로 통일(DocTypeManager.vue도 이 라우트만 쓰도록
// 정리).
router.get(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/doc-types/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypesPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

router.get(
  "/api/doc-types/:docTypeId/statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocStatuses(req.params.docTypeId));
  }),
);

// docTypeId가 실제로 이 프로젝트 소속인지 확인 - 다른 프로젝트의
// docTypeId를 잘못(또는 악의적으로) 겨냥하는 걸 막는다.
async function requireOwnedDocType(projectId: string, docTypeId: string): Promise<boolean> {
  const docType = await getDocTypeById(docTypeId);
  return docType !== null && docType.projectId === projectId;
}

router.put(
  "/api/projects/:projectId/doc-types/:docTypeId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    const { code, label } = req.body as { code?: string; label?: string };
    res.json(await updateDocType(req.params.docTypeId, { code, label }));
  }),
);

router.delete(
  "/api/projects/:projectId/doc-types/:docTypeId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    await deleteDocType(req.params.docTypeId);
    res.json({ ok: true });
  }),
);

router.put(
  "/api/projects/:projectId/doc-types/:docTypeId/guideline",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    const { guideline } = req.body as { guideline?: string };
    assertDefined(guideline, "guideline이 필요합니다");
    res.json(await setDocTypeGuideline(req.params.docTypeId, guideline));
  }),
);

export default router;
