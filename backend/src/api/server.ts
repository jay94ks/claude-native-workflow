#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { connectDb } from "../core/db.js";
import { register, login, refresh, logout, AuthError, assertJwtSecretConfigured } from "../core/auth.js";
import { assertCredentialEncryptionKeyConfigured } from "../core/crypto.js";
import { addGitCredential, listGitCredentials, removeGitCredential } from "../core/gitCredentials.js";
import { createInstitution, listInstitutions } from "../core/institutions.js";
import { getInstallConfig } from "../core/installConfig.js";
import { createProjectGroup, listProjectGroups } from "../core/projectGroups.js";
import { createProject, getProject, listProjects } from "../core/projects.js";
import { addMember, listMembers } from "../core/members.js";
import { createDocType, listDocTypes, listDocStatuses } from "../core/docTypes.js";
import {
  createDocument,
  getDocument,
  listDocuments,
  searchProjectDocuments,
  saveDocumentBody,
  transitionDocumentStatus,
  addDocumentLink,
  listBacklinks,
  listDocumentRevisions,
} from "../core/documents.js";
import { createReport } from "../core/report.js";
import { addQuestion, listPendingQuestions, answerQuestion } from "../core/questions.js";
import { addComment, listComments, resolveComment } from "../core/comments.js";
import { resolveTemplate, setTemplateOverride, seedDefaultTemplates } from "../core/templates.js";
import { ensureSearchIndexes } from "../core/search.js";
import { authenticate, requireProjectRole, type AuthedRequest } from "../middleware/auth.js";
import { linkSelfHostedRepo, linkExternalRepo, getProjectGitRepo, getWebhookSecret, requireSelfHostedRepo, slugForProject } from "../core/gitRepos.js";
import * as gitea from "../core/gitea.js";
import { verifyAndParseWebhook, recordPushEvent } from "../core/pushHooks.js";
import {
  createPushHookPrompt,
  listPushHookPrompts,
  deletePushHookPrompt,
  listQueueEntries,
  acknowledgeQueueEntry,
  completeQueueEntry,
} from "../core/pushHookPrompts.js";
import { sendMessage, listMessages, waitForMessage } from "../core/messages.js";
import { checkConnect, checkAcl, ensureEmqxAuthConfigured } from "../core/emqxAuth.js";

const app = express();
// verify로 원본 바이트를 req.rawBody에 보존 - 웹훅 서명 검증은 express가
// 재직렬화한 JSON이 아니라 실제로 전송된 원본 바이트에 대해 계산해야
// 한다(재직렬화 시 키 순서/공백 차이로 서명이 어긋날 수 있음).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

function asyncRoute(
  fn: (req: AuthedRequest, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req as AuthedRequest, res).catch(next);
  };
}

// ---------------------------------------------------------------- 인증

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const { username, email, password } = req.body as { username?: string; email?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "username/password가 필요합니다" });
      return;
    }
    res.json(await register({ username, email, password }));
  }),
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const { username_or_email, password } = req.body as { username_or_email?: string; password?: string };
    if (!username_or_email || !password) {
      res.status(400).json({ error: "username_or_email/password가 필요합니다" });
      return;
    }
    res.json(await login(username_or_email, password));
  }),
);

app.post(
  "/api/auth/refresh",
  asyncRoute(async (req, res) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) {
      res.status(400).json({ error: "refresh_token이 필요합니다" });
      return;
    }
    res.json(await refresh(refresh_token));
  }),
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (refresh_token) await logout(refresh_token);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- git 자격증명

app.post(
  "/api/credentials",
  authenticate,
  asyncRoute(async (req, res) => {
    const { credentialType, value, hostPattern } = req.body as {
      credentialType?: string;
      value?: string;
      hostPattern?: string;
    };
    if (!credentialType || !value) {
      res.status(400).json({ error: "credentialType/value가 필요합니다" });
      return;
    }
    res.json(await addGitCredential(req.userId!, credentialType, value, hostPattern));
  }),
);

app.get(
  "/api/credentials",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listGitCredentials(req.userId!));
  }),
);

app.delete(
  "/api/credentials/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    await removeGitCredential(req.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 설치 전역 설정

app.get(
  "/api/install-config",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json(await getInstallConfig());
  }),
);

// 웹 UI가 EMQX에 MQTT-over-WebSocket으로 직접 붙을 때 쓸 접속 주소 조회 -
// PUBLIC_BACKEND_URL과 같은 이유로 브라우저는 docker 네트워크 밖에 있어
// emqx:8083이 아니라 호스트에 노출된 주소가 필요하다. 미설정이면 null -
// 다른 모든 EMQX 통합 지점과 같은 fail-soft 원칙(실시간 갱신만 조용히
// 꺼짐). 문서/워크플로우 상태 조회가 아니라 브라우저의 런타임 접속
// 정보라 CLI/MCP 미러는 불필요(install-config와 같은 판단).
app.get(
  "/api/realtime-config",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json({ mqttWsUrl: process.env.PUBLIC_EMQX_WS_URL ?? null });
  }),
);

// ---------------------------------------------------------------- 기관/그룹/프로젝트

app.post(
  "/api/institutions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createInstitution(name));
  }),
);

app.get(
  "/api/institutions",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json(await listInstitutions());
  }),
);

app.post(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name, institutionId } = req.body as { name?: string; institutionId?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createProjectGroup(name, institutionId));
  }),
);

app.get(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjectGroups(req.query.institutionId as string | undefined));
  }),
);

app.post(
  "/api/projects",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name, projectGroupId } = req.body as { name?: string; projectGroupId?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    const project = await createProject(name, projectGroupId);
    await addMember(project.id, req.userId!, "owner");
    res.json(project);
  }),
);

app.get(
  "/api/projects",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjects(req.query.projectGroupId as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    res.json(project);
  }),
);

app.post(
  "/api/projects/:projectId/members",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || !role) { res.status(400).json({ error: "userId/role이 필요합니다" }); return; }
    res.json(await addMember(req.params.projectId, userId, role));
  }),
);

app.get(
  "/api/projects/:projectId/members",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMembers(req.params.projectId));
  }),
);

// ---------------------------------------------------------------- 문서 타입 체계

app.post(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { code, label } = req.body as { code?: string; label?: string };
    if (!code || !label) { res.status(400).json({ error: "code/label이 필요합니다" }); return; }
    res.json(await createDocType({ projectId: req.params.projectId }, code, label));
  }),
);

app.get(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes({ projectId: req.params.projectId }));
  }),
);

app.get(
  "/api/doc-types/:docTypeId/statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocStatuses(req.params.docTypeId));
  }),
);

// ---------------------------------------------------------------- 문서

app.post(
  "/api/projects/:projectId/documents",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { docTypeCode, title, body } = req.body as { docTypeCode?: string; title?: string; body?: string };
    if (!docTypeCode || !title || body === undefined) {
      res.status(400).json({ error: "docTypeCode/title/body가 필요합니다" });
      return;
    }
    res.json(
      await createDocument({
        projectId: req.params.projectId,
        docTypeCode,
        title,
        body,
        createdBy: req.userId!,
      }),
    );
  }),
);

app.get(
  "/api/projects/:projectId/documents",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocuments(req.params.projectId, req.query.docTypeId as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/search",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    res.json(await searchProjectDocuments(req.params.projectId, q));
  }),
);

app.get(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    res.json(doc);
  }),
);

app.put(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (body === undefined) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await saveDocumentBody(req.params.trackingCode, body, req.userId!));
  }),
);

app.post(
  "/api/documents/:trackingCode/transition",
  authenticate,
  asyncRoute(async (req, res) => {
    const { toStatusCode } = req.body as { toStatusCode?: string };
    if (!toStatusCode) { res.status(400).json({ error: "toStatusCode가 필요합니다" }); return; }
    res.json(await transitionDocumentStatus(req.params.trackingCode, toStatusCode));
  }),
);

app.post(
  "/api/documents/:trackingCode/links",
  authenticate,
  asyncRoute(async (req, res) => {
    const { toTrackingCode, linkType } = req.body as { toTrackingCode?: string; linkType?: string };
    if (!toTrackingCode) { res.status(400).json({ error: "toTrackingCode가 필요합니다" }); return; }
    await addDocumentLink(req.params.trackingCode, toTrackingCode, linkType);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/documents/:trackingCode/backlinks",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listBacklinks(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocumentRevisions(req.params.trackingCode));
  }),
);

// ---------------------------------------------------------------- 보고서

app.post(
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

// ---------------------------------------------------------------- 질의/답변 (pending/reply)

app.post(
  "/api/documents/:trackingCode/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text) { res.status(400).json({ error: "text가 필요합니다" }); return; }
    res.json(await addQuestion(req.params.trackingCode, text));
  }),
);

app.get(
  "/api/projects/:projectId/pending",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listPendingQuestions(req.params.projectId));
  }),
);

app.post(
  "/api/questions/:trackingCode/answer",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await answerQuestion(req.params.trackingCode, body, req.userId!));
  }),
);

// ---------------------------------------------------------------- 코멘트

app.post(
  "/api/projects/:projectId/documents/:trackingCode/comments",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await addComment(req.params.projectId, req.params.trackingCode, body, req.userId!));
  }),
);

app.get(
  "/api/projects/:projectId/documents/:trackingCode/comments",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listComments(req.params.trackingCode));
  }),
);

app.post(
  "/api/projects/:projectId/comments/:id/resolve",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await resolveComment(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 템플릿 (CLAUDE.md, SKILL.md 등)
// filename이 ".claude/skills/.../SKILL.md"처럼 슬래시를 포함할 수 있어
// 경로 세그먼트(:filename) 대신 쿼리스트링으로 받는다(Express 경로
// 매칭이 슬래시 포함 값을 세그먼트 하나로 다루지 못함).

app.get(
  "/api/templates",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    if (!filename) { res.status(400).json({ error: "filename이 필요합니다" }); return; }
    const projectId = req.query.projectId as string | undefined;
    const resolved = await resolveTemplate(filename, projectId);
    if (!resolved) { res.status(404).json({ error: "not found" }); return; }
    res.json(resolved);
  }),
);

app.put(
  "/api/templates",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    if (!filename) { res.status(400).json({ error: "filename이 필요합니다" }); return; }
    const { content, institutionId, projectGroupId, projectId } = req.body as {
      content?: string;
      institutionId?: string;
      projectGroupId?: string;
      projectId?: string;
    };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
    res.json(await setTemplateOverride(filename, { institutionId, projectGroupId, projectId }, content));
  }),
);

// ---------------------------------------------------------------- 아직 미구현 (자리만 등록 - "CLI/MCP 명령어 완전성" 원칙)
// diff 계열은 Gitea 통합(Phase 2), message send/wait는 EMQX 구독 측
// (Phase 4)에서 실제로 채운다 - 그때까지는 명확한 501을 반환한다(조용히
// 실패하거나 라우트 자체가 없는 상태를 만들지 않음).

function notImplemented(feature: string, phase: string) {
  return (_req: Request, res: Response) => {
    res.status(501).json({ error: `${feature}는 아직 구현되지 않았습니다(${phase}에서 구현 예정)` });
  };
}

// ---------------------------------------------------------------- 인스턴스 메시징 (Phase 4)

app.get(
  "/api/projects/:projectId/messages",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMessages(req.params.projectId));
  }),
);

app.post(
  "/api/projects/:projectId/messages",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await sendMessage(req.params.projectId, req.userId!, body));
  }),
);

app.get(
  "/api/projects/:projectId/messages/wait",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const timeoutSec = Number(req.query.timeout ?? 60);
    res.json(await waitForMessage(req.params.projectId, timeoutSec));
  }),
);

// ---------------------------------------------------------------- EMQX 클라이언트 인증/인가 (Phase 4 - 인증 미들웨어 없음, EMQX가 직접 호출)

app.post(
  "/api/emqx/authn",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const result = checkConnect(username, password);
    res.json({ result });
  }),
);

app.post(
  "/api/emqx/authz",
  asyncRoute(async (req, res) => {
    const { username, topic } = req.body as { username?: string; topic?: string };
    const result = await checkAcl(username, topic);
    res.json({ result });
  }),
);

// ---------------------------------------------------------------- git 저장소 연결 + 이력 조회 (Phase 2)

app.post(
  "/api/projects/:projectId/git/link",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await linkSelfHostedRepo(req.params.projectId));
  }),
);

app.post(
  "/api/projects/:projectId/git/link-external",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { provider, repoUrl, gitCredentialId } = req.body as {
      provider?: string;
      repoUrl?: string;
      gitCredentialId?: string;
    };
    if (provider !== "github" && provider !== "gitlab") {
      res.status(400).json({ error: "provider는 github|gitlab이어야 합니다" });
      return;
    }
    if (!repoUrl) { res.status(400).json({ error: "repoUrl이 필요합니다" }); return; }
    res.json(await linkExternalRepo(req.params.projectId, provider, repoUrl, gitCredentialId));
  }),
);

app.get(
  "/api/projects/:projectId/git/repo",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const repo = await getProjectGitRepo(req.params.projectId);
    if (!repo) { res.status(404).json({ error: "연결된 git 저장소가 없습니다" }); return; }
    res.json(repo);
  }),
);

app.get(
  "/api/projects/:projectId/git/log",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    res.json(await gitea.listCommits(slugForProject(req.params.projectId), { ref }));
  }),
);

app.get(
  "/api/projects/:projectId/git/diff/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const diff = await gitea.getCommitDiff(slugForProject(req.params.projectId), req.params.sha);
    res.type("text/plain").send(diff);
  }),
);

app.get(
  "/api/projects/:projectId/git/blame",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const filepath = req.query.path as string | undefined;
    if (!filepath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getBlame(slugForProject(req.params.projectId), filepath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/show/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    res.json(await gitea.getCommit(slugForProject(req.params.projectId), req.params.sha));
  }),
);

// ---------------------------------------------------------------- git 트리/파일 조회·저장 (Phase 5(2/3) - 소스 코드 브라우저용)

app.get(
  "/api/projects/:projectId/git/tree",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const dirPath = (req.query.path as string | undefined) ?? "";
    res.json(await gitea.listTree(slugForProject(req.params.projectId), dirPath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getFileContent(slugForProject(req.params.projectId), filePath, req.query.ref as string | undefined));
  }),
);

app.put(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await requireSelfHostedRepo(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const { content, message } = req.body as { content?: string; message?: string };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
    await gitea.putFileContent(slugForProject(req.params.projectId), filePath, content, message || `docs: update ${filePath}`);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 웹훅 수신 (인증 미들웨어 없음 - Gitea/GitHub/GitLab이 직접 호출, 서명/토큰으로 검증)

app.post(
  "/api/webhooks/:provider/:projectId",
  asyncRoute(async (req, res) => {
    const { provider, projectId } = req.params;
    const secret = await getWebhookSecret(projectId);
    if (!secret) { res.status(404).json({ error: "연결된 git 저장소가 없습니다" }); return; }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    let parsed;
    try {
      parsed = verifyAndParseWebhook(provider, req.headers as Record<string, string | string[] | undefined>, rawBody, secret);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const queued = await recordPushEvent(projectId, parsed);
    res.json({ ok: true, queued });
  }),
);

// ---------------------------------------------------------------- git push 훅 프롬프트 자동화 (Phase 3 - 대기열 방식)

app.post(
  "/api/projects/:projectId/push-hook-prompts",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { triggerBranch, promptTemplate } = req.body as { triggerBranch?: string; promptTemplate?: string };
    if (!promptTemplate) { res.status(400).json({ error: "promptTemplate이 필요합니다" }); return; }
    res.json(await createPushHookPrompt(req.params.projectId, { triggerBranch, promptTemplate }));
  }),
);

app.get(
  "/api/projects/:projectId/push-hook-prompts",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listPushHookPrompts(req.params.projectId));
  }),
);

app.delete(
  "/api/projects/:projectId/push-hook-prompts/:id",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await deletePushHookPrompt(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/projects/:projectId/push-hook-queue",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listQueueEntries(req.params.projectId, req.query.status as string | undefined));
  }),
);

app.post(
  "/api/projects/:projectId/push-hook-queue/:id/ack",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await acknowledgeQueueEntry(req.params.id);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/projects/:projectId/push-hook-queue/:id/done",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await completeQueueEntry(req.params.id);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 템플릿 배포 (Phase 2 - Gitea 저장소 루트에 실제 커밋)

app.post(
  "/api/projects/:projectId/templates/deploy",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const projectId = req.params.projectId;
    await requireSelfHostedRepo(projectId);
    const slug = slugForProject(projectId);
    const deployed: string[] = [];

    const claudeMd = await resolveTemplate("CLAUDE.md", projectId);
    if (claudeMd) {
      await gitea.putFileContent(slug, "CLAUDE.md", claudeMd.content, "docs: deploy CLAUDE.md template");
      deployed.push("CLAUDE.md");
    }
    const skillFilename = ".claude/skills/claude-native-workflow/SKILL.md";
    const skillMd = await resolveTemplate(skillFilename, projectId);
    if (skillMd) {
      await gitea.putFileContent(slug, skillFilename, skillMd.content, "docs: deploy SKILL.md template");
      deployed.push(skillFilename);
    }

    res.json({ ok: true, deployed });
  }),
);

// ---------------------------------------------------------------- 프런트엔드 정적 서빙 (Phase 5)
// 별도 컨테이너/포트를 안 띄운다 - "단일 설치형" 원칙에 맞춰 backend가
// frontend/dist 빌드 결과물을 그대로 서빙한다. 모든 /api 라우트보다
// 뒤에 등록해야 한다(SPA 폴백이 /api/* 404를 가로채면 안 됨). frontend가
// 아직 빌드 안 됐으면(로컬 API 전용 개발 등) 조용히 건너뛴다.
const frontendDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ---------------------------------------------------------------- 에러 핸들러

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthError) { res.status(400).json({ error: err.message }); return; }
  // 알 수 없는 예외는 서버 로그에만 자세히 남기고, 응답은 일반화한다 -
  // concept 세션 QA로 발견: 안 그러면 fs/Prisma 에러 메시지에 섞인
  // 서버 내부 경로 구조가 클라이언트에 그대로 노출된다.
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
});

async function main() {
  assertJwtSecretConfigured();
  assertCredentialEncryptionKeyConfigured();
  await connectDb();
  await ensureSearchIndexes();
  await seedDefaultTemplates();
  await ensureEmqxAuthConfigured();

  const port = Number(process.env.PORT ?? 8760);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`claude-native-workflow backend: http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
