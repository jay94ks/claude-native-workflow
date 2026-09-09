import { loadCredentials, saveCredentials } from "./credentials.js";

// SP-00002 2절의 "얇은 REST 클라이언트" - 저장된 access token으로 호출하고,
// 401을 받으면 refresh token으로 한 번 갱신을 시도한 뒤 재시도한다(회전된
// 새 refresh token도 같이 저장 - core/auth.ts의 refresh()가 매번 새로
// 발급하므로 갱신 안 하면 다음 401 때 이미 폐기된 토큰을 쓰게 됨).

class ApiError extends Error {}

async function doFetch(base: string, path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

export async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = loadCredentials();
  if (!creds) throw new ApiError("로그인이 필요합니다: docs3 login --api <url> --username <u> --password <p>");

  let res = await doFetch(creds.api_base, path, creds.access_token, init);
  if (res.status === 401) {
    const refreshRes = await fetch(`${creds.api_base}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    if (!refreshRes.ok) {
      throw new ApiError("세션이 만료됐습니다: docs3 login으로 다시 로그인하세요");
    }
    const rotated = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    saveCredentials({ ...creds, access_token: rotated.access_token, refresh_token: rotated.refresh_token });
    res = await doFetch(creds.api_base, path, rotated.access_token, init);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
