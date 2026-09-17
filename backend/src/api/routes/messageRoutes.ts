// 배치 7e(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 인스턴스 메시징(Phase 4). server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜. "아직 미구현" 스텁 섹션의 notImplemented() 팩토리
// 함수는 실제 호출부가 하나도 없는 죽은 코드로 확인되어(#58과 무관하게
// 이번 라운드에 같이 정리) 이관하지 않고 그대로 드롭했다.
import { Router } from "express";
import {
  sendMessage,
  listMessages,
  listMessagesPaged,
  waitForMessage,
  listRecentMessages,
  editMessage,
  deleteMessage,
  ackMessage,
  completeMessage,
  type MessageOrigin,
} from "../../core/messages.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, resolveMessageOrigin } from "../shared.js";

const router = Router();

router.get(
  "/api/projects/:projectId/messages",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const status = req.query.status as "pending" | "processing" | "delivered" | "active" | "all" | undefined;
    const origin = req.query.origin as MessageOrigin | undefined;
    const markDelivered = req.query.markDelivered === "true";
    res.json(await listMessages(req.params.projectId, { status, origin, markDelivered }));
  }),
);

router.post(
  "/api/projects/:projectId/messages",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    assertTruthy(body, "body가 필요합니다");
    res.json(await sendMessage(req.params.projectId, req.userId!, body, resolveMessageOrigin(req)));
  }),
);

router.put(
  "/api/messages/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    assertTruthy(body, "body가 필요합니다");
    res.json(await editMessage(req.params.id, body, req.userId!));
  }),
);

router.delete(
  "/api/messages/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    await deleteMessage(req.params.id, req.userId!);
    res.json({ ok: true });
  }),
);

router.put(
  "/api/messages/:id/ack",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await ackMessage(req.params.id, req.userId!));
  }),
);

router.put(
  "/api/messages/:id/complete",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await completeMessage(req.params.id, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/messages/wait",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const timeoutSec = Number(req.query.timeout ?? 60);
    res.json(await waitForMessage(req.params.projectId, timeoutSec));
  }),
);

router.get(
  "/api/projects/:projectId/messages/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json(await listRecentMessages(req.params.projectId, limit));
  }),
);

router.get(
  "/api/projects/:projectId/messages/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const status = req.query.status as "pending" | "processing" | "delivered" | "active" | "all" | undefined;
    const origin = req.query.origin as MessageOrigin | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await listMessagesPaged(req.params.projectId, { status, origin, page, pageSize }));
  }),
);

export default router;
