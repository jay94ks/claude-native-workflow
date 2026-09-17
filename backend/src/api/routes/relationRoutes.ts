// 배치 6c(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 코드 관계도(Code Relation Graph). server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜. "bulk"/"reset"류가 "/relations/:id"보다 먼저
// 등록돼야 하는 순서 의존성을 그대로 유지했다(원본과 동일 순서).
import { Router } from "express";
import {
  createRelation,
  updateRelation,
  deleteRelation,
  getRelation,
  listRelations,
  listParents,
  listChildren,
  listDescendants,
  listAncestors,
  bulkCreateRelations,
  bulkUpdateRelations,
  bulkDeleteRelations,
  resetRelations,
  type CodeRelationInput,
  type BulkUpdateItem,
} from "../../core/codeRelations.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertNonEmpty } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// Claude가 코드 탐색 중 스스로 발견한 관계를 기록하는 자기 기록형
// 그래프 - folders.ts와 동일 원칙으로 설계자(userId) 개인 소유이고
// 프로젝트 멤버면(viewer 포함) 누구나 자기 관계를 관리할 수 있다
// (core/codeRelations.ts가 항상 req.userId로 다시 좁힘).

router.post(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: CodeRelationInput[] };
    assertNonEmpty(items, "items가 필요합니다");
    for (const item of items) {
      if (item.filePath) item.filePath = normalizeGitPath(item.filePath);
    }
    res.json(await bulkCreateRelations(req.params.projectId, req.userId!, items));
  }),
);

router.put(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: BulkUpdateItem[] };
    assertNonEmpty(items, "items가 필요합니다");
    for (const item of items) {
      if (item.filePath) item.filePath = normalizeGitPath(item.filePath);
    }
    res.json(await bulkUpdateRelations(req.params.projectId, req.userId!, items));
  }),
);

router.delete(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { ids } = req.body as { ids?: string[] };
    assertNonEmpty(ids, "ids가 필요합니다");
    res.json(await bulkDeleteRelations(req.params.projectId, req.userId!, ids));
  }),
);

// "관계도 초기화" 버튼 - branchName="__none__"이면 브랜치 없음 버킷만,
// allBranches=true면 전체. "/relations/:id"보다 먼저 등록해야 한다(위
// bulk 라우트들과 같은 이유 - Express 라우트 매칭 순서).
router.delete(
  "/api/projects/:projectId/relations/reset",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { branchName, allBranches } = req.query as Record<string, string | undefined>;
    const deleted = await resetRelations(req.params.projectId, req.userId!, {
      branchName: branchName === "__none__" ? null : branchName,
      allBranches: allBranches === "true",
    });
    res.json({ ok: true, deleted });
  }),
);

router.post(
  "/api/projects/:projectId/relations",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const input = req.body as CodeRelationInput;
    if (input.filePath) input.filePath = normalizeGitPath(input.filePath);
    res.json(await createRelation(req.params.projectId, req.userId!, input));
  }),
);

router.get(
  "/api/projects/:projectId/relations",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { q, filePath, trackingCode, tag, hasNoParent, branchName, allBranches, page, pageSize } = req.query as Record<string, string | undefined>;
    res.json(
      await listRelations(req.params.projectId, req.userId!, {
        q,
        filePath: filePath ? normalizeGitPath(filePath) : filePath,
        trackingCode,
        tag,
        hasNoParent: hasNoParent === "true",
        branchName,
        allBranches: allBranches === "true",
        page: page !== undefined ? Number(page) : undefined,
        pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
      }),
    );
  }),
);

router.get(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getRelation(req.params.id, req.params.projectId, req.userId!));
  }),
);

router.put(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const patch = req.body as Partial<CodeRelationInput> & {
      addParentIds?: string[]; removeParentIds?: string[]; addChildIds?: string[]; removeChildIds?: string[];
    };
    if (patch.filePath) patch.filePath = normalizeGitPath(patch.filePath);
    res.json(await updateRelation(req.params.id, req.params.projectId, req.userId!, patch));
  }),
);

router.delete(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await deleteRelation(req.params.id, req.params.projectId, req.userId!);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/projects/:projectId/relations/:id/parents",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listParents(req.params.id, req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/relations/:id/children",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listChildren(req.params.id, req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/relations/:id/ancestors",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { depth, tag, q } = req.query as Record<string, string | undefined>;
    res.json(await listAncestors(req.params.id, req.params.projectId, req.userId!, Number(depth ?? 3), { tag, q }));
  }),
);

router.get(
  "/api/projects/:projectId/relations/:id/descendants",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { depth, tag, q } = req.query as Record<string, string | undefined>;
    res.json(await listDescendants(req.params.id, req.params.projectId, req.userId!, Number(depth ?? 3), { tag, q }));
  }),
);

export default router;
