// 배치 1(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 인증/git 자격증명/GitHub OAuth/설치 전역 설정. server.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜, 이 라우터를 만든 위치(server.ts)에
// 원래와 같은 순서로 app.use()한다.
import { Router, type Request } from "express";
import { register, login, refresh, logout } from "../../core/auth.js";
import { addGitCredential, listGitCredentials, listGitCredentialsPaged, removeGitCredential, getCredentialTokenIfOwner } from "../../core/gitCredentials.js";
import { checkAllCredentials } from "../../core/gitRepos.js";
import { isGithubOAuthConfigured, startGithubOAuth, completeGithubOAuth, listGithubRepos } from "../../core/githubOAuth.js";
import { getInstallConfig } from "../../core/installConfig.js";
import { authenticate, requireUnrestrictedScope } from "../../middleware/auth.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// ---------------------------------------------------------------- 인증

router.post(
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

router.post(
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

router.post(
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

router.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (refresh_token) await logout(refresh_token);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- git 자격증명

router.post(
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

router.get(
  "/api/credentials",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(await listGitCredentials(req.userId!));
  }),
);

router.get(
  "/api/credentials/page",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(await listGitCredentialsPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// 프로젝트 하나에 묶이지 않고 이 사용자의 자격증명 전부를 한 번에
// 검사한다(#credential-lifecycle 후속 - "일괄 처리") - 무효로 확인된
// 것은 checkAndDestroyIfInvalid와 같은 파기 경로를 그 자리에서 탄다.
router.post(
  "/api/credentials/check-all",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    res.json(await checkAllCredentials(req.userId!));
  }),
);

router.delete(
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

router.get(
  "/api/git/oauth/github/configured",
  asyncRoute(async (_req, res) => {
    res.json({ configured: isGithubOAuthConfigured() });
  }),
);

router.post(
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
router.get(
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

router.get(
  "/api/credentials/:id/github/repos",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const token = await getCredentialTokenIfOwner(req.userId!, req.params.id);
    res.json(await listGithubRepos(token, Number(req.query.page ?? 1)));
  }),
);

// ---------------------------------------------------------------- 설치 전역 설정

router.get(
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
router.get(
  "/api/realtime-config",
  authenticate,
  asyncRoute(async (_req, res) => {
    res.json({ mqttWsUrl: process.env.PUBLIC_EMQX_WS_URL ?? null });
  }),
);

export default router;
