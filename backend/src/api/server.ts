#!/usr/bin/env node
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
  changeOwnPassword,
  getPublicProfile,
  listUsers,
  isSuperAdmin,
  listAllUsersForAdmin,
  listAllUsersForAdminPaged,
  resetPasswordAsAdmin,
} from "../core/auth.js";
import { LoginRateLimitError } from "../core/loginRateLimit.js";
import { assertCredentialEncryptionKeyConfigured } from "../core/crypto.js";
import { addGitCredential, listGitCredentials, listGitCredentialsPaged, removeGitCredential, getCredentialTokenIfOwner } from "../core/gitCredentials.js";
import { createTeam, listTeams, listTeamsPaged, updateTeam, deleteTeam, listMembersForTeam, listMembersForTeamPaged } from "../core/teams.js";
import {
  ensureAllUsersGiteaAccountsConfigured,
  getGiteaAccessToken,
  regenerateGiteaAccessToken,
} from "../core/giteaAccounts.js";
import { addTeamAdmin, removeTeamAdmin, listTeamAdmins, listTeamAdminsPaged, isTeamAllowedByActiveScope } from "../core/teamAdmins.js";
import { getInstallConfig, getGiteaSystemWebhookSecret } from "../core/installConfig.js";
import {
  createProjectGroup,
  listProjectGroups,
  listProjectGroupsPaged,
  isGroupAllowedByActiveScope,
  updateProjectGroup,
  deleteProjectGroup,
  listMembersForGroup,
  listMembersForGroupPaged,
  getProjectGroupById,
} from "../core/projectGroups.js";
import {
  addProjectGroupAdmin,
  removeProjectGroupAdmin,
  listProjectGroupAdmins,
  listProjectGroupAdminsPaged,
  isProjectGroupAdmin,
} from "../core/projectGroupAdmins.js";
import {
  createProject,
  getProject,
  listProjects,
  listProjectsPaged,
  canSeeProject,
  setProjectHidden,
  setProjectPublic,
  deleteProject,
  getOwningTeamId,
  listAccessibleProjectIdsInScope,
  getProjectNamesByIds,
  type SearchScope,
} from "../core/projects.js";
import {
  addMember,
  listMembers,
  listMembersPaged,
  getMemberRole,
  roleSatisfies,
  isProjectAllowedByActiveScope,
  removeMember,
  updateMemberRole,
} from "../core/members.js";
import { isTeamAdmin } from "../core/teamAdmins.js";
import { listUserMemberships } from "../core/userMemberships.js";
import { getActiveKeyScope } from "../core/requestScope.js";
import { listUserActivity } from "../core/activity.js";
import {
  createDocType,
  listDocTypes,
  listDocTypesPaged,
  listDocStatuses,
  getDocTypeById,
  setDocTypeGuideline,
  updateDocType,
  deleteDocType,
  allowedNextStatuses,
} from "../core/docTypes.js";
import {
  createDocument,
  getDocument,
  getDocumentAccessInfo,
  listDocuments,
  listDocumentsPaged,
  listRecentDocuments,
  searchProjectDocuments,
  searchProjectDocumentsPaged,
  saveDocumentBody,
  transitionDocumentStatus,
  setDocumentPriority,
  addDocumentLink,
  listBacklinks,
  listBacklinksPaged,
  listDocumentRevisions,
  listDocumentRevisionsPaged,
  deleteDocument,
  readDocumentLines,
  grepDocument,
  diffDocument,
} from "../core/documents.js";
import { addSourceLink, removeSourceLink, listSourceLinks, listSourceLinksPaged } from "../core/documentSourceLinks.js";
import { addBranchLink, removeBranchLink, listBranchLinks, listBranchLinksPaged } from "../core/documentBranchLinks.js";
import { createReport } from "../core/report.js";
import {
  addQuestion,
  addQuestionByTrackingCode,
  resolveTargetByTrackingCode,
  listPendingQuestions,
  listPendingQuestionsPaged,
  answerQuestion,
  listQuestions,
  listQuestionsPaged,
  getQuestionProjectId,
  acknowledgeQuestion,
  countPendingQuestions,
  withdrawQuestion,
} from "../core/questions.js";
import {
  addComment,
  listComments,
  editComment,
  deleteComment,
  listRecentComments,
  setCommentStatus,
} from "../core/comments.js";
import { resolveTemplate, setTemplateOverride, seedDefaultTemplates, listTemplateRevisions, listTemplateRevisionsPaged } from "../core/templates.js";
import { MeiliSearchRequestError } from "meilisearch";
import { ensureSearchIndexes, searchDocumentsWithSnippets, searchSourceFiles } from "../core/search.js";
import { backfillProjectSourceIndex, syncSourceFileOnSave } from "../core/sourceIndex.js";
import { getSearchSyncQueueStatus, drainSearchSyncQueue } from "../core/searchSyncQueue.js";
import {
  resolveEffectivePermission,
  setAccessOverride,
  listAccessOverrides,
  listAccessOverridesPaged,
  listAccessOverridesForUser,
} from "../core/permissions.js";
import { createFolder, renameFolder, deleteFolder, moveFolder, listFolders, listFolderDocuments, listUnfiledDocuments, moveDocumentToFolder } from "../core/folders.js";
import type { FolderDetail } from "../core/folders.js";
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
} from "../core/codeRelations.js";
import type { CodeRelationInput, BulkUpdateItem } from "../core/codeRelations.js";
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
} from "../core/kanban.js";
import {
  createApiKey,
  listProjectKeys,
  listProjectKeysPaged,
  listTeamKeys,
  listTeamKeysPaged,
  listMyPersonalKeys,
  listMyPersonalKeysPaged,
  getApiKeyById,
  revokeApiKey,
  ApiKeyError,
} from "../core/apiKeys.js";
import {
  authenticate,
  requireProjectRole,
  requireUnrestrictedScope,
  requireSuperAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import {
  linkSelfHostedRepo,
  linkExternalAsPrimary,
  promoteToExternal,
  unlinkExternalRepo,
  getProjectGitRepo,
  getWebhookSetupInstructions,
  markExternalWebhookReceived,
  getWebhookSecret,
  requireGiteaWorkingRef,
  requestGitSyncStatus,
  getCachedGitSyncStatus,
  getGitSyncProposal,
  publishToExternalRepo,
  getPendingPublishQueueEntry,
  completePublishQueueEntry,
  GitAuthRequiredError,
} from "../core/gitRepos.js";
import { isGithubOAuthConfigured, startGithubOAuth, completeGithubOAuth, listGithubRepos } from "../core/githubOAuth.js";
import * as gitea from "../core/gitea.js";
import {
  verifyAndParseWebhook,
  recordPushEvent,
  handleGiteaSystemPush,
  classifyGiteaEvent,
  verifyAndParsePushWebhook,
  verifyAndParseDeleteWebhook,
  handleGiteaSystemDelete,
} from "../core/pushHooks.js";
import {
  getPullRequestDetail,
  listPullRequestsForProject,
  mergePull,
  mergePullManually,
  rejectPull,
  closePull,
  reopenPull,
  listMessagesForPullRequest,
} from "../core/pullRequests.js";
import { paginateInMemory } from "../core/pagination.js";
import {
  createPushHookPrompt,
  listPushHookPrompts,
  listPushHookPromptsPaged,
  updatePushHookPrompt,
  deletePushHookPrompt,
  expireStalePushHookQueueEntries,
  listQueueEntries,
  listQueueEntriesPaged,
  acknowledgeQueueEntry,
  completeQueueEntry,
} from "../core/pushHookPrompts.js";
import { sendMessage, listMessages, listMessagesPaged, waitForMessage, listRecentMessages, editMessage, deleteMessage, ackMessage, completeMessage } from "../core/messages.js";
import { checkConnect, checkAcl, ensureEmqxAuthConfigured, getOrCreateMqttCredential } from "../core/emqxAuth.js";

const app = express();
// nginx 리버스 프록시 뒤에서 실행된다(#gitea-nginx-lockdown) - req.protocol/
// req.get("host")가 nginx의 X-Forwarded-Proto/Host 헤더를 반영하도록 필요
// (예: GitHub OAuth 리다이렉트 URI 계산). 로컬에서 nginx 없이 backend를
// 직접 열어도(개발 편의) 신뢰할 프록시가 없을 뿐 동작에 지장 없음.
app.set("trust proxy", 1);
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

app.get(
  "/api/credentials/page",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(await listGitCredentialsPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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

// ---------------------------------------------------------------- GitHub OAuth 로그인 + 저장소 선택
// "깃허브 로그인 + 저장소 선택하기" 흐름(설계자 지시). redirect_uri는
// PUBLIC_BACKEND_URL(사설 배포에선 docker 내부 호스트명이라 브라우저가
// 못 닿는 경우가 있음) 대신 **이 요청을 시작한 브라우저가 실제로 접근한
// 주소**로 매번 동적 계산한다 - OAuth는 브라우저 리다이렉트라 웹훅과
// 달리 "공개 주소가 있어야 한다"는 제약 자체가 없다(로컬 서버 설치에도
// 새 env 없이 항상 정확히 맞는다).
function githubOAuthRedirectUri(req: Request): string {
  return `${req.protocol}://${req.get("host")}/api/git/oauth/github/callback`;
}

app.get(
  "/api/git/oauth/github/configured",
  asyncRoute(async (_req, res) => {
    res.json({ configured: isGithubOAuthConfigured() });
  }),
);

app.post(
  "/api/git/oauth/github/start",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(startGithubOAuth(req.userId!, githubOAuthRedirectUri(req)));
  }),
);

// 인증 미들웨어 없음 - GitHub의 리다이렉트는 top-level navigation이라
// Authorization 헤더를 실을 수 없다. 대신 state 토큰으로 신원을
// 되찾는다(1회용, TTL 10분). 팝업 창을 postMessage로 닫는 작은 HTML을
// 응답해 메인 창(팝업을 연 창)이 결과를 받게 한다.
app.get(
  "/api/git/oauth/github/callback",
  asyncRoute(async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };
    let payload: { ok: true; credentialId: string } | { ok: false; error: string };
    if (!code || !state) {
      payload = { ok: false, error: "code/state가 없습니다" };
    } else {
      try {
        const result = await completeGithubOAuth(code, state, githubOAuthRedirectUri(req));
        payload = { ok: true, credentialId: result.credentialId };
      } catch (err) {
        payload = { ok: false, error: err instanceof Error ? err.message : "알 수 없는 오류" };
      }
    }
    res.type("html").send(`<!doctype html><html><body><script>
      window.opener && window.opener.postMessage(${JSON.stringify({ type: "github-oauth-done", ...payload })}, window.location.origin);
      window.close();
    </script></body></html>`);
  }),
);

app.get(
  "/api/credentials/:id/github/repos",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const token = await getCredentialTokenIfOwner(req.userId!, req.params.id);
    res.json(await listGithubRepos(token, Number(req.query.page ?? 1)));
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

app.post(
  "/api/auth/me/password",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword/newPassword가 필요합니다" });
      return;
    }
    await changeOwnPassword(req.userId!, currentPassword, newPassword);
    res.json({ ok: true });
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

// "이 설계자가 전체 설치에서 어떤 제한을 받고 있는지" 자기 자신 조회 -
// role 체크 불필요(누구나 자기 자신의 오버라이드는 볼 수 있어야 함).
app.get(
  "/api/auth/me/access-overview",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverridesForUser(req.userId!));
  }),
);

// CLI/MCP의 message wait이 EMQX에 직접 구독할 때 쓸 전용 계정을 내려준다
// (#message-wait-mqtt-direct - 백엔드가 대신 구독하지 않고 클라이언트가
// 직접 구독하도록 전환). PUBLIC_EMQX_MQTT_URL이 설정 안 돼 있으면(로컬
// 최소 구성 등) mqttUrl을 null로 돌려주고, 호출부는 기존 HTTP 폴링
// 방식으로 폴백한다(fail-soft - PUBLIC_EMQX_WS_URL 미설정 시 웹 UI
// 실시간 갱신만 조용히 꺼지는 것과 같은 원칙).
app.get(
  "/api/auth/me/mqtt-credentials",
  authenticate,
  asyncRoute(async (req, res) => {
    const mqttUrl = process.env.PUBLIC_EMQX_MQTT_URL ?? null;
    if (!mqttUrl) { res.json({ mqttUrl: null, username: null, password: null }); return; }
    const cred = await getOrCreateMqttCredential(req.userId!);
    res.json({ mqttUrl, ...cred });
  }),
);

// ---------------------------------------------------------------- 관리자 전용 사용자 관리
// /api/admin/* - admin 전용임을 경로 자체가 드러낸다(이 저장소 첫
// admin 네임스페이스). 이메일 발송 인프라가 없어 self-service 비밀번호
// 재설정 대신 admin이 대행한다(설계자 확정 - #password-reset).
app.get(
  "/api/admin/users",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await listAllUsersForAdmin());
  }),
);

app.get(
  "/api/admin/users/page",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(
      await listAllUsersForAdminPaged(
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
        req.query.search as string | undefined,
      ),
    );
  }),
);

app.post(
  "/api/admin/users/:userId/reset-password",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await resetPasswordAsAdmin(req.params.userId));
  }),
);

app.get(
  "/api/admin/users/:userId/access-overview",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverridesForUser(req.params.userId));
  }),
);

// "소속 조회" 다이얼로그 전용 - 위 access-overview(문서별 세부 제한)와는
// 별개로, 이 사용자가 관리 권한/멤버십을 가진 프로젝트 그룹/팀/프로젝트를
// 한 번에 모아 보여주고, 각 관계를 강제 방출할 수 있게 한다(단, 마지막
// owner/관리자는 각 core 함수의 가드가 거부).
app.get(
  "/api/admin/users/:userId/memberships",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listUserMemberships(req.params.userId));
  }),
);

app.delete(
  "/api/admin/users/:userId/memberships/projects/:projectId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeMember(req.params.projectId, req.params.userId);
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/admin/users/:userId/memberships/teams/:teamId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeTeamAdmin(req.params.teamId, req.params.userId);
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/admin/users/:userId/memberships/groups/:groupId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeProjectGroupAdmin(req.params.groupId, req.params.userId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 검색 엔진 장애 대응 큐 (관리자 전용)
// Meilisearch 장애 중 밀린 색인 쓰기 큐의 상태 조회/수동 드레인
// (#meilisearch-spof) - 30초 주기 백그라운드 워커(main() 참고)가
// 자동으로 비우지만, 장애 해소를 확인한 관리자가 기다리지 않고 즉시
// 비울 수 있게 수동 트리거도 둔다.
app.get(
  "/api/admin/search-queue",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await getSearchSyncQueueStatus());
  }),
);

app.post(
  "/api/admin/search-queue/drain",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await drainSearchSyncQueue());
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
    const { name, isPublic } = req.body as { name?: string; isPublic?: boolean };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createTeam(name, req.userId!, isPublic));
  }),
);

app.get(
  "/api/teams",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeams(req.userId!));
  }),
);

app.get(
  "/api/teams/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeamsPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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
    const { name, enabled, isPublic } = req.body as { name?: string; enabled?: boolean; isPublic?: boolean };
    res.json(await updateTeam(req.params.teamId, { name, enabled, isPublic }));
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

app.get(
  "/api/teams/:teamId/members/page",
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
    res.json(await listMembersForTeamPaged(req.params.teamId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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

app.get(
  "/api/teams/:teamId/admins/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listTeamAdminsPaged(req.params.teamId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// ---------------------------------------------------------------- API 키(신원 위임 인증, 3종)
// 세 종류 다 "그 키를 만든 설계자의 신원 인증을 대행"하고 스코프만
// 다르다(core/apiKeys.ts). 키 발급/배제는 위험도가 커서(위 팀장 관리
// 라우트의 "authenticate만" 선례를 안 따르고) 명시적으로 권한을
// 확인하고, requireUnrestrictedScope로 스코프가 있는 키로는 키 관리
// 자체를 못 하게 막는다(권한 상승 방지).

// 만료 시각은 선택 - 미지정이면 배제 전까지 무기한. 입력 검증 실패는
// 권한 오류(ApiKeyError → 403)와 섞이지 않도록 createApiKey 호출 전에
// 라우트에서 400으로 끊는다. 반환 null = 검증 실패(응답은 이미 보냄).
function parseExpiresAt(res: Response, raw: unknown): { value: Date | undefined } | null {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  const date = typeof raw === "string" ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    res.status(400).json({ error: "expiresAt은 미래의 ISO 8601 시각이어야 합니다" });
    return null;
  }
  return { value: date };
}

app.post(
  "/api/projects/:projectId/api-keys",
  authenticate,
  requireUnrestrictedScope,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { label, expiresAt } = req.body as { label?: string; expiresAt?: unknown };
    const parsed = parseExpiresAt(res, expiresAt);
    if (!parsed) return;
    res.json(
      await createApiKey(req.userId!, { scope: "project", projectId: req.params.projectId, label, expiresAt: parsed.value }),
    );
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

app.get(
  "/api/projects/:projectId/api-keys/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectKeysPaged(req.params.projectId, req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

app.post(
  "/api/teams/:teamId/api-keys",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { label, expiresAt } = req.body as { label?: string; expiresAt?: unknown };
    const parsed = parseExpiresAt(res, expiresAt);
    if (!parsed) return;
    try {
      res.json(await createApiKey(req.userId!, { scope: "team", teamId: req.params.teamId, label, expiresAt: parsed.value }));
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

app.get(
  "/api/teams/:teamId/api-keys/page",
  authenticate,
  asyncRoute(async (req, res) => {
    try {
      res.json(
        await listTeamKeysPaged(req.params.teamId, req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
      );
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
    const { label, expiresAt } = req.body as { label?: string; expiresAt?: unknown };
    const parsed = parseExpiresAt(res, expiresAt);
    if (!parsed) return;
    res.json(await createApiKey(req.userId!, { scope: "personal", label, expiresAt: parsed.value }));
  }),
);

app.get(
  "/api/api-keys/personal",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyPersonalKeys(req.userId!));
  }),
);

app.get(
  "/api/api-keys/personal/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyPersonalKeysPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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
    const { name, teamId, isPublic } = req.body as { name?: string; teamId?: string; isPublic?: boolean };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createProjectGroup(name, teamId, req.userId!, isPublic));
  }),
);

app.get(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjectGroups(req.query.teamId as string | undefined, req.userId!));
  }),
);

app.get(
  "/api/project-groups/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectGroupsPaged(
        req.query.teamId as string | undefined,
        req.userId!,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
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
    const { name, teamId: rawTeamId, isPublic } = req.body as { name?: string; teamId?: string | null; isPublic?: boolean };
    if (name === undefined && rawTeamId === undefined && isPublic === undefined) {
      res.status(400).json({ error: "name, teamId, isPublic 중 하나는 있어야 합니다" });
      return;
    }
    // 빈 문자열도 "팀 없음"으로 정규화(그룹 생성 라우트와 같은 관례).
    const teamId = rawTeamId === undefined ? undefined : rawTeamId || null;
    if (teamId !== undefined && teamId !== null) {
      const current = await getProjectGroupById(req.params.groupId);
      if (teamId !== current?.teamId && !(await isTeamAdmin(teamId, req.userId!))) {
        res.status(403).json({ error: "대상 팀의 팀장만 그 팀으로 그룹을 옮길 수 있습니다" });
        return;
      }
    }
    res.json(await updateProjectGroup(req.params.groupId, { name, teamId, isPublic }));
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

app.get(
  "/api/project-groups/:groupId/members/page",
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
    res.json(
      await listMembersForGroupPaged(req.params.groupId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
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

app.get(
  "/api/project-groups/:groupId/admins/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(
      await listProjectGroupAdminsPaged(req.params.groupId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

app.post(
  "/api/projects",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name, projectGroupId, isPublic } = req.body as { name?: string; projectGroupId?: string; isPublic?: boolean };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    const project = await createProject(name, projectGroupId, isPublic);
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

app.get(
  "/api/projects/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectsPaged(
        req.query.projectGroupId as string | undefined,
        req.userId!,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

// 멤버가 아니어도 팀장/그룹 관리자거나 공개+그룹 읽기 권한이 있으면
// 존재를 열어볼 수 있어야 한다 - requireProjectRole 단독이 아니라,
// 그 체크가 실패해도 canSeeProject로 한 번 더 확인하는 인라인 체크로
// 교체. 이렇게 봐도 자동으로 프로젝트 내용까지 볼 권한을 얻는 건
// 아니다 - 이 라우트(존재 확인)만 이렇게 넓고, 문서/멤버 등 다른
// 라우트는 그대로 requireProjectRole 유지.
app.get(
  "/api/projects/:projectId",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(req.params.projectId, req.userId!);
    if (!role && !(await canSeeProject(project, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" });
      return;
    }
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

// 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 숨김/공개
// 상태를 바꿀 수 있다(canSeeProject의 admin 우회 집합과 통일 - 예전엔
// 그룹 관리자가 빠져있던 비일관성이 있었음).
async function canManageProjectVisibility(projectId: string, userId: string, projectGroupId: string): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  if (role === "owner") return true;
  const teamId = await getOwningTeamId(projectId);
  if (await isTeamAdmin(teamId, userId)) return true;
  return isProjectGroupAdmin(projectGroupId, userId);
}

app.put(
  "/api/projects/:projectId/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    if (!(await canManageProjectVisibility(req.params.projectId, req.userId!, project.projectGroupId))) {
      res.status(403).json({ error: "프로젝트 owner, 팀장, 그룹 관리자만 숨김 상태를 바꿀 수 있습니다" });
      return;
    }
    const { hidden } = req.body as { hidden?: boolean };
    if (hidden === undefined) { res.status(400).json({ error: "hidden이 필요합니다" }); return; }
    res.json(await setProjectHidden(req.params.projectId, hidden, req.userId!));
  }),
);

app.put(
  "/api/projects/:projectId/public",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    if (!(await canManageProjectVisibility(req.params.projectId, req.userId!, project.projectGroupId))) {
      res.status(403).json({ error: "프로젝트 owner, 팀장, 그룹 관리자만 공개 상태를 바꿀 수 있습니다" });
      return;
    }
    const { isPublic } = req.body as { isPublic?: boolean };
    if (isPublic === undefined) { res.status(400).json({ error: "isPublic이 필요합니다" }); return; }
    res.json(await setProjectPublic(req.params.projectId, isPublic));
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

app.get(
  "/api/projects/:projectId/members/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMembersPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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
  "/api/projects/:projectId/doc-types/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypesPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
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

app.put(
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

app.delete(
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
    if (req.query.page !== undefined || req.query.pageSize !== undefined) {
      res.json(
        await searchProjectDocumentsPaged(req.params.projectId, q, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
      );
      return;
    }
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

// "bulk-folder"가 아래 "/api/documents/:trackingCode"의 :trackingCode
// 파라미터로 잘못 매칭되지 않도록, 그 와일드카드 라우트보다 먼저
// 등록해야 한다(Express는 등록 순서대로 매칭) - 폴더는 AI(CLI/MCP)가
// 그 개념 자체를 모르는 웹 전용 기능이라 이 일괄 버전도 CLI/MCP엔
// 노출하지 않는다(단건 .../folder와 동일).
app.put(
  "/api/documents/bulk-folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, folderId } = req.body as { trackingCodes?: string[]; folderId?: string | null };
    if (!trackingCodes?.length) {
      res.status(400).json({ error: "trackingCodes가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const doc = await getDocumentAccessInfo(trackingCode);
          if (!doc) return { trackingCode, ok: false, error: "문서를 찾을 수 없습니다" };
          const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
          if (!perm.read) return { trackingCode, ok: false, error: "이 문서에 대한 읽기 권한이 없습니다" };
          await moveDocumentToFolder(trackingCode, folderId ?? null, req.userId!);
          return { trackingCode, ok: true };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

app.put(
  "/api/documents/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { toStatusCode } = req.body as { toStatusCode?: string };
    if (!toStatusCode) { res.status(400).json({ error: "toStatusCode가 필요합니다" }); return; }
    res.json(withNotices(await transitionDocumentStatus(req.params.trackingCode, toStatusCode), perm.notice));
  }),
);

// 선택한 문서 집합이 서로 다른 프로젝트/타입/권한을 가질 수 있어
// 전부-성공/전부-실패가 아니라 항목별 결과를 반환한다 - 하나가
// 막혀도(권한 없음, 그 타입에 정의 안 된 전이 등) 나머지는 계속
// 진행된다. 새 core 함수 없이 기존 단건 함수를 그대로 반복 호출한다.
app.post(
  "/api/documents/bulk-transition",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes, toStatusCode } = req.body as { trackingCodes?: string[]; toStatusCode?: string };
    if (!trackingCodes?.length || !toStatusCode) {
      res.status(400).json({ error: "trackingCodes/toStatusCode가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const doc = await getDocumentAccessInfo(trackingCode);
          if (!doc) return { trackingCode, ok: false, error: "문서를 찾을 수 없습니다" };
          const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
          if (!perm.write) return { trackingCode, ok: false, error: "이 문서에 대한 쓰기 권한이 없습니다" };
          const updated = await transitionDocumentStatus(trackingCode, toStatusCode);
          return { trackingCode, ok: true, statusCode: updated.statusCode };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

// review/pending 상태일 때만 설정 가능(setDocumentPriority가 검증) -
// 그 외 권한 요구는 transition/save와 동일(쓰기 권한).
app.put(
  "/api/documents/:trackingCode/priority",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { priority } = req.body as { priority?: number };
    if (priority === undefined || !Number.isInteger(priority)) {
      res.status(400).json({ error: "priority(정수)가 필요합니다" });
      return;
    }
    res.json(withNotices(await setDocumentPriority(req.params.trackingCode, priority), perm.notice));
  }),
);

app.get(
  "/api/documents/:trackingCode/next-statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBacklinks(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/backlinks/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBacklinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

app.get(
  "/api/documents/:trackingCode/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listDocumentRevisions(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/revisions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listDocumentRevisionsPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

// 큰 문서를 매번 전체 본문으로 컨텍스트에 올리지 않아도 되도록 -
// Read/Grep 도구가 파일에 대해 하는 일을 문서 본문에 대해 한다
// (#document-partial-read-grep-diff).
app.get(
  "/api/documents/:trackingCode/lines",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(await readDocumentLines(req.params.trackingCode, offset, limit));
  }),
);

app.get(
  "/api/documents/:trackingCode/grep",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { q } = req.query as { q?: string };
    if (!q) { res.status(400).json({ error: "q가 필요합니다" }); return; }
    const matches = await grepDocument(req.params.trackingCode, q, {
      caseInsensitive: req.query.caseInsensitive === "true",
      context: req.query.context !== undefined ? Number(req.query.context) : undefined,
    });
    res.json(matches);
  }),
);

app.get(
  "/api/documents/:trackingCode/diff",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from) { res.status(400).json({ error: "from이 필요합니다" }); return; }
    res.json(await diffDocument(req.params.trackingCode, from, to ?? "current"));
  }),
);

// "연관된 소스코드" 링크 - 코멘트/폴더와 달리 AI 작업과 직접 관련된
// 신호라 CLI/MCP에도 노출된다(완전성 원칙).
app.post(
  "/api/documents/:trackingCode/source-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listSourceLinks(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/source-links/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listSourceLinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

app.delete(
  "/api/document-source-links/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const doc = await getDocumentAccessInfo(trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.delete) { res.status(403).json({ error: "이 문서에 대한 삭제 권한이 없습니다" }); return; }
    await deleteDocument(req.params.trackingCode);
    res.json({ ok: true });
  }),
);

// "연관된 브랜치" 링크 - DocumentSourceLink와 완전히 같은 완전성 원칙
// (CLI/MCP에도 노출), filePath 대신 branchName만 다르다(요구사항 10).
app.post(
  "/api/documents/:trackingCode/branch-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { branchName } = req.body as { branchName?: string };
    if (!branchName) { res.status(400).json({ error: "branchName이 필요합니다" }); return; }
    res.json(await addBranchLink(req.params.trackingCode, branchName, req.userId!));
  }),
);

app.get(
  "/api/documents/:trackingCode/branch-links",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(await listBranchLinks(req.params.trackingCode));
  }),
);

app.get(
  "/api/documents/:trackingCode/branch-links/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json(
      await listBranchLinksPaged(req.params.trackingCode, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

app.delete(
  "/api/document-branch-links/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    if (!trackingCode) { res.status(400).json({ error: "trackingCode 쿼리가 필요합니다" }); return; }
    const doc = await getDocumentAccessInfo(trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    await removeBranchLink(req.params.id, trackingCode);
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
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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

app.get(
  "/api/projects/:projectId/access/page",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(
      await listAccessOverridesPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
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
    const { name, parentFolderId, siblingOrder } = req.body as {
      name?: string;
      parentFolderId?: string | null;
      siblingOrder?: string[];
    };
    let result: FolderDetail | undefined;
    if (name !== undefined) {
      result = await renameFolder(req.params.folderId, name, req.userId!);
    }
    if (parentFolderId !== undefined) {
      if (!Array.isArray(siblingOrder)) { res.status(400).json({ error: "siblingOrder가 필요합니다" }); return; }
      result = await moveFolder(req.params.folderId, req.userId!, parentFolderId, siblingOrder);
    }
    if (!result) { res.status(400).json({ error: "name 또는 parentFolderId가 필요합니다" }); return; }
    res.json(result);
  }),
);

app.delete(
  "/api/folders/:folderId",
  authenticate,
  asyncRoute(async (req, res) => {
    const mode = req.query.mode as string | undefined;
    if (mode !== undefined && mode !== "recursive" && mode !== "promote") {
      res.status(400).json({ error: "mode는 recursive/promote 중 하나여야 합니다" });
      return;
    }
    await deleteFolder(req.params.folderId, req.userId!, mode as "recursive" | "promote" | undefined);
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

app.get(
  "/api/projects/:projectId/documents/unfiled",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listUnfiledDocuments(req.params.projectId, req.userId!));
  }),
);

app.put(
  "/api/documents/:trackingCode/folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
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

// ---------------------------------------------------------------- 코드 관계도 (Code Relation Graph)
// Claude가 코드 탐색 중 스스로 발견한 관계를 기록하는 자기 기록형
// 그래프 - folders.ts와 동일 원칙으로 설계자(userId) 개인 소유이고
// 프로젝트 멤버면(viewer 포함) 누구나 자기 관계를 관리할 수 있다
// (core/codeRelations.ts가 항상 req.userId로 다시 좁힘). "bulk"류가
// "/relations/:id"보다 먼저 등록돼야 한다(bulk-folder와 동일 이유).

app.post(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: CodeRelationInput[] };
    if (!items?.length) { res.status(400).json({ error: "items가 필요합니다" }); return; }
    res.json(await bulkCreateRelations(req.params.projectId, req.userId!, items));
  }),
);

app.put(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: BulkUpdateItem[] };
    if (!items?.length) { res.status(400).json({ error: "items가 필요합니다" }); return; }
    res.json(await bulkUpdateRelations(req.params.projectId, req.userId!, items));
  }),
);

app.delete(
  "/api/projects/:projectId/relations/bulk",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { ids } = req.body as { ids?: string[] };
    if (!ids?.length) { res.status(400).json({ error: "ids가 필요합니다" }); return; }
    res.json(await bulkDeleteRelations(req.params.projectId, req.userId!, ids));
  }),
);

// "관계도 초기화" 버튼 - branchName="__none__"이면 브랜치 없음 버킷만,
// allBranches=true면 전체. "/relations/:id"보다 먼저 등록해야 한다(위
// bulk 라우트들과 같은 이유 - Express 라우트 매칭 순서).
app.delete(
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

app.post(
  "/api/projects/:projectId/relations",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const input = req.body as CodeRelationInput;
    res.json(await createRelation(req.params.projectId, req.userId!, input));
  }),
);

app.get(
  "/api/projects/:projectId/relations",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { q, filePath, trackingCode, tag, hasNoParent, branchName, allBranches, page, pageSize } = req.query as Record<string, string | undefined>;
    res.json(
      await listRelations(req.params.projectId, req.userId!, {
        q,
        filePath,
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

app.get(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getRelation(req.params.id, req.params.projectId, req.userId!));
  }),
);

app.put(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const patch = req.body as Partial<CodeRelationInput> & {
      addParentIds?: string[]; removeParentIds?: string[]; addChildIds?: string[]; removeChildIds?: string[];
    };
    res.json(await updateRelation(req.params.id, req.params.projectId, req.userId!, patch));
  }),
);

app.delete(
  "/api/projects/:projectId/relations/:id",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    await deleteRelation(req.params.id, req.params.projectId, req.userId!);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/projects/:projectId/relations/:id/parents",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listParents(req.params.id, req.params.projectId, req.userId!));
  }),
);

app.get(
  "/api/projects/:projectId/relations/:id/children",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listChildren(req.params.id, req.params.projectId, req.userId!));
  }),
);

app.get(
  "/api/projects/:projectId/relations/:id/ancestors",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { depth, tag, q } = req.query as Record<string, string | undefined>;
    res.json(await listAncestors(req.params.id, req.params.projectId, req.userId!, Number(depth ?? 3), { tag, q }));
  }),
);

app.get(
  "/api/projects/:projectId/relations/:id/descendants",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { depth, tag, q } = req.query as Record<string, string | undefined>;
    res.json(await listDescendants(req.params.id, req.params.projectId, req.userId!, Number(depth ?? 3), { tag, q }));
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

app.get(
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

app.get(
  "/api/projects/:projectId/pending/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const notice = await pendingQuestionNotice(req.params.projectId);
    const paged = await listPendingQuestionsPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20));
    res.json(withNotices(paged, notice));
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

// 소유권 확인(본인이 등록한 질의만)은 withdrawQuestion() 내부에서
// 처리한다 - editComment/deleteComment와 같은 패턴(라우트는
// authenticate만, "본인 소유물만" 거부는 core가 에러로).
app.post(
  "/api/questions/:trackingCode/withdraw",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await withdrawQuestion(req.params.trackingCode, req.userId!));
  }),
);

// 선택한 질의들이 서로 다른 프로젝트/권한을 가질 수 있어(document
// bulk-transition과 동일한 이유) 전부-성공/전부-실패가 아니라
// 항목별 결과를 반환한다 - 새 core 함수 없이 기존 단건 함수를 그대로
// 반복 호출한다.
app.post(
  "/api/questions/bulk-ack",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes } = req.body as { trackingCodes?: string[] };
    if (!trackingCodes?.length) {
      res.status(400).json({ error: "trackingCodes가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const projectId = await getQuestionProjectId(trackingCode);
          if (!projectId) return { trackingCode, ok: false, error: "질문을 찾을 수 없습니다" };
          if (!(await requireEditorForTarget(projectId, req.userId!))) {
            return { trackingCode, ok: false, error: "이 작업은 최소 editor 권한이 필요합니다" };
          }
          const updated = await acknowledgeQuestion(trackingCode);
          return { trackingCode, ok: true, status: updated.status };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
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
    res.json(await setTemplateOverride(filename, { teamId, projectGroupId, projectId }, content, req.userId!));
  }),
);

app.get(
  "/api/templates/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    if (!filename) { res.status(400).json({ error: "filename이 필요합니다" }); return; }
    const teamId = req.query.teamId as string | undefined;
    const projectGroupId = req.query.projectGroupId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    res.json(await listTemplateRevisions(filename, { teamId, projectGroupId, projectId }));
  }),
);

app.get(
  "/api/templates/revisions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    if (!filename) { res.status(400).json({ error: "filename이 필요합니다" }); return; }
    const teamId = req.query.teamId as string | undefined;
    const projectGroupId = req.query.projectGroupId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    res.json(
      await listTemplateRevisionsPaged(
        filename,
        { teamId, projectGroupId, projectId },
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
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
    const status = req.query.status as "pending" | "processing" | "delivered" | "all" | undefined;
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

// 소유권 확인(본인이 보낸 메시지만, superAdmin 우회)은 editMessage/
// deleteMessage 내부에서 처리한다 - comments 라우트와 동일한 패턴.
app.put(
  "/api/messages/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await editMessage(req.params.id, body, req.userId!));
  }),
);

app.delete(
  "/api/messages/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    await deleteMessage(req.params.id, req.userId!);
    res.json({ ok: true });
  }),
);

// ack/complete는 소유권이 아니라 프로젝트 멤버십만 확인한다(editMessage/
// deleteMessage와 다른 점) - 처리 상태는 "누가 보냈나"가 아니라 "누가
// 처리했나"를 기록하는 축이라 다른 설계자가 보낸 메시지도 ack/complete
// 할 수 있어야 한다.
app.put(
  "/api/messages/:id/ack",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await ackMessage(req.params.id, req.userId!));
  }),
);

app.put(
  "/api/messages/:id/complete",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await completeMessage(req.params.id, req.userId!));
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
    const status = req.query.status as "pending" | "processing" | "delivered" | "all" | undefined;
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
    const result = await checkConnect(username, password);
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

app.post(
  "/api/projects/:projectId/git/promote-to-external",
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
    if (!gitCredentialId) { res.status(400).json({ error: "gitCredentialId가 필요합니다" }); return; }
    try {
      const result = await promoteToExternal(req.params.projectId, provider, repoUrl, gitCredentialId);
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

// "웹훅 수동 설정 안내" 카드를 새로고침 후에도(또는 접었다 폈다 할
// 때마다) 다시 보여줄 수 있도록 URL/secret을 다시 조회하는 전용
// 라우트 - git 저장소 관리 기능 전반과 같은 원칙으로 owner 전용
// (secret이 섞여 있어 GET .../git/repo의 viewer 공개 범위엔 안 둠).
app.get(
  "/api/projects/:projectId/git/webhook-instructions",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getWebhookSetupInstructions(req.params.projectId));
  }),
);

// 외부 연동(link-external)의 권위 저장소 관계만 끊는다 - 자체 호스팅
// 저장소는 프로젝트 삭제 없이는 해제할 수 없다(설계자 확정,
// #git-unlink). 응답은 전환 후 상태(provider:"self_hosted")를 그대로
// 돌려줘 프런트가 재조회 없이 화면을 갱신할 수 있게 한다.
app.delete(
  "/api/projects/:projectId/git/repo",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await unlinkExternalRepo(req.params.projectId));
  }),
);

app.get(
  "/api/projects/:projectId/git/log",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    res.json(await gitea.listCommits(target, { ref }));
  }),
);

// 웹 변경 추적 화면 전용 페이지네이션(요청 4번) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
app.get(
  "/api/projects/:projectId/git/log/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await gitea.listCommitsPaged(target, { ref, page, pageSize }));
  }),
);

app.get(
  "/api/projects/:projectId/git/diff/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const diff = await gitea.getCommitDiff(target, req.params.sha);
    res.type("text/plain").send(diff);
  }),
);

app.get(
  "/api/projects/:projectId/git/blame",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filepath = req.query.path as string | undefined;
    if (!filepath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getBlame(target, filepath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/show/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.getCommit(target, req.params.sha));
  }),
);

// ---------------------------------------------------------------- git 트리/파일 조회·저장 (Phase 5(2/3) - 소스 코드 브라우저용)

app.get(
  "/api/projects/:projectId/git/tree",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const dirPath = (req.query.path as string | undefined) ?? "";
    res.json(await gitea.listTree(target, dirPath, req.query.ref as string | undefined));
  }),
);

app.get(
  "/api/projects/:projectId/git/tree/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const dirPath = (req.query.path as string | undefined) ?? "";
    res.json(
      await gitea.listTreePaged(
        target,
        dirPath,
        req.query.ref as string | undefined,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

app.get(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    res.json(await gitea.getFileContent(target, filePath, req.query.ref as string | undefined));
  }),
);

// 문서와 같은 이유(#document-partial-read-grep-diff)로 소스 코드
// 파일도 부분 읽기/검색 지원 - 큰 파일을 매번 전체로 안 올려도 됨.
app.get(
  "/api/projects/:projectId/git/file/lines",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(await gitea.readSourceFileLines(target, filePath, req.query.ref as string | undefined, offset, limit));
  }),
);

app.get(
  "/api/projects/:projectId/git/file/grep",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const { q } = req.query as { q?: string };
    if (!q) { res.status(400).json({ error: "q가 필요합니다" }); return; }
    const matches = await gitea.grepSourceFile(target, filePath, q, req.query.ref as string | undefined, {
      caseInsensitive: req.query.caseInsensitive === "true",
      context: req.query.context !== undefined ? Number(req.query.context) : undefined,
    });
    res.json(matches);
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
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.getFullTree(target));
  }),
);

app.put(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const { content, message } = req.body as { content?: string; message?: string };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
    // 커밋이 실제로 이 요청을 보낸 설계자 신원으로 귀속되도록, 그
    // 설계자의 Gitea PAT를 구해 넘긴다 - 아직 없으면(과도기 상태)
    // putFileContent()가 관리자 토큰으로 폴백한다.
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await gitea.putFileContent(target, filePath, content, message || `docs: update ${filePath}`, actingToken);
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
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path as string | undefined;
    if (!filePath) { res.status(400).json({ error: "path 쿼리 파라미터가 필요합니다" }); return; }
    const raw = await gitea.getFileRaw(target, filePath, req.query.ref as string | undefined);
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

// ---------------------------------------------------------------- 저장소 관리 탭 - 브랜치 / Pull Request
// "워크트리 리스트"는 이 아키텍처(프로젝트당 공유 Gitea work 저장소
// 하나, 로컬 다중 clone 없음)에 문자 그대로는 존재할 수 없어 "브랜치
// 목록 + 브랜치별 소스 열람"으로 재해석(설계자 확인 전제) - git/tree,
// git/log, git/file이 이미 받던 ref 쿼리 파라미터를 프론트의 브랜치
// 선택 UI가 실제로 채워 보내면 그대로 동작한다(새 조회 라우트 불필요).

app.get(
  "/api/projects/:projectId/git/branches",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listBranches(target));
  }),
);

// 목록은 항상 최신순(요구사항 7) - listPullRequestsForProject가
// createdAt desc로 확정 정렬하고 PullRequestMeta(disposition)도 병합해
// 반환한다. Gitea Contents API처럼 page 파라미터를 안정적으로 받지
// 않는 상류 특성상(listTreePaged와 동일 이유) 전체를 받아온 뒤 여기서
// 자른다 - /page 하위 경로는 저장소 관리 탭의 5개+더보기(요구사항 3)와
// 별도 PullRequestListView의 완전한 페이지네이션 둘 다에 쓴다.
app.get(
  "/api/projects/:projectId/git/pulls",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const state = req.query.state as "open" | "closed" | "all" | undefined;
    res.json(await listPullRequestsForProject(req.params.projectId, state));
  }),
);

app.get(
  "/api/projects/:projectId/git/pulls/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const state = req.query.state as "open" | "closed" | "all" | undefined;
    const all = await listPullRequestsForProject(req.params.projectId, state);
    res.json(paginateInMemory(all, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

app.get(
  "/api/projects/:projectId/git/pulls/:index",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getPullRequestDetail(req.params.projectId, Number(req.params.index)));
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const { title, head, base, body } = req.body as { title?: string; head?: string; base?: string; body?: string };
    if (!title || !head || !base) {
      res.status(400).json({ error: "title/head/base가 필요합니다" });
      return;
    }
    // PR이 이 요청을 보낸 설계자 신원으로 귀속되도록 - putFileContent()와
    // 같은 원칙(없으면 관리자 토큰 폴백).
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    res.json(await gitea.createPullRequest(target, { title, head, base, body }, actingToken));
  }),
);

// 실질적인 머지는 프로젝트 소유자만(설계자 요청 핵심 제약) -
// requireProjectRole("owner")가 git 저장소 기능 전반과 동일한 수준으로
// 강제한다(PR 생성은 editor 이상 가능하지만 머지는 owner만).
app.post(
  "/api/projects/:projectId/git/pulls/:index/merge",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await mergePull(req.params.projectId, Number(req.params.index), req.userId!, actingToken);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- PR 상세 페이지 - 메시지/커밋/대화/진행내역 + Reject/Close/Reopen/수동병합
// requireProjectRole("owner")가 머지/수동병합에만(기존 확정 - "머지는
// 소유자만"), 나머지 액션(거부/닫기/재오픈/댓글 작성)은 PR 생성과 같은
// 급(editor 이상)으로 뒀다 - 되돌릴 수 있는 동작이고 저장소 히스토리를
// 바꾸지 않기 때문. 조회는 전부 viewer 이상.

app.get(
  "/api/projects/:projectId/git/pulls/:index/commits",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestCommits(target, Number(req.params.index)));
  }),
);

app.get(
  "/api/projects/:projectId/git/pulls/:index/comments",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestComments(target, Number(req.params.index)));
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls/:index/comments",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const { body } = req.body as { body?: string };
    if (!body?.trim()) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    res.json(await gitea.addPullRequestComment(target, Number(req.params.index), body.trim(), actingToken));
  }),
);

app.get(
  "/api/projects/:projectId/git/pulls/:index/timeline",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestTimeline(target, Number(req.params.index)));
  }),
);

app.get(
  "/api/projects/:projectId/git/pulls/:index/messages",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMessagesForPullRequest(req.params.projectId, Number(req.params.index)));
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls/:index/merge-manually",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { mergeCommitId } = req.body as { mergeCommitId?: string };
    if (!mergeCommitId?.trim()) { res.status(400).json({ error: "mergeCommitId가 필요합니다" }); return; }
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await mergePullManually(req.params.projectId, Number(req.params.index), mergeCommitId.trim(), req.userId!, actingToken);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls/:index/reject",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await rejectPull(req.params.projectId, Number(req.params.index), req.userId!, actingToken);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls/:index/close",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await closePull(req.params.projectId, Number(req.params.index), req.userId!, actingToken);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/projects/:projectId/git/pulls/:index/reopen",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await reopenPull(req.params.projectId, Number(req.params.index), req.userId!, actingToken);
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
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const kind = classifyGiteaEvent(headers);
    if (kind === "unknown") {
      // 서명 검증 없이도 조용히 무시 - 시스템 웹훅은 인스턴스 전체
      // 이벤트를 받으므로 push/delete 외의 이벤트(향후 events 목록이
      // 늘어나기 전까지는 실제로 안 옴)는 처리 대상이 아닐 뿐 에러가
      // 아니다.
      res.json({ ok: true, status: "ignored", reason: `처리 대상이 아닌 이벤트: ${headers["x-gitea-event"] ?? "?"}` });
      return;
    }
    try {
      if (kind === "push") {
        const parsed = verifyAndParsePushWebhook(headers, rawBody, secret);
        const result = await handleGiteaSystemPush(parsed);
        res.json({ ok: true, ...result });
      } else {
        const parsed = verifyAndParseDeleteWebhook(headers, rawBody, secret);
        const result = await handleGiteaSystemDelete(parsed);
        res.json({ ok: true, ...result });
      }
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
    }
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
    await markExternalWebhookReceived(projectId);
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

app.get(
  "/api/projects/:projectId/push-hook-prompts/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listPushHookPromptsPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

app.put(
  "/api/projects/:projectId/push-hook-prompts/:id",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const body = req.body as { triggerBranch?: string; promptTemplate?: string };
    res.json(await updatePushHookPrompt(req.params.id, req.params.projectId, body));
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

app.get(
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
    const target = await requireGiteaWorkingRef(projectId);
    const deployed: string[] = [];
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;

    const claudeMd = await resolveTemplate("CLAUDE.md", projectId);
    if (claudeMd) {
      await gitea.putFileContent(target, "CLAUDE.md", claudeMd.content, "docs: deploy CLAUDE.md template", actingToken);
      deployed.push("CLAUDE.md");
    }
    const skillFilename = ".claude/skills/claude-native-workflow/SKILL.md";
    const skillMd = await resolveTemplate(skillFilename, projectId);
    if (skillMd) {
      await gitea.putFileContent(target, skillFilename, skillMd.content, "docs: deploy SKILL.md template", actingToken);
      deployed.push(skillFilename);
    }

    res.json({ ok: true, deployed });
  }),
);

// ---------------------------------------------------------------- 에러 핸들러

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthError) { res.status(400).json({ error: err.message }); return; }
  if (err instanceof LoginRateLimitError) {
    res.status(429).set("Retry-After", String(err.retryAfterSeconds)).json({ error: err.message });
    return;
  }
  if (err instanceof MeiliSearchRequestError) {
    // 내부 Docker 호스트명이 그대로 노출되던 원본 메시지는 로그에만
    // 남기고, 응답은 원인을 알 수 있는 일반화된 메시지로 바꾼다
    // (#meilisearch-spof 조사로 발견 - 이전엔 400 + 원본 메시지였음).
    console.error(err);
    res.status(503).json({ error: "검색 엔진(Meilisearch)에 연결할 수 없습니다 - 서비스 상태를 확인한 뒤 다시 시도하세요" });
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
  // 프로젝트별 org 구조(#gitea-per-project-namespace)에서는 전역 org를
  // 부팅 시 미리 만들어둘 필요가 없다 - 프로젝트가 처음 git 저장소를
  // 연결하는 시점에 ensureProjectOrgConfigured()가 그때그때 만든다.
  await gitea.ensureGiteaSystemWebhookConfigured();
  await ensureAllUsersGiteaAccountsConfigured();

  // Meilisearch 장애 중 밀린 색인 쓰기 큐를 주기적으로 비운다
  // (#meilisearch-spof). draining 플래그로 이전 드레인이 아직 진행
  // 중이면 이번 틱을 건너뛴다 - 큐가 커서 30초 안에 못 끝나는 경우 두
  // 드레인이 겹쳐 같은 배치를 동시에 처리하는 걸 방지.
  let draining = false;
  setInterval(() => {
    if (draining) return;
    draining = true;
    drainSearchSyncQueue()
      .catch((err) => console.error("검색 동기화 큐 드레인 실패:", err))
      .finally(() => { draining = false; });
  }, 30_000);

  // push 훅 대기열 중 아무도 안 봐서 영원히 pending으로 남는 항목을
  // 주기적으로 expired 처리한다(#hook-queue-ttl) - TTL이 30일 단위라
  // 하루에 한 번이면 충분하다.
  setInterval(() => {
    expireStalePushHookQueueEntries().catch((err) => console.error("push 훅 대기열 만료 처리 실패:", err));
  }, 24 * 60 * 60 * 1000);

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
