// 배치 3(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// API 키(신원 위임 인증, 3종: project/team/personal). server.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 이 섹션은 헤더 위치가 실제
// 내용과 정확히 일치했다(배치 2b의 팀/그룹/프로젝트와 달리).
import { Router, type Response } from "express";
import {
  createApiKey,
  listProjectKeys,
  listProjectKeysPaged,
  listTeamKeys,
  listTeamKeysPaged,
  listMyPersonalKeys,
  listMyPersonalKeysPaged,
  listMyProjectKeys,
  getApiKeyById,
  revokeApiKey,
  ApiKeyError,
} from "../../core/apiKeys.js";
import { isSuperAdmin } from "../../core/auth.js";
import { getMemberRole } from "../../core/members.js";
import { isTeamAdmin } from "../../core/teamAdmins.js";
import { authenticate, requireUnrestrictedScope, requireProjectRole } from "../../middleware/auth.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// 세 종류 다 "그 키를 만든 설계자의 신원 인증을 대행"하고 스코프만
// 다르다(core/apiKeys.ts). 키 발급/배제는 위험도가 커서(팀장 관리
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

router.post(
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

router.get(
  "/api/projects/:projectId/api-keys",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listProjectKeys(req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/api-keys/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectKeysPaged(req.params.projectId, req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

router.post(
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

router.get(
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

router.get(
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

router.post(
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

router.get(
  "/api/api-keys/personal",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyPersonalKeys(req.userId!));
  }),
);

router.get(
  "/api/api-keys/personal/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyPersonalKeysPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// "내 정보" 화면 "프로젝트 키" 탭 - 내가 여러 프로젝트에 걸쳐 만든
// 프로젝트 키를 한 곳에 모아본다(#profile-api-keys-tabs).
router.get(
  "/api/api-keys/project-mine",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listMyProjectKeys(req.userId!));
  }),
);

// 배제 권한: personal은 본인만, project는 본인 또는 그 프로젝트
// owner, team은 본인 또는 그 팀의 팀장 - "각자의 단위에 해당하는 키를
// 관리"한다는 요구를 그대로 반영(core/apiKeys.ts의 revokeApiKey는 상태
// 갱신만 하고, 권한 판정은 이 저장소의 기존 관례대로 라우트에서 한다).
router.delete(
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

export default router;
