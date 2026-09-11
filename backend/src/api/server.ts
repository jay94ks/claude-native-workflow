#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { connectDb } from "../core/db.js";
import {
  register,
  login,
  refresh,
  logout,
  AuthError,
  assertJwtSecretConfigured,
  seedDefaultAdminAccount,
  getMe,
  updateMe,
  getPublicProfile,
  listUsers,
  isSuperAdmin,
} from "../core/auth.js";
import { LoginRateLimitError } from "../core/loginRateLimit.js";
import { assertCredentialEncryptionKeyConfigured } from "../core/crypto.js";
import { addGitCredential, listGitCredentials, removeGitCredential } from "../core/gitCredentials.js";
import { createTeam, listTeams, updateTeam, deleteTeam, listMembersForTeam } from "../core/teams.js";
import {
  ensureAllUsersGiteaAccountsConfigured,
  getGiteaAccessToken,
  regenerateGiteaAccessToken,
} from "../core/giteaAccounts.js";
import { addTeamAdmin, removeTeamAdmin, listTeamAdmins, isTeamAllowedByActiveScope } from "../core/teamAdmins.js";
import { getInstallConfig, getGiteaSystemWebhookSecret } from "../core/installConfig.js";
import {
  createProjectGroup,
  listProjectGroups,
  isGroupAllowedByActiveScope,
  updateProjectGroup,
  deleteProjectGroup,
  listMembersForGroup,
} from "../core/projectGroups.js";
import {
  addProjectGroupAdmin,
  removeProjectGroupAdmin,
  listProjectGroupAdmins,
  isProjectGroupAdmin,
} from "../core/projectGroupAdmins.js";
import {
  createProject,
  getProject,
  listProjects,
  canSeeHiddenProject,
  setProjectHidden,
  deleteProject,
  getOwningTeamId,
  listAccessibleProjectIdsInScope,
  getProjectNamesByIds,
  type SearchScope,
} from "../core/projects.js";
import {
  addMember,
  listMembers,
  getMemberRole,
  roleSatisfies,
  isProjectAllowedByActiveScope,
  removeMember,
  updateMemberRole,
} from "../core/members.js";
import { isTeamAdmin } from "../core/teamAdmins.js";
import { getActiveKeyScope } from "../core/requestScope.js";
import { listUserActivity } from "../core/activity.js";
import {
  createDocType,
  listDocTypes,
  listDocStatuses,
  addDocStatus,
  getDocTypeById,
  addDocStatusTransitionByCode,
  listDocStatusTransitions,
  seedStandardStatusFlow,
  setDocTypeGuideline,
  allowedNextStatuses,
} from "../core/docTypes.js";
import {
  createDocument,
  getDocument,
  listDocuments,
  listDocumentsPaged,
  listRecentDocuments,
  searchProjectDocuments,
  saveDocumentBody,
  transitionDocumentStatus,
  addDocumentLink,
  listBacklinks,
  listDocumentRevisions,
  deleteDocument,
} from "../core/documents.js";
import { addSourceLink, removeSourceLink, listSourceLinks } from "../core/documentSourceLinks.js";
import { createReport } from "../core/report.js";
import {
  addQuestion,
  addQuestionByTrackingCode,
  resolveTargetByTrackingCode,
  listPendingQuestions,
  answerQuestion,
  listQuestions,
  listQuestionsPaged,
  getQuestionProjectId,
  acknowledgeQuestion,
  countPendingQuestions,
} from "../core/questions.js";
import {
  addComment,
  listComments,
  editComment,
  deleteComment,
  listRecentComments,
  setCommentStatus,
} from "../core/comments.js";
import { resolveTemplate, setTemplateOverride, seedDefaultTemplates } from "../core/templates.js";
import { ensureSearchIndexes, searchDocumentsWithSnippets, searchSourceFiles } from "../core/search.js";
import { backfillProjectSourceIndex, syncSourceFileOnSave } from "../core/sourceIndex.js";
import { resolveEffectivePermission, setAccessOverride, listAccessOverrides } from "../core/permissions.js";
import { createFolder, renameFolder, deleteFolder, reorderFolder, listFolders, listFolderDocuments, moveDocumentToFolder } from "../core/folders.js";
import {
  createKanbanColumn,
  listKanbanColumnsForUser,
  getKanbanColumnProjectId,
  setColumnHiddenForUser,
  reorderColumnsForUser,
  createKanbanCard,
  listKanbanCards,
  getKanbanCardByTrackingCode,
  moveKanbanCard,
  setKanbanCardHidden,
} from "../core/kanban.js";
import {
  createApiKey,
  listProjectKeys,
  listTeamKeys,
  listMyPersonalKeys,
  getApiKeyById,
  revokeApiKey,
  ApiKeyError,
} from "../core/apiKeys.js";
import { authenticate, requireProjectRole, requireUnrestrictedScope, type AuthedRequest } from "../middleware/auth.js";
import {
  linkSelfHostedRepo,
  linkExternalAsPrimary,
  getProjectGitRepo,
  getWebhookSecret,
  requireGiteaWorkingSlug,
  requestGitSyncStatus,
  getCachedGitSyncStatus,
  getGitSyncProposal,
  publishToExternalRepo,
  getPendingPublishQueueEntry,
  completePublishQueueEntry,
  GitAuthRequiredError,
} from "../core/gitRepos.js";
import * as gitea from "../core/gitea.js";
import { verifyAndParseWebhook, recordPushEvent, handleGiteaSystemPush } from "../core/pushHooks.js";
import {
  createPushHookPrompt,
  listPushHookPrompts,
  deletePushHookPrompt,
  listQueueEntries,
  acknowledgeQueueEntry,
  completeQueueEntry,
} from "../core/pushHookPrompts.js";
import { sendMessage, listMessages, listMessagesPaged, waitForMessage, listRecentMessages } from "../core/messages.js";
import { checkConnect, checkAcl, ensureEmqxAuthConfigured } from "../core/emqxAuth.js";

const app = express();
// verify로 원본 바이트를 req.rawBody에 보존 - 웹훅 서명 검증은 express가
// 재직렬화한 JSON이 아니라 실제로 전송된 원본 바이트에 대해 계산해야
// 한다(재직렬화 시 키 순서/공백 차이로 서명이 어긋날 수 있음).
// limit 기본값(100kb)은 문서 본문(마크다운, 로그성 문서는 쉽게 넘김 -
// 가이디드 마이그레이션(Phase 6) 실측 중 실제 concept 브랜치의
// DN-00001.md(약 120KB)가 이 기본값에 막혀 "request entity too large"로
// 실패하는 걸 직접 겪었다) 크기에 비해 너무 작다 - 넉넉히 올려둔다.
app.use(
  express.json({
    limit: "10mb",
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
    res.json(await login(username_or_email, password, req.ip ?? "unknown"));
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
  requireUnrestrictedScope,
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
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(await listGitCredentials(req.userId!));
  }),
);

app.delete(
  "/api/credentials/:id",
  authenticate,
  requireUnrestrictedScope,
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

// ---------------------------------------------------------------- 프로필/사용자

app.get(
  "/api/auth/me",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await getMe(req.userId!));
  }),
);

app.put(
  "/api/auth/me",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { email, phone, emailVisible, phoneVisible, nickname } = req.body as {
      email?: string;
      phone?: string;
      emailVisible?: boolean;
      phoneVisible?: boolean;
      nickname?: string;
    };
    res.json(await updateMe(req.userId!, { email, phone, emailVisible, phoneVisible, nickname }));
  }),
);

// Gitea 개인 접근 토큰 재발급 - 기존 토큰을 지우고 새로 발급해 응답에
// 딱 한 번 평문으로 실어 보낸다(ApiKey 생성 시 노출 패턴과 동일). 신원/
// 자격증명 관리라 requireUnrestrictedScope(스코프 있는 키로는 불가).
app.post(
  "/api/auth/me/git-token",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const token = await regenerateGiteaAccessToken(req.userId!);
    const user = await getMe(req.userId!);
    res.json({ username: user.giteaUsername, token });
  }),
);

// 사용자 선택기(엔티티 선택기 kind="user")용 - 이 시스템엔 조직 간
// 격리가 없어(단일 설치) 로그인한 누구나 설계자 목록을 검색할 수 있다.
app.get(
  "/api/users",
  authenticate,
  asyncRoute(async (req, res) => {
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await listUsers(search, limit));
  }),
);

app.get(
  "/api/users/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await getPublicProfile(req.userId!, req.params.userId));
  }),
);

app.get(
  "/api/users/:userId/activity",
  authenticate,
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    res.json(await listUserActivity(req.userId!, req.params.userId, limit));
  }),
);

// ---------------------------------------------------------------- 팀/그룹/프로젝트

app.post(
  "/api/teams",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createTeam(name, req.userId!));
  }),
);

app.get(
  "/api/teams",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeams(req.userId!));
  }),
);

app.put(
  "/api/teams/:teamId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 수정할 수 있습니다" });
      return;
    }
    const { name, enabled } = req.body as { name?: string; enabled?: boolean };
    res.json(await updateTeam(req.params.teamId, { name, enabled }));
  }),
);

app.delete(
  "/api/teams/:teamId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 삭제할 수 있습니다" });
      return;
    }
    await deleteTeam(req.params.teamId);
    res.json({ ok: true });
  }),
);

// 팀 멤버 가시성(보안 요구사항) - 그 팀 산하 전체 프로젝트의 멤버를
// 관리자만 볼 수 있다.
app.get(
  "/api/teams/:teamId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(await listMembersForTeam(req.params.teamId));
  }),
);

// 팀장 관리 - API 키의 "어느 팀까지"(스코프) 제한에 더해, 실제로 그
// 팀의 팀장인지도 확인한다(과거엔 authenticate만 요구해 아무 설계자나
// 자기 자신을 팀장으로 등록할 수 있었다 - 이번 보안 강화 라운드에서
// 발견해 닫은 허점. 새로 만든 팀은 생성자가 자동으로 팀장 등록돼
// 있으니 이 요구를 항상 만족한다).
app.post(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 팀장을 등록할 수 있습니다" });
      return;
    }
    const { userId } = req.body as { userId?: string };
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    res.json(await addTeamAdmin(req.params.teamId, userId));
  }),
);

app.delete(
  "/api/teams/:teamId/admins/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 팀장을 해제할 수 있습니다" });
      return;
    }
    await removeTeamAdmin(req.params.teamId, req.params.userId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listTeamAdmins(req.params.teamId));
  }),
);

// ---------------------------------------------------------------- API 키(신원 위임 인증, 3종)
// 세 종류 다 "그 키를 만든 설계자의 신원 인증을 대행"하고 스코프만
// 다르다(core/apiKeys.ts). 키 발급/배제는 위험도가 커서(위 팀장 관리
// 라우트의 "authenticate만" 선례를 안 따르고) 명시적으로 권한을
// 확인하고, requireUnrestrictedScope로 스코프가 있는 키로는 키 관리
// 자체를 못 하게 막는다(권한 상승 방지).

app.post(
  "/api/projects/:projectId/api-keys",
  authenticate,
  requireUnrestrictedScope,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { label } = req.body as { label?: string };
    res.json(await createApiKey(req.userId!, { scope: "project", projectId: req.params.projectId, label }));
  }),
);

app.get(
  "/api/projects/:projectId/api-keys",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listProjectKeys(req.params.projectId, req.userId!));
  }),
);

app.post(
  "/api/teams/:teamId/api-keys",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { label } = req.body as { label?: string };
    try {
      res.json(await createApiKey(req.userId!, { scope: "team", teamId: req.params.teamId, label }));
    } catch (err) {
      if (err instanceof ApiKeyError) { res.status(403).json({ error: err.message }); return; }
      throw err;
    }
  }),
);

app.get(
  "/api/teams/:teamId/api-keys",
  authenticate,
  asyncRoute(async (req, res) => {
    try {
      res.json(await listTeamKeys(req.params.teamId, req.userId!));
    } catch (err) {
      if (err instanceof ApiKeyError) { res.status(403).json({ error: err.message }); return; }
      throw err;
    }
  }),
);

app.post(
  "/api/api-keys/personal",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { label } = req.body as { label?: string };
    res.json(await createApiKey(req.userId!, { scope: "personal", label }));
  }),
);

app.get(
  "/api/api-keys/personal",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyPersonalKeys(req.userId!));
  }),
);

// 배제 권한: personal은 본인만, project는 본인 또는 그 프로젝트
// owner, team은 본인 또는 그 팀의 팀장 - "각자의 단위에 해당하는 키를
// 관리"한다는 요구를 그대로 반영(core/apiKeys.ts의 revokeApiKey는 상태
// 갱신만 하고, 권한 판정은 이 저장소의 기존 관례대로 라우트에서 한다).
app.delete(
  "/api/api-keys/:keyId",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const key = await getApiKeyById(req.params.keyId);
    if (!key) { res.status(404).json({ error: "not found" }); return; }
    let authorized = key.ownerId === req.userId;
    if (!authorized && key.scope === "project" && key.projectId) {
      authorized = (await getMemberRole(key.projectId, req.userId!)) === "owner";
    }
    if (!authorized && key.scope === "team" && key.teamId) {
      authorized = await isTeamAdmin(key.teamId, req.userId!);
    }
    if (!authorized) authorized = await isSuperAdmin(req.userId!);
    if (!authorized) {
      res.status(403).json({ error: "이 키를 배제할 권한이 없습니다" });
      return;
    }
    try {
      res.json(await revokeApiKey(req.params.keyId, req.userId!));
    } catch (err) {
      if (err instanceof ApiKeyError) { res.status(400).json({ error: err.message }); return; }
      throw err;
    }
  }),
);

app.post(
  "/api/project-groups",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name, teamId } = req.body as { name?: string; teamId?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createProjectGroup(name, teamId, req.userId!));
  }),
);

app.get(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjectGroups(req.query.teamId as string | undefined, req.userId!));
  }),
);

app.put(
  "/api/project-groups/:groupId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 수정할 수 있습니다" });
      return;
    }
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await updateProjectGroup(req.params.groupId, { name }));
  }),
);

app.delete(
  "/api/project-groups/:groupId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 삭제할 수 있습니다" });
      return;
    }
    await deleteProjectGroup(req.params.groupId);
    res.json({ ok: true });
  }),
);

// 그룹 멤버 가시성(보안 요구사항) - 그 그룹 산하 전체 프로젝트의
// 멤버를 관리자만 볼 수 있다.
app.get(
  "/api/project-groups/:groupId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(await listMembersForGroup(req.params.groupId));
  }),
);

// 그룹 관리자 관리 - 팀장 관리 라우트와 동일한 패턴(스코프 확인 +
// 실제 관리자인지 확인). isProjectGroupAdmin()이 팀장 상속을 포함하므로
// 그 그룹이 속한 팀의 팀장도 그룹 관리자를 등록/해제할 수 있다.
app.post(
  "/api/project-groups/:groupId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 그룹 관리자를 등록할 수 있습니다" });
      return;
    }
    const { userId } = req.body as { userId?: string };
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    res.json(await addProjectGroupAdmin(req.params.groupId, userId));
  }),
);

app.delete(
  "/api/project-groups/:groupId/admins/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 그룹 관리자를 해제할 수 있습니다" });
      return;
    }
    await removeProjectGroupAdmin(req.params.groupId, req.params.userId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/project-groups/:groupId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listProjectGroupAdmins(req.params.groupId));
  }),
);

app.post(
  "/api/projects",
  authenticate,
  requireUnrestrictedScope,
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
    res.json(await listProjects(req.query.projectGroupId as string | undefined, req.userId!));
  }),
);

// 멤버가 아니어도 팀장이면 숨겨진 프로젝트를 열어볼 수 있어야 한다(6번 -
// 숨김 해제 판단용) - requireProjectRole 단독이 아니라, 그 체크가
// 실패해도 canSeeHiddenProject로 한 번 더 확인하는 인라인 체크로 교체.
// 팀장이 자동으로 프로젝트 내용까지 볼 권한을 얻는 건 아니다 - 이
// 라우트(존재 확인)만 이렇게 넓고, 문서/멤버 등 다른 라우트는 그대로
// requireProjectRole 유지.
app.get(
  "/api/projects/:projectId",
  authenticate,
  asyncRoute(async (req, res) => {
    const role = await getMemberRole(req.params.projectId, req.userId!);
    if (!role && !(await canSeeHiddenProject(req.params.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" });
      return;
    }
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    const notice = role ? await pendingQuestionNotice(req.params.projectId) : null;
    res.json(withNotices({ ...project, myRole: role }, notice));
  }),
);

// 프로젝트 완전 삭제("제한구역") - owner 전용(admin은 자동 우회).
// 문서/코멘트/칸반/Q&A 등 DB 데이터가 cascade로 전부 함께 삭제되고,
// 연결된 Gitea 저장소도 같이 삭제된다(deleteProject 참고) - 되돌릴 수
// 없다.
app.delete(
  "/api/projects/:projectId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await deleteProject(req.params.projectId);
    res.json({ ok: true });
  }),
);

// 프로젝트 owner 또는 그 프로젝트가 속한 팀의 팀장만 숨김을 켜고 끌 수
// 있다(canSeeHiddenProject보다 엄격 - 일반 멤버는 안 됨).
app.put(
  "/api/projects/:projectId/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const role = await getMemberRole(req.params.projectId, req.userId!);
    const teamId = await getOwningTeamId(req.params.projectId);
    const isAdmin = await isTeamAdmin(teamId, req.userId!);
    if (role !== "owner" && !isAdmin) {
      res.status(403).json({ error: "프로젝트 owner 또는 팀장만 숨김 상태를 바꿀 수 있습니다" });
      return;
    }
    const { hidden } = req.body as { hidden?: boolean };
    if (hidden === undefined) { res.status(400).json({ error: "hidden이 필요합니다" }); return; }
    res.json(await setProjectHidden(req.params.projectId, hidden, req.userId!));
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

app.put(
  "/api/projects/:projectId/members/:userId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { role } = req.body as { role?: string };
    if (!role) { res.status(400).json({ error: "role이 필요합니다" }); return; }
    res.json(await updateMemberRole(req.params.projectId, req.params.userId, role, req.userId!));
  }),
);

app.delete(
  "/api/projects/:projectId/members/:userId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await removeMember(req.params.projectId, req.params.userId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 문서 타입 체계

app.post(
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
app.get(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes(req.params.projectId));
  }),
);

app.get(
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

app.post(
  "/api/projects/:projectId/doc-types/:docTypeId/statuses",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) { res.status(400).json({ error: "code가 필요합니다(draft/review/pending/approved/deprecated/archived 중 하나)" }); return; }
    res.json(await addDocStatus(req.params.docTypeId, code));
  }),
);

app.post(
  "/api/projects/:projectId/doc-types/:docTypeId/transitions",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    const { fromStatusCode, toStatusCode, label } = req.body as {
      fromStatusCode?: string;
      toStatusCode?: string;
      label?: string;
    };
    if (!fromStatusCode || !toStatusCode) {
      res.status(400).json({ error: "fromStatusCode/toStatusCode가 필요합니다" });
      return;
    }
    res.json(await addDocStatusTransitionByCode(req.params.docTypeId, fromStatusCode, toStatusCode, label));
  }),
);

app.put(
  "/api/projects/:projectId/doc-types/:docTypeId/guideline",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    const { guideline } = req.body as { guideline?: string };
    if (guideline === undefined) { res.status(400).json({ error: "guideline이 필요합니다" }); return; }
    res.json(await setDocTypeGuideline(req.params.docTypeId, guideline));
  }),
);

app.post(
  "/api/projects/:projectId/doc-types/:docTypeId/standard-flow",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocType(req.params.projectId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트에 해당 문서 타입이 없습니다" });
      return;
    }
    await seedStandardStatusFlow(req.params.docTypeId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/doc-types/:docTypeId/transitions",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocStatusTransitions(req.params.docTypeId));
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

// 홈 대시보드 "최근 변경 문서" + 그 "더보기"(더 큰 limit으로 재호출)
// 둘 다 이 라우트 하나를 쓴다.
app.get(
  "/api/projects/:projectId/documents/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 5);
    res.json(await listRecentDocuments(req.params.projectId, limit));
  }),
);

// 웹 문서 목록 화면 전용 페이지네이션(요청 4번) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
app.get(
  "/api/projects/:projectId/documents/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await listDocumentsPaged(req.params.projectId, req.query.docTypeId as string | undefined, page, pageSize));
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

// 사이드바 다중 스코프 검색(웹 전용) - CLI/MCP는 위 단일 프로젝트
// /search를 그대로 쓰고, 이 라우트는 AI가 아니라 설계자의 브라우징
// 편의 기능이라 완전성 원칙 대상이 아니다. scope가 "team"인데 앵커
// 프로젝트가 팀에 속하지 않으면 listAccessibleProjectIdsInScope()가
// 명확한 에러를 던진다(팝업이 사전 조회 없이 "먼저 시도, 실패하면
// 안내" 방식으로 처리).
app.get(
  "/api/projects/:projectId/search/multi",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    const scope = (req.query.scope as string | undefined) ?? "project";
    if (scope !== "project" && scope !== "group" && scope !== "team") {
      res.status(400).json({ error: "scope는 project|group|team 중 하나여야 합니다" });
      return;
    }
    const includeSource = req.query.includeSource === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const projectIds = await listAccessibleProjectIdsInScope(req.params.projectId, scope as SearchScope, req.userId!);
    if (projectIds.length === 0) {
      res.json({ documents: [], sourceFiles: [] });
      return;
    }

    const docHits = await searchDocumentsWithSnippets(q, { projectIds, limit });
    const docProjectNames = await getProjectNamesByIds([...new Set(docHits.map((h) => h.projectId))]);
    const documents = docHits.map((h) => ({ ...h, projectName: docProjectNames.get(h.projectId) ?? h.projectId }));

    let sourceFiles: (Awaited<ReturnType<typeof searchSourceFiles>>[number] & { projectName: string })[] = [];
    if (includeSource) {
      const srcHits = await searchSourceFiles(q, { projectIds, limit });
      const srcProjectNames = await getProjectNamesByIds([...new Set(srcHits.map((h) => h.projectId))]);
      sourceFiles = srcHits.map((h) => ({ ...h, projectName: srcProjectNames.get(h.projectId) ?? h.projectId }));
    }

    res.json({ documents, sourceFiles });
  }),
);

// 문서는 trackingCode로만 식별되고(경로에 projectId 없음) 지금까지
// requireProjectRole을 못 걸어 GET/PUT/transition/links가 authenticate만
// 걸린 채 남아있었다(신규 버그 수정 - questions/comments 라우트에서
// 이미 겪은 것과 같은 원인). resolveEffectivePermission()으로
// read/write/delete를 확인하고, 오버라이드가 적용됐으면 notices 배열에
// 안내 배너를 얹는다(없으면 필드 생략 - 평소엔 노이즈 없음).
function withNotices<T extends object>(payload: T, notice: string | null): T & { notices?: string[] } {
  return notice ? { ...payload, notices: [notice] } : payload;
}

app.get(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(withNotices({ ...doc, perm: { read: perm.read, write: perm.write, delete: perm.delete } }, perm.notice));
  }),
);

app.put(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { body } = req.body as { body?: string };
    if (body === undefined) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(withNotices(await saveDocumentBody(req.params.trackingCode, body, req.userId!), perm.notice));
  }),
);

app.post(
  "/api/documents/:trackingCode/transition",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { toStatusCode } = req.body as { toStatusCode?: string };
    if (!toStatusCode) { res.status(400).json({ error: "toStatusCode가 필요합니다" }); return; }
    res.json(withNotices(await transitionDocumentStatus(req.params.trackingCode, toStatusCode), perm.notice));
  }),
);

app.get(
  "/api/documents/:trackingCode/next-statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await allowedNextStatuses(doc.docTypeId, doc.statusId));
  }),
);

app.post(
  "/api/documents/:trackingCode/links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
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
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBacklinks(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listDocumentRevisions(req.params.trackingCode));
  }),
);

// "연관된 소스코드" 링크 - 코멘트/폴더와 달리 AI 작업과 직접 관련된
// 신호라 CLI/MCP에도 노출된다(완전성 원칙).
app.post(
  "/api/documents/:trackingCode/source-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { filePath } = req.body as { filePath?: string };
    if (!filePath) { res.status(400).json({ error: "filePath가 필요합니다" }); return; }
    res.json(await addSourceLink(req.params.trackingCode, filePath, req.userId!));
  }),
);

app.get(
  "/api/documents/:trackingCode/source-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listSourceLinks(req.params.trackingCode));
  }),
);

app.delete(
  "/api/document-source-links/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const doc = await getDocument(trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    await removeSourceLink(req.params.id, trackingCode);
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.delete) { res.status(403).json({ error: "이 문서에 대한 삭제 권한이 없습니다" }); return; }
    await deleteDocument(req.params.trackingCode);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 세부 접근 권한 (오너 전용)

app.put(
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
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    await setAccessOverride(req.params.projectId, userId, {}, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

app.put(
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
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    await setAccessOverride(req.params.projectId, userId, { docTypeId: req.params.docTypeId }, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

app.put(
  "/api/documents/:trackingCode/access",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(doc.projectId, req.userId!);
    if (role !== "owner") { res.status(403).json({ error: "프로젝트 owner만 접근 권한을 설정할 수 있습니다" }); return; }
    const { userId, canRead, canWrite, canDelete } = req.body as {
      userId?: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
    };
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    await setAccessOverride(doc.projectId, userId, { documentId: doc.id }, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

app.get(
  "/api/projects/:projectId/access",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverrides(req.params.projectId));
  }),
);

// ---------------------------------------------------------------- 문서 정리용 개인 폴더 (웹 전용 - AI는 모름, CLI/MCP는 절대 호출하지 않음)
// 폴더는 만든 설계자 개인 소유라(core/folders.ts) 프로젝트 멤버면(viewer
// 포함) 누구나 자기 폴더를 만들고 관리할 수 있다 - 소유권 확인은 core
// 함수 내부에서 한다.

app.post(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { name, parentFolderId } = req.body as { name?: string; parentFolderId?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createFolder(req.params.projectId, name, parentFolderId, req.userId!));
  }),
);

app.put(
  "/api/folders/:folderId",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await renameFolder(req.params.folderId, name, req.userId!));
  }),
);

app.delete(
  "/api/folders/:folderId",
  authenticate,
  asyncRoute(async (req, res) => {
    await deleteFolder(req.params.folderId, req.userId!);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/folders/:folderId/reorder",
  authenticate,
  asyncRoute(async (req, res) => {
    const { direction } = req.body as { direction?: "up" | "down" };
    if (direction !== "up" && direction !== "down") { res.status(400).json({ error: "direction은 up/down이어야 합니다" }); return; }
    await reorderFolder(req.params.folderId, direction, req.userId!);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listFolders(req.params.projectId, req.userId!));
  }),
);

app.get(
  "/api/folders/:folderId/documents",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listFolderDocuments(req.params.folderId, req.userId!));
  }),
);

app.put(
  "/api/documents/:trackingCode/folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    // 개인 폴더 배치는 문서 내용을 안 바꾸는 순수 메타데이터라 read
    // 권한이면 충분하다(write 요구 안 함).
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { folderId } = req.body as { folderId?: string | null };
    await moveDocumentToFolder(req.params.trackingCode, folderId ?? null, req.userId!);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 칸반 보드
// 컬럼(분류)은 프로젝트 공유, 순서/숨김만 설계자별(KanbanColumnPref) -
// 그 두 라우트는 "이 프로젝트 멤버인가"만 확인하고 role 등급은 안 따진다
// (개인 설정이라 editor/owner를 요구할 이유가 없음). 카드는 문서와
// 같은 관례로 트래킹 코드 주소 지정 - 하위 라우트(이동/숨김/코멘트)는
// 경로에 projectId가 없어 먼저 카드를 조회해 projectId를 얻은 뒤
// getMemberRole로 인라인 인가한다(질문/코멘트 라우트와 동일 패턴).

app.post(
  "/api/projects/:projectId/kanban/columns",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createKanbanColumn(req.params.projectId, name));
  }),
);

app.get(
  "/api/projects/:projectId/kanban/columns",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listKanbanColumnsForUser(req.params.projectId, req.userId!));
  }),
);

app.put(
  "/api/kanban/columns/:id/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getKanbanColumnProjectId(req.params.id);
    if (!projectId) { res.status(404).json({ error: "분류를 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 프로젝트의 멤버만 가능합니다" }); return; }
    const { hidden } = req.body as { hidden?: boolean };
    if (hidden === undefined) { res.status(400).json({ error: "hidden이 필요합니다" }); return; }
    await setColumnHiddenForUser(req.params.id, req.userId!, hidden);
    res.json({ ok: true });
  }),
);

app.put(
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

app.post(
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

app.get(
  "/api/projects/:projectId/kanban/cards",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const columnId = req.query.columnId as string | undefined;
    const includeHidden = req.query.includeHidden === "true";
    res.json(await listKanbanCards(req.params.projectId, columnId, includeHidden));
  }),
);

app.get(
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

app.put(
  "/api/kanban/cards/:trackingCode/move",
  authenticate,
  asyncRoute(async (req, res) => {
    const card = await getKanbanCardByTrackingCode(req.params.trackingCode);
    if (!card) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(card.projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { toColumnId, toIndex } = req.body as { toColumnId?: string; toIndex?: number };
    if (!toColumnId) { res.status(400).json({ error: "toColumnId가 필요합니다" }); return; }
    await moveKanbanCard(req.params.trackingCode, toColumnId, toIndex);
    res.json({ ok: true });
  }),
);

app.put(
  "/api/kanban/cards/:trackingCode/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const card = await getKanbanCardByTrackingCode(req.params.trackingCode);
    if (!card) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(card.projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { hidden } = req.body as { hidden?: boolean };
    if (hidden === undefined) { res.status(400).json({ error: "hidden이 필요합니다" }); return; }
    await setKanbanCardHidden(req.params.trackingCode, hidden);
    res.json({ ok: true });
  }),
);

// 칸반 카드 코멘트 전용 라우트는 없다 - 공용 코멘트 라우트(아래 "코멘트"
// 절, targetType="kanbanCard")로 흡수됐다.

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

// ---------------------------------------------------------------- 질의/답변 (질의는 AI, 답변은 설계자 - open→pending→resolved)
// targetType/targetKey로 다형화(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 프로젝트/대상 종류를
// 역산할 수 있어(resolveTargetByTrackingCode) CLI의 기존 2-인자
// 시그니처(`docs question <trackingCode> <text>`)를 그대로 유지한다.
// source 대상은 트래킹 코드가 없어 프로젝트 스코프 진입점이 별도로
// 필요하다.

async function pendingQuestionNotice(projectId: string): Promise<string | null> {
  const n = await countPendingQuestions(projectId);
  if (n === 0) return null;
  return `이 프로젝트에 설계자가 답변했지만 아직 확인하지 않은 질의가 ${n}건 있습니다 - docs question ack <trackingCode>로 처리하세요`;
}

async function requireEditorForTarget(projectId: string, userId: string): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  return roleSatisfies(role, "editor");
}

app.post(
  "/api/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCode, kind, text, refs, options } = req.body as {
      trackingCode?: string;
      kind?: string;
      text?: string;
      refs?: string[];
      options?: { label: string; detail?: string }[];
    };
    if (!trackingCode || !kind || !text) { res.status(400).json({ error: "trackingCode/kind/text가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(target.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await addQuestionByTrackingCode(trackingCode, kind, text, req.userId!, refs, options));
  }),
);

app.post(
  "/api/projects/:projectId/questions/source",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path, kind, text, refs, options } = req.body as {
      path?: string;
      kind?: string;
      text?: string;
      refs?: string[];
      options?: { label: string; detail?: string }[];
    };
    if (!path || !kind || !text) { res.status(400).json({ error: "path/kind/text가 필요합니다" }); return; }
    res.json(await addQuestion(req.params.projectId, "source", path, kind, text, req.userId!, refs, options));
  }),
);

app.get(
  "/api/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listQuestions(target.targetType, trackingCode));
  }),
);

app.get(
  "/api/projects/:projectId/questions/source",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path as string | undefined;
    if (!path) { res.status(400).json({ error: "path 쿼리가 필요합니다" }); return; }
    res.json(await listQuestions("source", path));
  }),
);

// 문서 탭 분리(질의/답변) + 소스 코드/칸반 카드 다이얼로그가 공유하는
// 웹 전용 자매 라우트(페이지네이션+검색+최신순) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
app.get(
  "/api/questions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const q = req.query.q as string | undefined;
    res.json(await listQuestionsPaged(target.targetType, trackingCode, { page, pageSize, q }));
  }),
);

app.get(
  "/api/projects/:projectId/questions/source/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path as string | undefined;
    if (!path) { res.status(400).json({ error: "path 쿼리가 필요합니다" }); return; }
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const q = req.query.q as string | undefined;
    res.json(await listQuestionsPaged("source", path, { page, pageSize, q }));
  }),
);

app.get(
  "/api/projects/:projectId/pending",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const notice = await pendingQuestionNotice(req.params.projectId);
    res.json(withNotices({ questions: await listPendingQuestions(req.params.projectId) }, notice));
  }),
);

app.post(
  "/api/questions/:trackingCode/answer",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    const { body, decision } = req.body as { body?: string; decision?: string };
    res.json(await answerQuestion(req.params.trackingCode, { body, decision }, req.userId!));
  }),
);

app.post(
  "/api/questions/:trackingCode/ack",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await acknowledgeQuestion(req.params.trackingCode));
  }),
);

// ---------------------------------------------------------------- 코멘트
// 설계자들끼리만 공유되는 채널이라 CLI/MCP엔 없다(완전성 원칙의
// 의도적 예외 - 소스 코드/칸반 카드 코멘트도 동일하게 적용). 질의와
// 같은 방식으로 document/kanbanCard는 트래킹 코드로, source는 별도
// 프로젝트 스코프 진입점으로 주소 지정한다.

app.post(
  "/api/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCode, body } = req.body as { trackingCode?: string; body?: string };
    if (!trackingCode || !body) { res.status(400).json({ error: "trackingCode/body가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(target.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await addComment(target.projectId, target.targetType, trackingCode, body, req.userId!));
  }),
);

app.post(
  "/api/projects/:projectId/comments/source",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path, body } = req.body as { path?: string; body?: string };
    if (!path || !body) { res.status(400).json({ error: "path/body가 필요합니다" }); return; }
    res.json(await addComment(req.params.projectId, "source", path, body, req.userId!));
  }),
);

app.get(
  "/api/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listComments(target.targetType, trackingCode, req.userId!));
  }),
);

app.get(
  "/api/projects/:projectId/comments/source",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path as string | undefined;
    if (!path) { res.status(400).json({ error: "path 쿼리가 필요합니다" }); return; }
    res.json(await listComments("source", path, req.userId!));
  }),
);

app.put(
  "/api/comments/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await editComment(req.params.id, body, req.userId!));
  }),
);

app.delete(
  "/api/comments/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    await deleteComment(req.params.id, req.userId!);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/comments/:id/status",
  authenticate,
  asyncRoute(async (req, res) => {
    const { status } = req.body as { status?: string };
    if (!status) { res.status(400).json({ error: "status가 필요합니다" }); return; }
    res.json(await setCommentStatus(req.params.id, status, req.userId!));
  }),
);

// 홈 대시보드 "최근 코멘트" + 그 "더보기" - 웹 전용(코멘트는 CLI/MCP에
// 의도적으로 없음, G 예외 그대로 유지).
app.get(
  "/api/projects/:projectId/comments/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 5);
    res.json(await listRecentComments(req.params.projectId, limit));
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
    const { content, teamId, projectGroupId, projectId } = req.body as {
      content?: string;
      teamId?: string;
      projectGroupId?: string;
      projectId?: string;
    };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
    // 스코프 미지정(셋 다 없음)은 "설치 전역 기본값" 수정이라 unrestricted
    // (로그인/개인 키)만 허용 - 안 그러면 프로젝트 하나로 좁혀진 키가
    // 전체 설치의 기본 CLAUDE.md/SKILL.md를 바꿔버릴 수 있다.
    let allowed: boolean;
    if (projectId) allowed = await isProjectAllowedByActiveScope(projectId);
    else if (teamId) allowed = isTeamAllowedByActiveScope(teamId);
    else if (projectGroupId) allowed = await isGroupAllowedByActiveScope(projectGroupId);
    else allowed = getActiveKeyScope().type === "unrestricted";
    if (!allowed) {
      res.status(403).json({ error: "이 API 키로는 이 스코프의 템플릿을 수정할 수 없습니다" });
      return;
    }
    res.json(await setTemplateOverride(filename, { teamId, projectGroupId, projectId }, content));
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
    const status = req.query.status as "pending" | "delivered" | "all" | undefined;
    const markDelivered = req.query.markDelivered === "true";
    res.json(await listMessages(req.params.projectId, { status, markDelivered }));
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

// 장애 복구용 - 상태를 전혀 바꾸지 않는 순수 조회(반복 호출해도 안전).
app.get(
  "/api/projects/:projectId/messages/recent",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json(await listRecentMessages(req.params.projectId, limit));
  }),
);

// 웹 메시지 화면 전용 페이지네이션(요청 4번) - markDelivered는 지원
// 안 함(웹은 원래도 이 플래그를 안 보냄). CLI/MCP가 쓰는 위 배열 응답
// 라우트는 그대로 둔다.
app.get(
  "/api/projects/:projectId/messages/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const status = req.query.status as "pending" | "delivered" | "all" | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await listMessagesPaged(req.params.projectId, { status, page, pageSize }));
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

// importFrom.repoUrl이 인증을 요구해 실패하면(비공개 저장소인데 자격증명
// 없음/틀림) 일반 400이 아니라 422 + git_auth_required로 응답한다 -
// 프런트가 그 자리에서 자격증명 입력 폼을 띄우고 저장 후 재시도할 수
// 있게(설계자 확인 - "인증이 필요한 외부 저장소" 흐름). hostPattern은
// 입력받은 URL의 host를 그대로 - 자격증명 입력 폼의 host 필드를 미리
// 채우는 데 씀. 401이 아니라 422를 쓰는 이유 - frontend/src/api/
// client.ts의 callWithRefresh()가 모든 401을 "액세스 토큰 만료"로
// 해석해 리프레시 토큰 갱신을 시도한다(그 자체는 무해하게 성공하고
// 재시도해도 이 라우트는 또 같은 이유로 실패하지만, 만약 그 순간
// 리프레시 토큰마저 만료돼 있으면 설계자의 로그인 세션 자체가
// 로그아웃되는 무관한 부작용이 생길 수 있다 - 이 라우트의 401은
// "설계자 세션" 문제가 전혀 아니므로 그 인터셉터와 충돌하지 않는
// 상태 코드를 쓴다).
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

app.post(
  "/api/projects/:projectId/git/link",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { importFrom } = req.body as { importFrom?: { repoUrl?: string; gitCredentialId?: string } };
    try {
      const result = await linkSelfHostedRepo(
        req.params.projectId,
        importFrom?.repoUrl ? { repoUrl: importFrom.repoUrl, gitCredentialId: importFrom.gitCredentialId } : undefined,
      );
      void backfillProjectSourceIndex(req.params.projectId);
      res.json(result);
    } catch (err) {
      if (err instanceof GitAuthRequiredError) {
        res.status(422).json({ error: "git_auth_required", hostPattern: importFrom?.repoUrl ? hostOf(importFrom.repoUrl) : undefined });
        return;
      }
      throw err;
    }
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
    try {
      const result = await linkExternalAsPrimary(req.params.projectId, provider, repoUrl, gitCredentialId);
      void backfillProjectSourceIndex(req.params.projectId);
      res.json(result);
    } catch (err) {
      if (err instanceof GitAuthRequiredError) {
        res.status(422).json({ error: "git_auth_required", hostPattern: hostOf(repoUrl) });
        return;
      }
      throw err;
    }
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
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    res.json(await gitea.listCommits(slug, { ref }));
  }),
);

// 웹 변경 추적 화면 전용 페이지네이션(요청 4번) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
app.get(
  "/api/projects/:projectId/git/log/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await gitea.listCommitsPaged(slug, { ref, page, pageSize }));
  }),
);

app.get(
  "/api/projects/:projectId/git/diff/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const diff = await gitea.getCommitDiff(slug, req.params.sha);
    res.type("text/plain").send(diff);
  }),
);

app.get(
  "/api/projects/:projectId/git/blame",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const filepath = req.query.path as string | undefined;
    if (!filepath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getBlame(slug, filepath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/show/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    res.json(await gitea.getCommit(slug, req.params.sha));
  }),
);

// ---------------------------------------------------------------- git 트리/파일 조회·저장 (Phase 5(2/3) - 소스 코드 브라우저용)

app.get(
  "/api/projects/:projectId/git/tree",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const dirPath = (req.query.path as string | undefined) ?? "";
    res.json(await gitea.listTree(slug, dirPath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getFileContent(slug, filePath, req.query.ref as string | undefined));
  }),
);

// 소스 파일 선택기(엔티티 선택기 kind="sourceFile")용 - 재귀 전체 파일
// 목록(기존 getFullTree()는 지금까지 git 동기화 제안 기능이 내부적으로만
// 썼다, 새 라우트만 추가).
app.get(
  "/api/projects/:projectId/git/tree/all",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    res.json(await gitea.getFullTree(slug));
  }),
);

app.put(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const { content, message } = req.body as { content?: string; message?: string };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
    // 커밋이 실제로 이 요청을 보낸 설계자 신원으로 귀속되도록, 그
    // 설계자의 Gitea PAT를 구해 넘긴다 - 아직 없으면(과도기 상태)
    // putFileContent()가 관리자 토큰으로 폴백한다.
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await gitea.putFileContent(slug, filePath, content, message || `docs: update ${filePath}`, actingToken);
    await syncSourceFileOnSave(req.params.projectId, filePath, content);
    res.json({ ok: true });
  }),
);

// 이미지/영상 미리보기 + "원본 다운로드" 전용 - blob sha 기반 로컬
// 캐시에서 raw 바이트를 그대로 서빙한다(JSON+base64 아님). 인증
// 미들웨어를 거치므로 <img src>/<video src>로 직접 못 부른다 - 프런트는
// 인증된 fetch()로 이 라우트를 호출해 Blob을 받고 object URL을 만든다.
app.get(
  "/api/projects/:projectId/git/file/raw",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const slug = await requireGiteaWorkingSlug(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const raw = await gitea.getFileRaw(slug, filePath, req.query.ref as string | undefined);
    res.type(gitea.mimeTypeForPath(filePath));
    res.sendFile(raw.cachePath);
  }),
);

// ---------------------------------------------------------------- 동기화 제안 (외부 연동 전용 - 미러 vs 작업 저장소)
// Gitea의 mirror-sync 트리거가 비동기 큐잉이라(즉시 완료 안 됨) 요청/조회를
// 분리한다 - POST가 트리거(즉시 "예정됨"/"이미 예정됨" 반환), GET이
// 그 결과를 폴링(pending/ready/none). 이미 진행 중일 때 POST를 또
// 호출해도 새로 트리거하지 않는다(requestGitSyncStatus 내부에서 처리).

// git 저장소 기능은 프로젝트 관리자(owner)만 쓸 수 있다(설계자 확정 -
// viewer/editor는 아예 손댈 수 없음).
app.post(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await requestGitSyncStatus(req.params.projectId));
  }),
);

app.get(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getCachedGitSyncStatus(req.params.projectId));
  }),
);

app.get(
  "/api/projects/:projectId/git/sync-proposal",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getGitSyncProposal(req.params.projectId));
  }),
);

// ---------------------------------------------------------------- 외부 저장소 동기화(발행) - Push Mirror
// 실제 push를 시도해 그 결과로 성공/실패(권한 부족·충돌 등)를
// 판단한다 - owner 전용(git 저장소 기능 전체와 동일). 실패하면
// AI 대기열에 올라가고, 완료 보고 전까지는 GET .../publish-queue가
// pending 항목을 계속 돌려줘 "동기화" 버튼을 비활성 상태로 유지시킨다.

app.post(
  "/api/projects/:projectId/git/publish",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { gitCredentialId } = req.body as { gitCredentialId?: string };
    if (!gitCredentialId) { res.status(400).json({ error: "gitCredentialId가 필요합니다" }); return; }
    res.json(await publishToExternalRepo(req.params.projectId, gitCredentialId));
  }),
);

app.get(
  "/api/projects/:projectId/git/publish-queue",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getPendingPublishQueueEntry(req.params.projectId));
  }),
);

app.post(
  "/api/projects/:projectId/git/publish-queue/:id/done",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await completePublishQueueEntry(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 웹훅 수신 (인증 미들웨어 없음 - Gitea/GitHub/GitLab이 직접 호출, 서명/토큰으로 검증)

// Gitea 시스템 웹훅(인스턴스 전체) 전용 경로 - 프로젝트별 시크릿이
// 아니라 InstallConfig에 발급·보관된 시스템 전체 시크릿 하나로 서명을
// 검증한다. payload를 파싱하기 전에 이 고정 시크릿으로 서명부터
// 검증하고, 통과한 뒤에야 body를 열어 어느 저장소의 push인지 읽는다
// (verifyAndParseWebhook이 이미 그 순서로 동작 - provider 분기 로직은
// 안 건드림, 시크릿만 다르게 넘긴다).
//
// 아래 `/api/webhooks/:provider/:projectId`(파라미터 라우트)보다
// 먼저 등록해야 한다 - Express는 라우트를 등록 순서대로 매칭하므로,
// 이 라우트가 뒤에 있으면 `/api/webhooks/gitea/system`이
// provider="gitea", projectId="system"으로 파싱되어 그 아래 라우트의
// gitea 410 가드에 먼저 걸려버린다(실제로 이 순서 버그를 만들어
// 재현·확인한 뒤 고쳤다 - 등록 순서를 바꾸는 것 외에 다른 코드 변경은
// 없음).
app.post(
  "/api/webhooks/gitea/system",
  asyncRoute(async (req, res) => {
    const secret = await getGiteaSystemWebhookSecret();
    if (!secret) { res.status(503).json({ error: "시스템 웹훅이 아직 설정되지 않았습니다" }); return; }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    let parsed;
    try {
      parsed = verifyAndParseWebhook("gitea", req.headers as Record<string, string | string[] | undefined>, rawBody, secret);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const result = await handleGiteaSystemPush(parsed);
    res.json({ ok: true, ...result });
  }),
);

// Gitea는 더 이상 이 프로젝트별 경로로 안 온다 - 인스턴스 전체를
// 커버하는 시스템 웹훅(위 /api/webhooks/gitea/system) 하나로
// 통합됐다. 예전에 저장소별로 등록됐던 Gitea 웹훅이 실수로 남아 계속
// 이 경로를 때리면 조용히 두 번 처리되는 것보다 명확한 410으로 존재를
// 드러내는 쪽이 안전하다(Gitea 어드민 UI에서 정리하라는 안내). github/
// gitlab(외부 저장소 연동의 권위 원본 - 시스템 웹훅 개념이 없는
// 플랫폼)은 기존대로 이 경로를 그대로 쓴다.
app.post(
  "/api/webhooks/:provider/:projectId",
  asyncRoute(async (req, res) => {
    const { provider, projectId } = req.params;
    if (provider === "gitea") {
      res.status(410).json({
        error: "Gitea 웹훅은 프로젝트별 등록에서 시스템 웹훅 1개로 통합됐습니다 - 이 저장소의 옛 웹훅을 Gitea 어드민 UI에서 삭제하세요",
      });
      return;
    }
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
    await acknowledgeQueueEntry(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/projects/:projectId/push-hook-queue/:id/done",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await completeQueueEntry(req.params.id, req.params.projectId);
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
    const slug = await requireGiteaWorkingSlug(projectId);
    const deployed: string[] = [];
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;

    const claudeMd = await resolveTemplate("CLAUDE.md", projectId);
    if (claudeMd) {
      await gitea.putFileContent(slug, "CLAUDE.md", claudeMd.content, "docs: deploy CLAUDE.md template", actingToken);
      deployed.push("CLAUDE.md");
    }
    const skillFilename = ".claude/skills/claude-native-workflow/SKILL.md";
    const skillMd = await resolveTemplate(skillFilename, projectId);
    if (skillMd) {
      await gitea.putFileContent(slug, skillFilename, skillMd.content, "docs: deploy SKILL.md template", actingToken);
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
  if (err instanceof LoginRateLimitError) {
    res.status(429).set("Retry-After", String(err.retryAfterSeconds)).json({ error: err.message });
    return;
  }
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
  await seedDefaultAdminAccount();
  await ensureEmqxAuthConfigured();
  await gitea.ensureGiteaOrgConfigured();
  await gitea.ensureGiteaSystemWebhookConfigured();
  await ensureAllUsersGiteaAccountsConfigured();

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
