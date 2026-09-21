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
import * as accounts from "../core/accounts";
import * as apiKeys from "../core/apiKeys";
import * as webhooks from "../core/webhooks";
import * as repoBrowse from "../core/repoBrowse";
import * as pullRequests from "../core/pullRequests";
import { collectAndDeliver } from "../core/messages";
import { requireApiKey } from "./authMiddleware";
import { resolveChannel } from "../core/channel";
import { resolveProjectId } from "../core/projectResolve";
import { runWithKeyScope } from "../core/requestScope";
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
    let payload = buildPayload(req);

    // 설계자 요청(2026-09-21 후속) - project id는 이제 생성자(owner)별로만
    // 유일하다 - `:owner/:projectId` 경로 파라미터를 실제 내부 PK로
    // 여기 한 곳에서만 바꿔치기하면 core/*.ts의 기존 핸들러는 전혀 안
    // 건드려도 된다(actions.ts의 dispatch()와 동치인 REST 쪽 진입점).
    if (typeof payload.owner === "string" && typeof payload.projectId === "string") {
      const resolved = await resolveProjectId(payload.owner, payload.projectId);
      if (!resolved) {
        return res.status(404).json({ error: [`"${payload.owner}/${payload.projectId}" 프로젝트를 찾을 수 없습니다.`] });
      }
      payload = { ...payload, projectId: resolved };
    }

    let result: ActionResult;
    try {
      result = await runWithKeyScope(req.keyScope!, () => fn(payload, ctx));
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
restRouter.get("/projects/:owner/:projectId", web(projects.projectGet, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.patch("/projects/:owner/:projectId", web(projects.projectUpdate, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body })));
restRouter.delete("/projects/:owner/:projectId", web(projects.projectDestroy, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.get("/projects/:owner/:projectId/members", web(projects.projectMembers, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.post("/projects/:owner/:projectId/invite", web(projects.projectInvite, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body })));
restRouter.post("/projects/:owner/:projectId/accept-invite", web(projects.projectAcceptInvite, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.post("/projects/:owner/:projectId/transfer", web(projects.projectTransfer, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body })));
restRouter.post("/projects/:owner/:projectId/transfer-ownership", web(projects.projectTransferOwnership, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body })));

// ---- Documents ----
restRouter.get(
  "/projects/:owner/:projectId/documents",
  web(documents.docsList, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.query, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:owner/:projectId/documents",
  web(documents.docsAdd, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.get(
  "/projects/:owner/:projectId/documents/search",
  web(documents.docsSearch, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.query, page: numOr(req.query.page) }))
);
restRouter.get("/projects/:owner/:projectId/documents/status", web(documents.docsStatus, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.get(
  "/projects/:owner/:projectId/documents/grep",
  web(documents.docsGrep, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, code: req.query.code, pattern: req.query.pattern }))
);
restRouter.get(
  "/projects/:owner/:projectId/documents/:code",
  web(documents.docsGet, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, code: req.params.code }))
);
restRouter.patch(
  "/projects/:owner/:projectId/documents/:code",
  web(documents.docsUpdate, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, code: req.params.code, ...req.body }))
);
restRouter.delete(
  "/projects/:owner/:projectId/documents/:code",
  web(documents.docsDelete, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, code: req.params.code, ...req.body }))
);
restRouter.post(
  "/projects/:owner/:projectId/documents/:code/transition",
  web(documents.docsTransition, (req) => ({
    owner: req.params.owner,
    projectId: req.params.projectId,
    state: { [req.params.code]: [req.body.to, req.body.from] },
  }))
);
restRouter.post(
  "/projects/:owner/:projectId/documents/:code/tag",
  web(documents.docsTag, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, code: req.params.code, ...req.body }))
);

// ---- Repo (Code 탭) ----
restRouter.get("/projects/:owner/:projectId/repo/branches", web(repoBrowse.repoBranches, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.get(
  "/projects/:owner/:projectId/repo/tree",
  web(repoBrowse.repoTree, (req) => ({
    owner: req.params.owner,
    projectId: req.params.projectId,
    branch: req.query.branch,
    commitId: req.query.commitId,
    path: req.query.path ?? "",
  }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/file",
  web(repoBrowse.repoFile, (req) => ({
    owner: req.params.owner,
    projectId: req.params.projectId,
    branch: req.query.branch,
    commitId: req.query.commitId,
    path: req.query.path,
  }))
);
restRouter.put(
  "/projects/:owner/:projectId/repo/file",
  web(repoBrowse.repoWriteFile, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/commits",
  web(repoBrowse.repoCommits, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, branch: req.query.branch, limit: numOr(req.query.limit) }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/commit-info",
  web(repoBrowse.repoCommitInfo, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, commitId: req.query.commitId }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/commit-diff",
  web(repoBrowse.repoCommitDiff, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, commitId: req.query.commitId }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/file-commits",
  web(repoBrowse.repoFileCommits, (req) => ({
    owner: req.params.owner,
    projectId: req.params.projectId,
    branch: req.query.branch,
    path: req.query.path,
    limit: numOr(req.query.limit),
  }))
);
restRouter.get(
  "/projects/:owner/:projectId/repo/diff",
  web(repoBrowse.repoDiffFile, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, base: req.query.base, head: req.query.head, path: req.query.path }))
);
restRouter.post("/projects/:owner/:projectId/repo/push", web(repo.repoPush, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body })));
restRouter.post("/projects/:owner/:projectId/repo/connect-gitea", web(repo.repoConnectGitea, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));

// ---- Pull requests ----
restRouter.get(
  "/projects/:owner/:projectId/pull-requests",
  web(pullRequests.prList, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, state: req.query.state }))
);
restRouter.post(
  "/projects/:owner/:projectId/pull-requests",
  web(pullRequests.prCreate, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.get(
  "/projects/:owner/:projectId/pull-requests/:id",
  web(pullRequests.prGet, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id }))
);
restRouter.patch(
  "/projects/:owner/:projectId/pull-requests/:id",
  web(pullRequests.prUpdate, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id, ...req.body }))
);
restRouter.post(
  "/projects/:owner/:projectId/pull-requests/:id/merge",
  web(pullRequests.prMerge, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id }))
);
restRouter.post(
  "/projects/:owner/:projectId/pull-requests/:id/close",
  web(pullRequests.prClose, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id }))
);

// ---- Messages ----
restRouter.get(
  "/projects/:owner/:projectId/messages",
  web(messages.messageList, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, state: req.query.state, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:owner/:projectId/messages",
  web(messages.messageSend, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.post(
  "/projects/:owner/:projectId/messages/:id/transition",
  web(messages.messageTransition, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id, state: req.body.state }))
);

// ---- Webhooks ----
restRouter.get("/projects/:owner/:projectId/webhooks", web(webhooks.webhookList, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));
restRouter.post(
  "/projects/:owner/:projectId/webhooks",
  web(webhooks.webhookAdd, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.delete(
  "/projects/:owner/:projectId/webhooks/:id",
  web(webhooks.webhookDelete, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id }))
);

// ---- Template (architect 계정 스코프 - 프로젝트와 무관) ----
restRouter.get("/template", web(templates.templateGet, () => ({})));
restRouter.put("/template", web(templates.templateSet, (req) => req.body));
restRouter.delete("/template", web(templates.templateDelete, () => ({})));
restRouter.post("/projects/:owner/:projectId/template/deploy", web(templates.templateDeploy, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));

// ---- Account 관리(docs/plan-account-management.md - 프로젝트와 무관, 시스템 전체 스코프) ----
restRouter.get("/accounts", web(accounts.accountList, () => ({})));
restRouter.get("/account/me", web(accounts.accountMe, () => ({})));
restRouter.put("/account/password", web(accounts.accountChangePassword, (req) => req.body));
restRouter.put("/account/nickname", web(accounts.accountUpdateNickname, (req) => req.body));
restRouter.post("/accounts/:accountId/reset-password", web(accounts.accountResetPassword, (req) => ({ accountId: req.params.accountId })));
restRouter.post("/accounts/:accountId/disable", web(accounts.accountDisable, (req) => ({ accountId: req.params.accountId })));
restRouter.post("/accounts/:accountId/enable", web(accounts.accountEnable, (req) => ({ accountId: req.params.accountId })));
restRouter.delete("/accounts/:accountId", web(accounts.accountDelete, (req) => ({ accountId: req.params.accountId })));

// ---- API 키(docs/plan-nickname-apikey-policy.md - 계정 스코프, personal 키는 프로젝트와 무관/project 키는 그 프로젝트) ----
restRouter.get("/api-keys", web(apiKeys.apiKeyList, () => ({})));
restRouter.post("/api-keys", web(apiKeys.apiKeyCreate, (req) => req.body, 201));
restRouter.delete("/api-keys/:keyId", web(apiKeys.apiKeyRevoke, (req) => ({ keyId: req.params.keyId })));
restRouter.get("/projects/:owner/:projectId/api-keys", web(apiKeys.apiKeyListForProject, (req) => ({ owner: req.params.owner, projectId: req.params.projectId })));

// ---- Remember ----
restRouter.get(
  "/projects/:owner/:projectId/remember",
  web(remember.rememberList, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, category: req.query.category, page: numOr(req.query.page) }))
);
restRouter.post(
  "/projects/:owner/:projectId/remember",
  web(remember.rememberAdd, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, ...req.body }), 201)
);
restRouter.patch(
  "/projects/:owner/:projectId/remember/:id",
  web(remember.rememberUpdate, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id, ...req.body }))
);
restRouter.delete(
  "/projects/:owner/:projectId/remember/:id",
  web(remember.rememberDelete, (req) => ({ owner: req.params.owner, projectId: req.params.projectId, id: req.params.id }))
);
