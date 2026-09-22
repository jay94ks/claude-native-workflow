// design-notes.md "GitHub OAuth 연결(push-mirror)" - v2에 있던 "GitHub
// 로그인"은 claude-native-workflow 자체 로그인의 대체 수단이 아니라
// 이미 로그인한 architect가 자기 GitHub 계정을 연결해 저장소를 고르는
// 기능이었다("깃허브 로그인 + 저장소 선택" 흐름) - v3는 그 부분만
// 가져오고, 고른 저장소의 clone URL은 Gitea 자동 연결과 똑같이
// Project.pushMirrorUrl에 넣는다(v2의 mirror/work 이원화+웹훅 자동
// 등록 같은 무거운 구조는 대상 밖).

import * as crypto from "crypto";
import { prisma } from "./prisma";
import type { ActionContext } from "./documents";
import type { ActionResult } from "./types";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** GITHUB_OAUTH_CLIENT_ID/SECRET 둘 다 없으면 이 기능 자체가 미설정(gitea.ts의 config()와 동일한 판단). */
export function githubOAuthConfig(): GithubOAuthConfig | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function githubStatus(_payload: any, ctx: ActionContext): Promise<ActionResult> {
  if (!githubOAuthConfig()) return { ok: true, data: { configured: false, connected: false } };
  const cred = await prisma.githubCredential.findUnique({ where: { accountId: ctx.architectId } });
  return { ok: true, data: { configured: true, connected: !!cred, githubLogin: cred?.githubLogin ?? null } };
}

// v2와 동일한 판단: state는 메모리 Map에 10분 TTL로만 둔다(이 백엔드는
// 이미 여러 곳에서 단일 프로세스를 가정한다 - EMQX 구독자 등). redirect_uri
// 도 함께 저장해서, 토큰 교환 요청이 authorize 때와 정확히 같은 값을
// 쓰도록 한다(GitHub가 이 둘의 불일치를 거부할 수 있음).
interface PendingOAuthState {
  architectId: string;
  redirectUri: string;
  expiresAt: number;
}
const pendingStates = new Map<string, PendingOAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt <= now) pendingStates.delete(state);
  }
}

export async function githubOAuthStart(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const cfg = githubOAuthConfig();
  if (!cfg) return fail("GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET이 설정돼 있지 않아 이 서버는 GitHub 연동을 쓸 수 없습니다.");

  const { redirectBase } = payload;
  if (typeof redirectBase !== "string" || !redirectBase) return fail("redirectBase가 필요합니다.");

  cleanupExpiredStates();
  const state = crypto.randomBytes(32).toString("hex");
  const redirectUri = `${redirectBase.replace(/\/+$/, "")}/api/github/oauth/callback`;
  pendingStates.set(state, { architectId: ctx.architectId, redirectUri, expiresAt: Date.now() + STATE_TTL_MS });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", cfg.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set("state", state);

  return { ok: true, data: { authorizeUrl: authorizeUrl.toString() } };
}

/**
 * 액션 시스템 밖의 원시 라우트(`GET /api/github/oauth/callback`,
 * server.ts에 직접 등록) - GitHub가 브라우저를 이 주소로 그대로
 * 리다이렉트하므로 Authorization 헤더를 실을 수 없다. state로
 * 본인(architectId)을 확인한다.
 */
export async function completeGithubOAuthCallback(code: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = githubOAuthConfig();
  if (!cfg) return { ok: false, error: "GitHub 연동이 설정돼 있지 않습니다." };

  cleanupExpiredStates();
  const pending = pendingStates.get(state);
  if (!pending) return { ok: false, error: "요청이 만료됐거나 유효하지 않습니다 - 다시 시도하세요." };
  pendingStates.delete(state); // 1회용

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: pending.redirectUri,
    }),
  });
  if (!tokenRes.ok) return { ok: false, error: `GitHub 토큰 교환 실패: HTTP ${tokenRes.status}` };
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenJson.access_token) return { ok: false, error: tokenJson.error_description ?? tokenJson.error ?? "GitHub 토큰 교환 실패" };

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${tokenJson.access_token}`, Accept: "application/vnd.github+json" },
  });
  const githubLogin = userRes.ok ? ((await userRes.json()) as { login?: string }).login ?? null : null;

  await prisma.githubCredential.upsert({
    where: { accountId: pending.architectId },
    create: { accountId: pending.architectId, accessToken: tokenJson.access_token, githubLogin },
    update: { accessToken: tokenJson.access_token, githubLogin },
  });

  return { ok: true };
}

interface GithubRepoSummary {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

export async function githubListRepos(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const cred = await prisma.githubCredential.findUnique({ where: { accountId: ctx.architectId } });
  if (!cred) return fail("먼저 GitHub 계정을 연결하세요.");

  const page = typeof payload?.page === "number" && payload.page > 0 ? Math.floor(payload.page) : 1;
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=50&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: { Authorization: `token ${cred.accessToken}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) {
    if (res.status === 401) return fail("GitHub 연결이 만료됐거나 취소됐습니다 - 다시 연결하세요.");
    return fail(`GitHub API 오류: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { full_name: string; clone_url: string; private: boolean; default_branch: string }[];
  const items: GithubRepoSummary[] = json.map((r) => ({
    fullName: r.full_name,
    cloneUrl: r.clone_url,
    private: r.private,
    defaultBranch: r.default_branch,
  }));
  return { ok: true, data: { items, hasMore: items.length === 50 } };
}
