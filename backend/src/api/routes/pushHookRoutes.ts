// 배치 8h(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// git push 훅 프롬프트 자동화(Phase 3 - 대기열 방식). server.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. (expireStalePushHookQueueEntries
// 는 서버 기동 시 주기적 만료 처리에 쓰여 server.ts 자신에 그대로
// 남아있다 - 이 배치와 무관.)
import { Router } from "express";
import {
  createPushHookPrompt,
  listPushHookPrompts,
  listPushHookPromptsPaged,
  updatePushHookPrompt,
  deletePushHookPrompt,
  listQueueEntries,
  listQueueEntriesPaged,
  acknowledgeQueueEntry,
  completeQueueEntry,
} from "../../core/pushHookPrompts.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/push-hook-prompts",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { triggerBranch, promptTemplate } = req.body as { triggerBranch?: string; promptTemplate?: string };
    assertTruthy(promptTemplate, "promptTemplate이 필요합니다");
    res.json(await createPushHookPrompt(req.params.projectId, { triggerBranch, promptTemplate }));
  }),
);

router.get(
  "/api/projects/:projectId/push-hook-prompts",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listPushHookPrompts(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/push-hook-prompts/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listPushHookPromptsPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

router.put(
  "/api/projects/:projectId/push-hook-prompts/:id",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const body = req.body as { triggerBranch?: string; promptTemplate?: string };
    res.json(await updatePushHookPrompt(req.params.id, req.params.projectId, body));
  }),
);

router.delete(
  "/api/projects/:projectId/push-hook-prompts/:id",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await deletePushHookPrompt(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/projects/:projectId/push-hook-queue",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listQueueEntries(req.params.projectId, req.query.status as string | undefined));
  }),
);

router.get(
  "/api/projects/:projectId/push-hook-queue/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listQueueEntriesPaged(
        req.params.projectId,
        req.query.status as string | undefined,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

router.post(
  "/api/projects/:projectId/push-hook-queue/:id/ack",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await acknowledgeQueueEntry(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/push-hook-queue/:id/done",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await completeQueueEntry(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

export default router;
