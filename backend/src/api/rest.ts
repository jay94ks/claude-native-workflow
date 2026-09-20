// 설계자 지시(2026-09-21): "/api/actions 단일 엔드포인트 + command 패턴"은
// 애초에 CLI/MCP를 위한 설계였다 - 웹 인터페이스까지 그 하나의 엔드포인트로
// 몰아넣을 필요는 없고, 오히려 각 화면이 실제로 하는 일(문서 목록 조회,
// 파일 내용 읽기, PR 생성 등)에 맞는 독립된 REST 엔드포인트로 쪼개는 게
// 낫다는 판단. CLI/MCP는 여전히 `/api/actions`(+ `X-Cnw-Channel: agent`)를
// 쓰고, 이 라우터는 WEB UI 전용이다 - 핸들러 구현은 core/*.ts를 그대로
// 재사용(같은 함수, 같은 검증/권한 로직)하고 HTTP 표면만 REST로 다시 감싼다.

import { Router, type Request, type Response } from "express";
import * as documents from "../core/documents";
import * as remember from "../core/remember";
import * as messages from "../core/messages";
import * as repo from "../core/repo";
import * as projects from "../core/projects";
import * as templates from "../core/templates";
import * as webhooks from "../core/webhooks";
import * as repoBrowse from "../core/repoBrowse";
import * as pullRequests from "../core/pullRequests";
import { collectAndDeliver } from "../core/messages";
import { requireApiKey } from "./authMiddleware";
import { resolveChannel } from "../core/channel";
import type { ActionResult } from "../core/types";
import type { ActionContext } from "../core/documents";

type CoreFn = (payload: any, ctx: ActionContext) => Promise<ActionResult>;

function numOr(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * core/*.ts의 액션 핸들러(전부 `(payload, ctx) => ActionResult` 모양)를
 * REST 라우트 핸들러로 감싼다 - 이 한 곳에서만 크래시 안전성(actions.ts의
 * dispatch()가 CLI/MCP 경로에 해주는 것과 동치)과 notices piggyback을
 * 처리하면 모든 REST 엔드포인트에 자동 적용된다.
 */
function web(fn: CoreFn, buildPayload: (req: Request) => Record<string, unknown>, successStatus = 200) {
  return async (req: Request, res: Response) => {
    const ctx: ActionContext = { architectId: req.architectId!, channel: resolveChannel(req.header("x-cnw-channel")) };
    const payload = buildPayload(req);

    let result: ActionResult;
    try {
      result = await fn(payload, ctx);
    } catch (err) {
      console.error(`[rest] ${req.method} ${req.originalUrl} threw an uncaught error:`, err);
      return res.status(500).json({ error: [`처리 중 예상치 못한 오류가 발생했습니다: ${(err as Error).message}`] });
    }
    if (!result.ok) {
      return res.status(422).json({ error: result.reason ?? ["요청을 처리할 수 없습니다."] });
    }

    if (typeof payload.projectId === "string") {
      try {
        const notices = await collectAndDeliver(payload.projectId, ctx);
        if (notices.length > 0) {
          res.setHeader("X-Cnw-Notices", Buffer.from(JSON.stringify(notices), "utf-8").toString("base64"));
        }
      } catch (err) {
        console.warn("[rest] notices delivery failed (ignored):", (err as Error).message);
      }
    }

    res.status(successStatus).json(result.data ?? {});
  };
}

export const restRouter = Router();
restRouter.use(requireApiKey);

// ---- Projects ----
restRouter.get("/projects", web(projects.projectList, (req) => ({ page: numOr(req.query.page) })));
restRouter.post("/projects", web(projects.projectCreate, (req) => req.body, 201));
restRouter.get("/projects/invites-for-me", web(projects.projectInvitesForMe, () => ({})));
restRouter.get("/projects/:projectId", web(projects.projectGet, (req) => ({ projectId: req.params.projectId })));
restRouter.patch("/projects/:projectId", web(projects.projectUpdate, (req) => ({ projectId: req.params.projectId, ...req.body })));
restRouter.delete("/projects/:projectId", web(projects.projectDestroy, (req) => ({ projectId: req.params.projectId })));
restRouter.get("/projects/:projectId/members", web(projects.projectMembers, (req) => ({ projectId: req.params.projectId })));
restRouter.post("/projects/:projectId/invite", web(projects.projectInvite, (req) => ({ projectId: req.params.projectId, ...req.body })));
restRouter.post("/projects/:projectId/accept-invite", web(projects.projectAcceptInvite, (req) => ({ projectId: req.params.projectId })));
restRouter.post("/projects/:projectId/transfer", web(projects.projectTransfer, (req) => ({ projectId: req.params.projectId, ...req.body })));

// ---- Documents ----
restRouter.get(
  "/projects/:projectId/documents",
  web(documents.docsList, (req) => ({ projectId: req.params.projectId, ...req.query, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:projectId/documents",
  web(documents.docsAdd, (req) => ({ projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.get(
  "/projects/:projectId/documents/search",
  web(documents.docsSearch, (req) => ({ projectId: req.params.projectId, ...req.query, page: numOr(req.query.page) }))
);
restRouter.get("/projects/:projectId/documents/status", web(documents.docsStatus, (req) => ({ projectId: req.params.projectId })));
restRouter.get(
  "/projects/:projectId/documents/grep",
  web(documents.docsGrep, (req) => ({ projectId: req.params.projectId, code: req.query.code, pattern: req.query.pattern }))
);
restRouter.get(
  "/projects/:projectId/documents/:code",
  web(documents.docsGet, (req) => ({ projectId: req.params.projectId, code: req.params.code }))
);
restRouter.patch(
  "/projects/:projectId/documents/:code",
  web(documents.docsUpdate, (req) => ({ projectId: req.params.projectId, code: req.params.code, ...req.body }))
);
restRouter.delete(
  "/projects/:projectId/documents/:code",
  web(documents.docsDelete, (req) => ({ projectId: req.params.projectId, code: req.params.code, ...req.body }))
);
restRouter.post(
  "/projects/:projectId/documents/:code/transition",
  web(documents.docsTransition, (req) => ({
    projectId: req.params.projectId,
    state: { [req.params.code]: [req.body.to, req.body.from] },
  }))
);
restRouter.post(
  "/projects/:projectId/documents/:code/tag",
  web(documents.docsTag, (req) => ({ projectId: req.params.projectId, code: req.params.code, ...req.body }))
);

// ---- Repo (Code 탭) ----
restRouter.get("/projects/:projectId/repo/branches", web(repoBrowse.repoBranches, (req) => ({ projectId: req.params.projectId })));
restRouter.get(
  "/projects/:projectId/repo/tree",
  web(repoBrowse.repoTree, (req) => ({ projectId: req.params.projectId, branch: req.query.branch, path: req.query.path ?? "" }))
);
restRouter.get(
  "/projects/:projectId/repo/file",
  web(repoBrowse.repoFile, (req) => ({ projectId: req.params.projectId, branch: req.query.branch, path: req.query.path }))
);
restRouter.put(
  "/projects/:projectId/repo/file",
  web(repoBrowse.repoWriteFile, (req) => ({ projectId: req.params.projectId, ...req.body }))
);
restRouter.get(
  "/projects/:projectId/repo/commits",
  web(repoBrowse.repoCommits, (req) => ({ projectId: req.params.projectId, branch: req.query.branch, limit: numOr(req.query.limit) }))
);
restRouter.get(
  "/projects/:projectId/repo/commit-info",
  web(repoBrowse.repoCommitInfo, (req) => ({ projectId: req.params.projectId, commitId: req.query.commitId }))
);
restRouter.get(
  "/projects/:projectId/repo/commit-diff",
  web(repoBrowse.repoCommitDiff, (req) => ({ projectId: req.params.projectId, commitId: req.query.commitId }))
);
restRouter.get(
  "/projects/:projectId/repo/file-commits",
  web(repoBrowse.repoFileCommits, (req) => ({
    projectId: req.params.projectId,
    branch: req.query.branch,
    path: req.query.path,
    limit: numOr(req.query.limit),
  }))
);
restRouter.get(
  "/projects/:projectId/repo/diff",
  web(repoBrowse.repoDiffFile, (req) => ({ projectId: req.params.projectId, base: req.query.base, head: req.query.head, path: req.query.path }))
);
restRouter.post("/projects/:projectId/repo/push", web(repo.repoPush, (req) => ({ projectId: req.params.projectId, ...req.body })));

// ---- Pull requests ----
restRouter.get(
  "/projects/:projectId/pull-requests",
  web(pullRequests.prList, (req) => ({ projectId: req.params.projectId, state: req.query.state }))
);
restRouter.post(
  "/projects/:projectId/pull-requests",
  web(pullRequests.prCreate, (req) => ({ projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.get(
  "/projects/:projectId/pull-requests/:id",
  web(pullRequests.prGet, (req) => ({ projectId: req.params.projectId, id: req.params.id }))
);
restRouter.post(
  "/projects/:projectId/pull-requests/:id/merge",
  web(pullRequests.prMerge, (req) => ({ projectId: req.params.projectId, id: req.params.id }))
);
restRouter.post(
  "/projects/:projectId/pull-requests/:id/close",
  web(pullRequests.prClose, (req) => ({ projectId: req.params.projectId, id: req.params.id }))
);

// ---- Messages ----
restRouter.get(
  "/projects/:projectId/messages",
  web(messages.messageList, (req) => ({ projectId: req.params.projectId, state: req.query.state, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:projectId/messages",
  web(messages.messageSend, (req) => ({ projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.post(
  "/projects/:projectId/messages/:id/transition",
  web(messages.messageTransition, (req) => ({ projectId: req.params.projectId, id: req.params.id, state: req.body.state }))
);

// ---- Webhooks ----
restRouter.get("/projects/:projectId/webhooks", web(webhooks.webhookList, (req) => ({ projectId: req.params.projectId })));
restRouter.post(
  "/projects/:projectId/webhooks",
  web(webhooks.webhookAdd, (req) => ({ projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.delete(
  "/projects/:projectId/webhooks/:id",
  web(webhooks.webhookDelete, (req) => ({ projectId: req.params.projectId, id: req.params.id }))
);

// ---- Template (architect 계정 스코프 - 프로젝트와 무관) ----
restRouter.get("/template", web(templates.templateGet, () => ({})));
restRouter.put("/template", web(templates.templateSet, (req) => req.body));
restRouter.delete("/template", web(templates.templateDelete, () => ({})));
restRouter.post("/projects/:projectId/template/deploy", web(templates.templateDeploy, (req) => ({ projectId: req.params.projectId })));

// ---- Remember ----
restRouter.get(
  "/projects/:projectId/remember",
  web(remember.rememberList, (req) => ({ projectId: req.params.projectId, category: req.query.category, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:projectId/remember",
  web(remember.rememberAdd, (req) => ({ projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.patch(
  "/projects/:projectId/remember/:id",
  web(remember.rememberUpdate, (req) => ({ projectId: req.params.projectId, id: req.params.id, ...req.body }))
);
restRouter.delete(
  "/projects/:projectId/remember/:id",
  web(remember.rememberDelete, (req) => ({ projectId: req.params.projectId, id: req.params.id }))
);
