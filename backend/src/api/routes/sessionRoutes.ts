// 배치 7f(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 세션/동시 작업 등록(SP-976DD4ED) + EMQX 클라이언트 인증/인가. 둘 다
// 작아서 한 파일로 합쳤다. server.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import { Router } from "express";
import { listSessions, listProjectSessions, renameSession, claimWork, releaseWork, listWorkClaims, type WorkTargetType } from "../../core/sessions.js";
import { checkConnect, checkAcl } from "../../core/emqxAuth.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, resolveSessionId } from "../shared.js";

const router = Router();

// 계정 전체 스코프(프로젝트에 안 묶임) - CLI/MCP가 공유하는 apiFetch()가
// 자동으로 붙이는 X-Session-Id 헤더로 middleware/auth.ts가 이미
// Session 행을 하트비트 갱신해두므로, 여기 조회 라우트들은 그 값을
// 읽기만 한다.

router.get(
  "/api/sessions",
  authenticate,
  asyncRoute(async (req, res) => {
    const sinceMinutes = req.query.minutes !== undefined ? Number(req.query.minutes) : undefined;
    res.json(await listSessions(req.userId!, sinceMinutes));
  }),
);

router.put(
  "/api/sessions/:id/name",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name } = req.body as { name?: string };
    assertTruthy(name, "name이 필요합니다");
    res.json(await renameSession(req.params.id, req.userId!, name));
  }),
);

router.get(
  "/api/projects/:projectId/work-claims",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const aliveMinutes = req.query.minutes !== undefined ? Number(req.query.minutes) : undefined;
    res.json(await listWorkClaims(req.params.projectId, aliveMinutes));
  }),
);

// "이 프로젝트에서 어떤 설계자의 어떤 세션이 활동 중인지" 전체 목록
// (설계자 지시) - 프로젝트 홈의 미리보기 + "더보기" → 이 라우트를
// 페이지네이션과 함께 쓰는 별도 화면.
router.get(
  "/api/projects/:projectId/sessions/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await listProjectSessions(req.params.projectId, page, pageSize));
  }),
);

router.post(
  "/api/projects/:projectId/work-claims",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { targetType, targetKey } = req.body as { targetType?: WorkTargetType; targetKey?: string };
    const sessionId = resolveSessionId(req);
    assertTruthy(sessionId, "X-Session-Id 헤더가 필요합니다 - 이 명령을 사용하는 클라이언트는 자동으로 붙입니다");
    if (!targetType || !targetKey) { res.status(400).json({ error: "targetType/targetKey가 필요합니다" }); return; }
    res.json(await claimWork(sessionId, req.params.projectId, targetType, targetKey));
  }),
);

router.delete(
  "/api/projects/:projectId/work-claims",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { targetType, targetKey } = req.body as { targetType?: WorkTargetType; targetKey?: string };
    const sessionId = resolveSessionId(req);
    assertTruthy(sessionId, "X-Session-Id 헤더가 필요합니다");
    if (!targetType || !targetKey) { res.status(400).json({ error: "targetType/targetKey가 필요합니다" }); return; }
    await releaseWork(sessionId, req.params.projectId, targetType, targetKey);
    res.json({ ok: true });
  }),
);

// EMQX 클라이언트 인증/인가 (Phase 4 - 인증 미들웨어 없음, EMQX가 직접 호출)

router.post(
  "/api/emqx/authn",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const result = await checkConnect(username, password);
    res.json({ result });
  }),
);

router.post(
  "/api/emqx/authz",
  asyncRoute(async (req, res) => {
    const { username, topic } = req.body as { username?: string; topic?: string };
    const result = await checkAcl(username, topic);
    res.json({ result });
  }),
);

export default router;
