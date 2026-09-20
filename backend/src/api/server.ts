import express from "express";
import { authRouter } from "./auth";
import { requireApiKey } from "./authMiddleware";
import { dispatch, type ActionRequest } from "./actions";
import { restRouter } from "./rest";
import { resolveChannel } from "../core/channel";
import { collectAndDeliver } from "../core/messages";
import { startBroadcastSubscriber } from "../core/broadcastSubscriber";

startBroadcastSubscriber();

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 인증은 액션 체계 밖 별도 엔드포인트 (docs/design-notes.md "API - 단일 엔드포인트(+ 인증은 예외)").
app.use("/api/auth", authRouter);

// 단일 엔드포인트 + command 패턴 - 조회/변경 구분 없이 액션 배열을 이걸로만 보낸다.
app.post("/api/actions", requireApiKey, async (req, res) => {
  const actions = req.body;
  if (!Array.isArray(actions)) {
    return res.status(400).json({ error: "request body must be a JSON array of actions" });
  }

  const ctx = { architectId: req.architectId!, channel: resolveChannel(req.header("x-cnw-channel")) };
  const result = await Promise.all((actions as ActionRequest[]).map((action) => dispatch(action, ctx)));

  // design-notes.md "메시지 시스템": 예외 없이 모든 응답에 통합되어 함께
  // 발신되는 구조 - 이 요청이 건드린 프로젝트들에 대해 미전달 메시지를 모은다.
  const projectIds = [...new Set((actions as ActionRequest[]).map((a) => a.projectId).filter((p): p is string => typeof p === "string"))];
  const noticeLists = await Promise.all(projectIds.map((projectId) => collectAndDeliver(projectId, ctx)));
  const notices = noticeLists.flat();

  res.json({
    notices,
    status: "ok",
    result,
  });
});

// 설계자 지시(2026-09-21): 위 /api/actions는 CLI/MCP(shared/apiclient.ts,
// 항상 X-Cnw-Channel: agent를 싣는다) 전용으로 남기고, WEB UI는 액션별로
// 쪼갠 REST 엔드포인트를 쓴다 - backend/src/api/rest.ts.
app.use("/api", restRouter);

const port = Number(process.env.PORT ?? 8388);
app.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
