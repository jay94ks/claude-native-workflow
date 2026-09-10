// backend REST API를 호출하는 fetch 래퍼 - 같은 오리진의 /api/...를
// 호출하므로(vite.config.ts 프록시 or 프로덕션 정적 서빙) base URL
// 설정이 따로 필요 없다. CLI의 파일 기반 자격증명(~/.claude-native-
// workflow/credentials.json)과는 별개로, 브라우저 세션은 토큰을
// localStorage에 둔다.

const ACCESS_TOKEN_KEY = "cnw_access_token";
const REFRESH_TOKEN_KEY = "cnw_refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}

async function rawFetch(pathSuffix: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`/api${pathSuffix}`, { ...init, headers });
}

/** access 토큰(15분 단명)이 만료돼 401이 오면 refresh 토큰으로 한 번
 * 갱신을 시도한 뒤 원래 요청을 재시도한다. */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  setTokens(body.access_token, body.refresh_token);
  return true;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 세션이 만료됐을 때(refresh도 실패) 각 화면이 "Authorization 헤더가
// 필요합니다" 같은 날것의 백엔드 에러를 표시한 채 인증된 화면 뼈대에
// 갇혀 있지 않도록, 여기서 한 곳에서만 로그인 화면으로 보낸다 - 화면마다
// 이 처리를 반복하지 않게(실제로 이 리다이렉트가 어디서도 구현돼 있지
// 않아 세션 만료 시 고장난 화면에 머무는 문제를 실측 중 발견해서 고침).
function redirectToLogin(): void {
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

async function callWithRefresh(pathSuffix: string, init: RequestInit): Promise<Response> {
  let res = await rawFetch(pathSuffix, init);
  if (res.status === 401 && getAccessToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await rawFetch(pathSuffix, init);
    } else {
      clearTokens();
      redirectToLogin();
    }
  }
  return res;
}

export async function apiCall<T>(pathSuffix: string, init: RequestInit = {}): Promise<T> {
  const res = await callWithRefresh(pathSuffix, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// git/diff/:sha처럼 text/plain을 반환하는 엔드포인트용(unified diff 텍스트
// - JSON이 아니므로 apiCall의 res.json()을 타면 안 됨). CLI의
// apiclient.ts apiCallText와 같은 이유.
export async function apiCallText(pathSuffix: string, init: RequestInit = {}): Promise<string> {
  const res = await callWithRefresh(pathSuffix, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.text();
}
