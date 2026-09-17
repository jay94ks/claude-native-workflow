// 배치 6d(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 칸반 보드. server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  createKanbanColumn,
  listKanbanColumnsForUser,
  listKanbanColumnsForUserPaged,
  getKanbanColumnProjectId,
  setColumnHiddenForUser,
  reorderColumnsForUser,
  createKanbanCard,
  listKanbanCards,
  listKanbanCardsPaged,
  getKanbanCardByTrackingCode,
  moveKanbanCard,
  setKanbanCardHidden,
} from "../../core/kanban.js";
import { getMemberRole, roleSatisfies } from "../../core/members.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertDefined } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// 컬럼(분류)은 프로젝트 공유, 순서/숨김만 설계자별(KanbanColumnPref) -
// 그 두 라우트는 "이 프로젝트 멤버인가"만 확인하고 role 등급은 안 따진다
// (개인 설정이라 editor/owner를 요구할 이유가 없음). 카드는 문서와
// 같은 관례로 트래킹 코드 주소 지정 - 하위 라우트(이동/숨김/코멘트)는
// 경로에 projectId가 없어 먼저 카드를 조회해 projectId를 얻은 뒤
// getMemberRole로 인라인 인가한다(질문/코멘트 라우트와 동일 패턴).

router.post(
  "/api/projects/:projectId/kanban/columns",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    assertTruthy(name, "name이 필요합니다");
    res.json(await createKanbanColumn(req.params.projectId, name));
  }),
);

router.get(
  "/api/projects/:projectId/kanban/columns",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listKanbanColumnsForUser(req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/kanban/columns/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listKanbanColumnsForUserPaged(
        req.params.projectId,
        req.userId!,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

router.put(
  "/api/kanban/columns/:id/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getKanbanColumnProjectId(req.params.id);
    if (!projectId) { res.status(404).json({ error: "분류를 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 프로젝트의 멤버만 가능합니다" }); return; }
    const { hidden } = req.body as { hidden?: boolean };
    assertDefined(hidden, "hidden이 필요합니다");
    await setColumnHiddenForUser(req.params.id, req.userId!, hidden);
    res.json({ ok: true });
  }),
);

router.put(
  "/api/projects/:projectId/kanban/columns/order",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { columnIds } = req.body as { columnIds?: string[] };
    if (!Array.isArray(columnIds)) { res.status(400).json({ error: "columnIds 배열이 필요합니다" }); return; }
    await reorderColumnsForUser(req.params.projectId, req.userId!, columnIds);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/kanban/cards",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { columnId, title, body, refs, origin } = req.body as {
      columnId?: string;
      title?: string;
      body?: string;
      refs?: string[];
      origin?: string;
    };
    if (!columnId || !title) { res.status(400).json({ error: "columnId/title이 필요합니다" }); return; }
    if (origin !== "ai" && origin !== "designer") { res.status(400).json({ error: "origin은 ai/designer 중 하나여야 합니다" }); return; }
    res.json(await createKanbanCard(req.params.projectId, columnId, title, body, origin, req.userId!, refs));
  }),
);

router.get(
  "/api/projects/:projectId/kanban/cards",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const columnId = req.query.columnId as string | undefined;
    const includeHidden = req.query.includeHidden === "true";
    res.json(await listKanbanCards(req.params.projectId, columnId, includeHidden));
  }),
);

router.get(
  "/api/projects/:projectId/kanban/cards/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const columnId = req.query.columnId as string | undefined;
    const includeHidden = req.query.includeHidden === "true";
    res.json(
      await listKanbanCardsPaged(
        req.params.projectId,
        columnId,
        includeHidden,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

router.get(
  "/api/kanban/cards/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const card = await getKanbanCardByTrackingCode(req.params.trackingCode);
    if (!card) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(card.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(card);
  }),
);

router.put(
  "/api/kanban/cards/:trackingCode/move",
  authenticate,
  asyncRoute(async (req, res) => {
    const card = await getKanbanCardByTrackingCode(req.params.trackingCode);
    if (!card) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(card.projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { toColumnId, toIndex } = req.body as { toColumnId?: string; toIndex?: number };
    assertTruthy(toColumnId, "toColumnId가 필요합니다");
    await moveKanbanCard(req.params.trackingCode, toColumnId, toIndex);
    res.json({ ok: true });
  }),
);

router.put(
  "/api/kanban/cards/:trackingCode/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const card = await getKanbanCardByTrackingCode(req.params.trackingCode);
    if (!card) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(card.projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { hidden } = req.body as { hidden?: boolean };
    assertDefined(hidden, "hidden이 필요합니다");
    await setKanbanCardHidden(req.params.trackingCode, hidden);
    res.json({ ok: true });
  }),
);

// 칸반 카드 코멘트 전용 라우트는 없다 - 공용 코멘트 라우트(코멘트 배치,
// targetType="kanbanCard")로 흡수됐다.

export default router;
