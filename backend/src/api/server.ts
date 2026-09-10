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
} from "../core/auth.js";
import { assertCredentialEncryptionKeyConfigured } from "../core/crypto.js";
import { addGitCredential, listGitCredentials, removeGitCredential } from "../core/gitCredentials.js";
import { createTeam, listTeams } from "../core/teams.js";
import { addTeamAdmin, removeTeamAdmin, listTeamAdmins } from "../core/teamAdmins.js";
import { getInstallConfig } from "../core/installConfig.js";
import { createProjectGroup, listProjectGroups } from "../core/projectGroups.js";
import { createProject, getProject, listProjects, canSeeHiddenProject, setProjectHidden, getOwningTeamId } from "../core/projects.js";
import { addMember, listMembers, getMemberRole, roleSatisfies } from "../core/members.js";
import { isTeamAdmin } from "../core/teamAdmins.js";
import { listUserActivity } from "../core/activity.js";
import {
  createDocType,
  listDocTypes,
  listDocTypesForProject,
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
  searchProjectDocuments,
  saveDocumentBody,
  transitionDocumentStatus,
  addDocumentLink,
  listBacklinks,
  listDocumentRevisions,
  deleteDocument,
} from "../core/documents.js";
import { createReport } from "../core/report.js";
import {
  addQuestion,
  listPendingQuestions,
  answerQuestion,
  listQuestions,
  getQuestionProjectId,
  acknowledgeQuestion,
  countPendingQuestions,
} from "../core/questions.js";
import { addComment, listComments, resolveComment } from "../core/comments.js";
import { resolveTemplate, setTemplateOverride, seedDefaultTemplates } from "../core/templates.js";
import { ensureSearchIndexes } from "../core/search.js";
import { resolveEffectivePermission, setAccessOverride, listAccessOverrides } from "../core/permissions.js";
import { createFolder, renameFolder, deleteFolder, listFolders, listFolderDocuments, moveDocumentToFolder, getFolderById } from "../core/folders.js";
import { authenticate, requireProjectRole, type AuthedRequest } from "../middleware/auth.js";
import {
  linkSelfHostedRepo,
  linkExternalAsPrimary,
  getProjectGitRepo,
  getWebhookSecret,
  requireGiteaWorkingSlug,
  requestGitSyncStatus,
  getCachedGitSyncStatus,
  getGitSyncProposal,
  GitAuthRequiredError,
} from "../core/gitRepos.js";
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
import { sendMessage, listMessages, waitForMessage, listRecentMessages } from "../core/messages.js";
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
  asyncRoute(async (req, res) => {
    const { email, phone, emailVisible, phoneVisible } = req.body as {
      email?: string;
      phone?: string;
      emailVisible?: boolean;
      phoneVisible?: boolean;
    };
    res.json(await updateMe(req.userId!, { email, phone, emailVisible, phoneVisible }));
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
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createTeam(name));
  }),
);

app.get(
  "/api/teams",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json(await listTeams());
  }),
);

// 팀장 관리 - 팀 스코프 쓰기는 지금까지 전부 authenticate만 요구해왔다
// (설치 단위 admin role이 아직 없다는 기존 한계의 연장 - PUT /api/templates,
// POST /api/teams/:id/doc-types 등과 동일).
app.post(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    res.json(await addTeamAdmin(req.params.teamId, userId));
  }),
);

app.delete(
  "/api/teams/:teamId/admins/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    await removeTeamAdmin(req.params.teamId, req.params.userId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeamAdmins(req.params.teamId));
  }),
);

app.post(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name, teamId } = req.body as { name?: string; teamId?: string };
    if (!name) { res.status(400).json({ error: "name이 필요합니다" }); return; }
    res.json(await createProjectGroup(name, teamId));
  }),
);

app.get(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjectGroups(req.query.teamId as string | undefined));
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
    res.json(withNotices(project, notice));
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

// ---------------------------------------------------------------- 문서 타입 체계

app.post(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { code, label, guideline } = req.body as { code?: string; label?: string; guideline?: string };
    if (!code || !label) { res.status(400).json({ error: "code/label이 필요합니다" }); return; }
    res.json(await createDocType({ projectId: req.params.projectId }, code, label, guideline));
  }),
);

app.get(
  "/api/projects/:projectId/doc-types",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    // 이 프로젝트 스코프뿐 아니라 소속 group/team에 상속된 타입도
    // 같이 보여준다 - "이 프로젝트에서 실제로 쓸 수 있는 타입 전체"가
    // 이 라우트의 실제 의미(문서 생성 화면 드롭다운이 이걸 씀).
    res.json(await listDocTypesForProject(req.params.projectId));
  }),
);

// 위 라우트와 달리 상속분을 빼고 이 프로젝트에 직접 정의된 타입만 -
// 관리 화면(웹 UI의 DocTypeManager)이 "여기서 상태/전이를 추가해도 되는
// 타입"을 구분할 때 쓴다(상속된 타입은 그걸 실제로 소유한 그룹/팀
// 화면에서 관리해야 함).
app.get(
  "/api/projects/:projectId/doc-types/own",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes({ projectId: req.params.projectId }));
  }),
);

// 팀/그룹 스코프 DocType - Member는 projectId에만 연결되고 팀/그룹
// 단위 "관리자" 역할 개념이 아직 없다(설치 단위 admin role은 범위 밖 -
// PUT /api/templates가 팀/그룹 스코프에 authenticate만 요구하는 것과
// 같은, 이미 문서화된 한계를 그대로 따른다).
app.post(
  "/api/teams/:teamId/doc-types",
  authenticate,
  asyncRoute(async (req, res) => {
    const { code, label, guideline } = req.body as { code?: string; label?: string; guideline?: string };
    if (!code || !label) { res.status(400).json({ error: "code/label이 필요합니다" }); return; }
    res.json(await createDocType({ teamId: req.params.teamId }, code, label, guideline));
  }),
);

app.get(
  "/api/teams/:teamId/doc-types",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes({ teamId: req.params.teamId }));
  }),
);

app.post(
  "/api/project-groups/:groupId/doc-types",
  authenticate,
  asyncRoute(async (req, res) => {
    const { code, label, guideline } = req.body as { code?: string; label?: string; guideline?: string };
    if (!code || !label) { res.status(400).json({ error: "code/label이 필요합니다" }); return; }
    res.json(await createDocType({ projectGroupId: req.params.groupId }, code, label, guideline));
  }),
);

app.get(
  "/api/project-groups/:groupId/doc-types",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocTypes({ projectGroupId: req.params.groupId }));
  }),
);

app.get(
  "/api/doc-types/:docTypeId/statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listDocStatuses(req.params.docTypeId));
  }),
);

// docTypeId가 실제로 이 프로젝트 소속인지 확인 - 다른 프로젝트/팀
// 스코프의 docTypeId를 잘못(또는 악의적으로) 겨냥하는 걸 막는다.
async function requireOwnedDocType(projectId: string, docTypeId: string): Promise<boolean> {
  const docType = await getDocTypeById(docTypeId);
  return docType !== null && docType.projectId === projectId;
}

async function requireOwnedDocTypeByTeam(teamId: string, docTypeId: string): Promise<boolean> {
  const docType = await getDocTypeById(docTypeId);
  return docType !== null && docType.teamId === teamId;
}

async function requireOwnedDocTypeByGroup(groupId: string, docTypeId: string): Promise<boolean> {
  const docType = await getDocTypeById(docTypeId);
  return docType !== null && docType.projectGroupId === groupId;
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

// 팀/그룹 스코프 DocType에 상태/전이 붙이기 - 생성/목록 라우트와 같은
// 인가 수준(authenticate만, 팀/그룹 단위 관리자 역할이 아직 없다는
// 이미 문서화된 한계를 그대로 따름 - PUT /api/templates와 동일).
app.post(
  "/api/teams/:teamId/doc-types/:docTypeId/statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByTeam(req.params.teamId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 팀에 해당 문서 타입이 없습니다" });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) { res.status(400).json({ error: "code가 필요합니다(draft/review/pending/approved/deprecated/archived 중 하나)" }); return; }
    res.json(await addDocStatus(req.params.docTypeId, code));
  }),
);

app.post(
  "/api/teams/:teamId/doc-types/:docTypeId/transitions",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByTeam(req.params.teamId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 팀에 해당 문서 타입이 없습니다" });
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
  "/api/teams/:teamId/doc-types/:docTypeId/guideline",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByTeam(req.params.teamId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 팀에 해당 문서 타입이 없습니다" });
      return;
    }
    const { guideline } = req.body as { guideline?: string };
    if (guideline === undefined) { res.status(400).json({ error: "guideline이 필요합니다" }); return; }
    res.json(await setDocTypeGuideline(req.params.docTypeId, guideline));
  }),
);

app.post(
  "/api/teams/:teamId/doc-types/:docTypeId/standard-flow",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByTeam(req.params.teamId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 팀에 해당 문서 타입이 없습니다" });
      return;
    }
    await seedStandardStatusFlow(req.params.docTypeId);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/project-groups/:groupId/doc-types/:docTypeId/statuses",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByGroup(req.params.groupId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트 그룹에 해당 문서 타입이 없습니다" });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) { res.status(400).json({ error: "code가 필요합니다(draft/review/pending/approved/deprecated/archived 중 하나)" }); return; }
    res.json(await addDocStatus(req.params.docTypeId, code));
  }),
);

app.post(
  "/api/project-groups/:groupId/doc-types/:docTypeId/transitions",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByGroup(req.params.groupId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트 그룹에 해당 문서 타입이 없습니다" });
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
  "/api/project-groups/:groupId/doc-types/:docTypeId/guideline",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByGroup(req.params.groupId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트 그룹에 해당 문서 타입이 없습니다" });
      return;
    }
    const { guideline } = req.body as { guideline?: string };
    if (guideline === undefined) { res.status(400).json({ error: "guideline이 필요합니다" }); return; }
    res.json(await setDocTypeGuideline(req.params.docTypeId, guideline));
  }),
);

app.post(
  "/api/project-groups/:groupId/doc-types/:docTypeId/standard-flow",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await requireOwnedDocTypeByGroup(req.params.groupId, req.params.docTypeId))) {
      res.status(404).json({ error: "이 프로젝트 그룹에 해당 문서 타입이 없습니다" });
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

app.get(
  "/api/projects/:projectId/search",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const q = (req.query.q as string | undefined) ?? "";
    res.json(await searchProjectDocuments(req.params.projectId, q));
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
    res.json(withNotices(doc, perm.notice));
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

// ---------------------------------------------------------------- 문서 정리용 폴더 (웹 전용 - AI는 모름, CLI/MCP는 절대 호출하지 않음)

app.post(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("editor"),
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

app.get(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listFolders(req.params.projectId));
  }),
);

app.get(
  "/api/folders/:folderId/documents",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listFolderDocuments(req.params.folderId));
  }),
);

app.put(
  "/api/folders/:folderId/access",
  authenticate,
  asyncRoute(async (req, res) => {
    const folder = await getFolderById(req.params.folderId);
    if (!folder) { res.status(404).json({ error: "폴더를 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(folder.projectId, req.userId!);
    if (role !== "owner") { res.status(403).json({ error: "프로젝트 owner만 접근 권한을 설정할 수 있습니다" }); return; }
    const { userId, canRead, canWrite, canDelete } = req.body as {
      userId?: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
    };
    if (!userId) { res.status(400).json({ error: "userId가 필요합니다" }); return; }
    await setAccessOverride(folder.projectId, userId, { folderId: folder.id }, { canRead, canWrite, canDelete });
    res.json({ ok: true });
  }),
);

app.put(
  "/api/documents/:trackingCode/folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocument(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.write) { res.status(403).json({ error: "이 문서에 대한 쓰기 권한이 없습니다" }); return; }
    const { folderId } = req.body as { folderId?: string | null };
    await moveDocumentToFolder(req.params.trackingCode, folderId ?? null, req.userId!);
    res.json({ ok: true });
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

// ---------------------------------------------------------------- 질의/답변 (질의는 AI, 답변은 설계자 - open→pending→resolved)

async function pendingQuestionNotice(projectId: string): Promise<string | null> {
  const n = await countPendingQuestions(projectId);
  if (n === 0) return null;
  return `이 프로젝트에 설계자가 답변했지만 아직 확인하지 않은 질의가 ${n}건 있습니다 - docs question ack <trackingCode>로 처리하세요`;
}

app.post(
  "/api/documents/:trackingCode/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const document = await getDocument(req.params.trackingCode);
    if (!document) { res.status(404).json({ error: "문서를 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(document.projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { text, refs } = req.body as { text?: string; refs?: string[] };
    if (!text) { res.status(400).json({ error: "text가 필요합니다" }); return; }
    res.json(await addQuestion(req.params.trackingCode, text, req.userId!, refs));
  }),
);

app.get(
  "/api/documents/:trackingCode/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const document = await getDocument(req.params.trackingCode);
    if (!document) { res.status(404).json({ error: "문서를 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(document.projectId, req.userId!);
    if (!roleSatisfies(role, "viewer")) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listQuestions(req.params.trackingCode));
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
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    res.json(await answerQuestion(req.params.trackingCode, body, req.userId!));
  }),
);

app.post(
  "/api/questions/:trackingCode/ack",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, "editor")) { res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" }); return; }
    res.json(await acknowledgeQuestion(req.params.trackingCode));
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
    const { content, teamId, projectGroupId, projectId } = req.body as {
      content?: string;
      teamId?: string;
      projectGroupId?: string;
      projectId?: string;
    };
    if (content === undefined) { res.status(400).json({ error: "content가 필요합니다" }); return; }
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
      res.json(await linkExternalAsPrimary(req.params.projectId, provider, repoUrl, gitCredentialId));
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
    await gitea.putFileContent(slug, filePath, content, message || `docs: update ${filePath}`);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 동기화 제안 (외부 연동 전용 - 미러 vs 작업 저장소)
// Gitea의 mirror-sync 트리거가 비동기 큐잉이라(즉시 완료 안 됨) 요청/조회를
// 분리한다 - POST가 트리거(즉시 "예정됨"/"이미 예정됨" 반환), GET이
// 그 결과를 폴링(pending/ready/none). 이미 진행 중일 때 POST를 또
// 호출해도 새로 트리거하지 않는다(requestGitSyncStatus 내부에서 처리).

app.post(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await requestGitSyncStatus(req.params.projectId));
  }),
);

app.get(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getCachedGitSyncStatus(req.params.projectId));
  }),
);

app.get(
  "/api/projects/:projectId/git/sync-proposal",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getGitSyncProposal(req.params.projectId));
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
    const slug = await requireGiteaWorkingSlug(projectId);
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
  await seedDefaultAdminAccount();
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
