import crypto from "node:crypto";
import { addGitCredential } from "./gitCredentials.js";

// "깃허브 로그인 + 저장소 선택" 흐름 - OAuth 콜백은 브라우저가 직접
// GitHub→이 앱으로 리다이렉트되는 top-level navigation이라(서버-서버
// 웹훅과 다름) Authorization 헤더를 실을 수 없다. 그래서 state 토큰으로
// 신원을 잠깐 기억해뒀다가 콜백에서 되찾는다 - JWT를 URL에 절대 실지
// 않는다(github.com으로의 Referer 유출 위험). 단일 설치형(수평 확장
// 없음)이라 folders.ts의 withUserFolderLock과 같은 전제로 인메모리 Map
// 하나로 충분하다(서버 재시작 시 사라져도 다시 "GitHub로 로그인"을
// 누르면 그만인 일시적 상태).

interface PendingState {
  userId: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, PendingState>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

export function isGithubOAuthConfigured(): boolean {
  return !!(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

export function startGithubOAuth(userId: string, redirectUri: string): { authorizeUrl: string } {
  if (!isGithubOAuthConfigured()) {
    throw new Error("GitHub OAuth가 설정되지 않았습니다(GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET)");
  }
  cleanupExpired();
  const state = crypto.randomBytes(32).toString("hex");
  pendingStates.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "repo",
    state,
  });
  return { authorizeUrl: `https://github.com/login/oauth/authorize?${params}` };
}

export async function completeGithubOAuth(
  code: string,
  state: string,
  redirectUri: string,
): Promise<{ userId: string; credentialId: string }> {
  cleanupExpired();
  const entry = pendingStates.get(state);
  if (!entry) throw new Error("만료되었거나 잘못된 인증 요청입니다 - 다시 시도하세요");
  pendingStates.delete(state); // 1회용 - 재사용/재생 공격 방지

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`GitHub 토큰 교환 실패: HTTP ${tokenRes.status}`);
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenJson.access_token) {
    throw new Error(`GitHub 토큰 교환 실패: ${tokenJson.error_description ?? tokenJson.error ?? "알 수 없는 오류"}`);
  }

  const cred = await addGitCredential(entry.userId, "token", tokenJson.access_token, "github.com");
  return { userId: entry.userId, credentialId: cred.id };
}

export interface GithubRepoSummary {
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

// GitHub도 총 개수를 안 줘서 다른 페이지네이션 응답(git log 등)처럼
// hasMore 하나로만 판단한다 - per_page개를 꽉 채워 받았으면 다음 페이지가
// 있을 가능성이 있다고 간주.
export async function listGithubRepos(token: string, page: number): Promise<{ items: GithubRepoSummary[]; hasMore: boolean }> {
  const perPage = 50;
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub 저장소 목록 조회 실패: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as Array<{
    full_name: string;
    html_url: string;
    clone_url: string;
    private: boolean;
    default_branch: string;
  }>;
  return {
    items: json.map((r) => ({
      fullName: r.full_name,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      private: r.private,
      defaultBranch: r.default_branch,
    })),
    hasMore: json.length === perPage,
  };
}
