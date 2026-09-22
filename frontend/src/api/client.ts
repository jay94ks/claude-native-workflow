// 설계자 지시(2026-09-21): "/api/actions 단일 엔드포인트"는 CLI/MCP를 위한
// 설계였지, WEB UI까지 그리로 몰 필요는 없다 - 오히려 한곳에 몰면 화면마다
// 필요한 요청을 다 같은 모양(POST + action 문자열)으로 보내야 해서 비효율
// 적이다. 그래서 WEB UI는 액션별 REST 엔드포인트(backend/src/api/rest.ts)
// 를 각자의 HTTP 메서드/경로로 직접 호출한다 - `X-Cnw-Channel` 헤더를 안
// 보내 architect로 식별되는 것은 이전과 동일.

import { Notify } from "quasar";

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  reason?: string[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function login(username: string, password: string): Promise<{ architectId: string; apiKey: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res), res.status);
  return res.json();
}

// docs/plan-account-management.md 작업 중 발견 - /api/auth/*는 항상
// `{error: "..."}` JSON을 응답하는데(auth.ts), login()이 지금까지
// res.text()로 그 원문(raw JSON 문자열)을 그대로 에러 메시지로 써서
// LoginPage.vue 화면에 `{"error":"..."}`가 그대로 노출되고 있었다 -
// disabledAt 도입으로 새로 생긴 "this account has been disabled" 메시지가
// 실제로 읽을 수 있게 보이려면 이 파싱을 고쳐야 했다.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // JSON이 아니면 아래 기본 메시지로 폴백.
  }
  return `요청이 실패했습니다 (${res.status})`;
}

export async function signup(username: string, password: string): Promise<{ architectId: string }> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res), res.status);
  return res.json();
}

// design-notes.md "메시지 시스템": notices는 예외 없이 모든 액션 응답에
// 피기백되어 온다 - REST에서는 응답 바디 모양을 순수하게 유지하려고
// `X-Cnw-Notices` 헤더(JSON을 base64로 인코딩)로 대신 싣는다.
//
// 버그(2026-09-22 발견) - `atob()`는 base64를 "바이트 하나당 문자 하나"인
// 바이너리 문자열로만 디코딩한다(브라우저 표준 동작 그대로, 버그 아님) -
// 한글처럼 UTF-8에서 한 글자가 여러 바이트인 경우 그 바이트들을 그대로
// UTF-16 코드유닛으로 취급해버려 항상 깨진 글자(mojibake)가 됐다.
// 백엔드(`api/rest.ts`)는 이미 `Buffer.from(json, "utf-8").toString("base64")`
// 로 올바르게 인코딩하고 있었으니, 프론트 쪽 디코딩만 그 바이트를 실제로
// UTF-8로 해석하도록 고치면 된다.
function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function surfaceNoticesFromHeader(res: Response): void {
  const header = res.headers.get("X-Cnw-Notices");
  if (!header) return;
  try {
    const notices = JSON.parse(decodeBase64Utf8(header)) as unknown[];
    for (const notice of notices) {
      Notify.create({ type: "info", message: String(notice), position: "top-right", timeout: 6000 });
    }
  } catch {
    // notices 파싱 실패는 부가 기능 손실일 뿐 - 본 요청 결과에 영향 주지 않는다.
  }
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

interface RequestOptions {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * 모든 REST 호출이 거치는 공용 지점 - fetch + apiKey 헤더 + notices 처리 +
 * 성공/실패를 기존 액션 방식과 동일한 `{ok, data}`/`{ok:false, reason}`
 * 모양으로 맞춰서(컴포넌트 쪽 `if (!result.ok) ...` 코드를 그대로 재사용
 *할 수 있게) 돌려준다.
 */
async function request<T = unknown>(apiKey: string, path: string, opts: RequestOptions = {}): Promise<ActionResult<T>> {
  const res = await fetch(`/api${path}${buildQuery(opts.query)}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  surfaceNoticesFromHeader(res);

  if (!res.ok) {
    let reason: string[] = [`요청이 실패했습니다 (${res.status})`];
    try {
      const errBody = await res.json();
      if (Array.isArray(errBody?.error)) reason = errBody.error;
      else if (typeof errBody?.error === "string") reason = [errBody.error];
    } catch {
      // 본문이 JSON이 아니면 기본 메시지를 유지한다.
    }
    return { ok: false, reason };
  }

  if (res.status === 204) return { ok: true, data: undefined as T };
  const data = (await res.json()) as T;
  return { ok: true, data };
}

// ---- Projects ----
export const listProjects = (apiKey: string, params?: { page?: number }) => request(apiKey, "/projects", { query: params });
export const createProject = (apiKey: string, body: { id: string; name: string; description?: string; visibility?: "PUBLIC" | "PRIVATE" }) =>
  request(apiKey, "/projects", { method: "POST", body });
export const listMyInvites = (apiKey: string) => request(apiKey, "/projects/invites-for-me");
export const getProject = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}`);
export const updateProject = (apiKey: string, owner: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}`, { method: "PATCH", body });
export const destroyProject = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}`, { method: "DELETE" });
export const getProjectMembers = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/members`);
export const inviteToProject = (apiKey: string, owner: string, projectId: string, body: { username: string; role: "READ" | "WRITE" }) =>
  request(apiKey, `/projects/${owner}/${projectId}/invite`, { method: "POST", body });
export const acceptInvite = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/accept-invite`, { method: "POST" });
export const transferProject = (apiKey: string, owner: string, projectId: string, body: { toUsername: string }) =>
  request(apiKey, `/projects/${owner}/${projectId}/transfer`, { method: "POST", body });
export const transferProjectOwnership = (apiKey: string, owner: string, projectId: string, body: { toUsername: string }) =>
  request(apiKey, `/projects/${owner}/${projectId}/transfer-ownership`, { method: "POST", body });

// ---- Documents ----
export const listDocuments = (
  apiKey: string,
  owner: string,
  projectId: string,
  params?: { type?: string; kind?: string; state?: string; parentId?: string; page?: number; sort?: string }
) => request(apiKey, `/projects/${owner}/${projectId}/documents`, { query: params });
export const createDocument = (apiKey: string, owner: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents`, { method: "POST", body });
export const searchDocuments = (apiKey: string, owner: string, projectId: string, params: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents/search`, { query: params });
export const getDocsStatus = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/documents/status`);
export const grepDocument = (apiKey: string, owner: string, projectId: string, code: string, pattern: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents/grep`, { query: { code, pattern } });
export const getDocument = (apiKey: string, owner: string, projectId: string, code: string) => request(apiKey, `/projects/${owner}/${projectId}/documents/${code}`);
export const updateDocument = (apiKey: string, owner: string, projectId: string, code: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents/${code}`, { method: "PATCH", body });
export const deleteDocument = (apiKey: string, owner: string, projectId: string, code: string, body: { etag: string }) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents/${code}`, { method: "DELETE", body });
export const transitionDocument = (apiKey: string, owner: string, projectId: string, code: string, to: string, from: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/documents/${code}/transition`, { method: "POST", body: { to, from } });
export const tagDocument = (
  apiKey: string,
  owner: string,
  projectId: string,
  code: string,
  body: { etag: string; related?: { code: string; etag: string }[]; dependsOn?: { code: string; etag: string }[] }
) => request(apiKey, `/projects/${owner}/${projectId}/documents/${code}/tag`, { method: "POST", body });

// ---- Repo (Code 탭) ----
export const listBranches = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/repo/branches`);
export const listTree = (apiKey: string, owner: string, projectId: string, branch: string, path: string, commitId?: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/tree`, { query: { branch, path, commitId } });
export const readRepoFile = (apiKey: string, owner: string, projectId: string, branch: string, path: string, commitId?: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/file`, { query: { branch, path, commitId } });
export const writeRepoFile = (
  apiKey: string,
  owner: string,
  projectId: string,
  body: { branch: string; path: string; content: string; message?: string }
) => request(apiKey, `/projects/${owner}/${projectId}/repo/file`, { method: "PUT", body });
export const listCommits = (apiKey: string, owner: string, projectId: string, branch: string, limit?: number) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/commits`, { query: { branch, limit } });
export const getCommitInfo = (apiKey: string, owner: string, projectId: string, commitId: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/commit-info`, { query: { commitId } });
export const getCommitDiff = (apiKey: string, owner: string, projectId: string, commitId: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/commit-diff`, { query: { commitId } });
export const getFileCommits = (apiKey: string, owner: string, projectId: string, branch: string, path: string, limit?: number) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/file-commits`, { query: { branch, path, limit } });
export const getFileDiff = (apiKey: string, owner: string, projectId: string, base: string, head: string, path: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/diff`, { query: { base, head, path } });
export const pushRepo = (apiKey: string, owner: string, projectId: string, body?: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/repo/push`, { method: "POST", body: body ?? {} });
export const connectGitea = (apiKey: string, owner: string, projectId: string) =>
  request<{ pushMirrorUrl: string }>(apiKey, `/projects/${owner}/${projectId}/repo/connect-gitea`, { method: "POST" });

// ---- Pull requests ----
export const listPullRequests = (apiKey: string, owner: string, projectId: string, state?: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/pull-requests`, { query: { state } });
export const createPullRequest = (
  apiKey: string,
  owner: string,
  projectId: string,
  body: { title: string; description?: string; sourceBranch: string; targetBranch: string }
) => request(apiKey, `/projects/${owner}/${projectId}/pull-requests`, { method: "POST", body });
export const getPullRequest = (apiKey: string, owner: string, projectId: string, id: string) => request(apiKey, `/projects/${owner}/${projectId}/pull-requests/${id}`);
export const updatePullRequest = (apiKey: string, owner: string, projectId: string, id: string, body: { title?: string; description?: string }) =>
  request(apiKey, `/projects/${owner}/${projectId}/pull-requests/${id}`, { method: "PATCH", body });
export const mergePullRequest = (apiKey: string, owner: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/pull-requests/${id}/merge`, { method: "POST" });
export const closePullRequest = (apiKey: string, owner: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/pull-requests/${id}/close`, { method: "POST" });

// ---- Messages ----
export const listMessages = (apiKey: string, owner: string, projectId: string, params?: { state?: string; page?: number }) =>
  request(apiKey, `/projects/${owner}/${projectId}/messages`, { query: params });
export const sendMessage = (apiKey: string, owner: string, projectId: string, body: { from: string; to: string; body: string; ttl?: number }) =>
  request(apiKey, `/projects/${owner}/${projectId}/messages`, { method: "POST", body });
export const transitionMessage = (apiKey: string, owner: string, projectId: string, id: string, state: "done" | "canceled") =>
  request(apiKey, `/projects/${owner}/${projectId}/messages/${id}/transition`, { method: "POST", body: { state } });

// ---- Webhooks ----
export const listWebhooks = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/webhooks`);
export const addWebhook = (apiKey: string, owner: string, projectId: string, url: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/webhooks`, { method: "POST", body: { url } });
export const deleteWebhook = (apiKey: string, owner: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/webhooks/${id}`, { method: "DELETE" });

// ---- Template (architect 계정 스코프) ----
export const getTemplate = (apiKey: string) => request(apiKey, "/template");
export const setTemplate = (apiKey: string, body: { claudeMd: string; skillMd: string }) => request(apiKey, "/template", { method: "PUT", body });
export const deployTemplate = (apiKey: string, owner: string, projectId: string) => request(apiKey, `/projects/${owner}/${projectId}/template/deploy`, { method: "POST" });

// ---- Account 관리(docs/plan-account-management.md - 시스템 전체 스코프) ----
export const listAccounts = (apiKey: string) => request(apiKey, "/accounts");
export const changeOwnPassword = (apiKey: string, body: { currentPassword: string; newPassword: string }) =>
  request(apiKey, "/account/password", { method: "PUT", body });
export const resetAccountPassword = (apiKey: string, accountId: string) =>
  request<{ username: string; temporaryPassword: string }>(apiKey, `/accounts/${accountId}/reset-password`, { method: "POST" });
export const disableAccount = (apiKey: string, accountId: string) => request(apiKey, `/accounts/${accountId}/disable`, { method: "POST" });
export const enableAccount = (apiKey: string, accountId: string) => request(apiKey, `/accounts/${accountId}/enable`, { method: "POST" });
export const deleteAccount = (apiKey: string, accountId: string) => request(apiKey, `/accounts/${accountId}`, { method: "DELETE" });
export const getMe = (apiKey: string) => request(apiKey, "/account/me");
export const updateNickname = (apiKey: string, body: { nickname: string | null }) => request(apiKey, "/account/nickname", { method: "PUT", body });

// ---- API 키(docs/plan-nickname-apikey-policy.md) ----
export const listMyApiKeys = (apiKey: string) => request(apiKey, "/api-keys");
export const createApiKey = (apiKey: string, body: { scope: "personal" | "project"; owner?: string; projectId?: string; label?: string }) =>
  request<{ key: Record<string, unknown>; secret: string }>(apiKey, "/api-keys", { method: "POST", body });
export const revokeApiKey = (apiKey: string, keyId: string) => request(apiKey, `/api-keys/${keyId}`, { method: "DELETE" });
export const listProjectApiKeys = (apiKey: string, owner: string, projectId: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/api-keys`);

// ---- Remember ----
export const listRemember = (apiKey: string, owner: string, projectId: string, params?: { category?: string; page?: number }) =>
  request(apiKey, `/projects/${owner}/${projectId}/remember`, { query: params });
export const addRemember = (apiKey: string, owner: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/remember`, { method: "POST", body });
export const updateRemember = (apiKey: string, owner: string, projectId: string, id: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${owner}/${projectId}/remember/${id}`, { method: "PATCH", body });
export const deleteRemember = (apiKey: string, owner: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${owner}/${projectId}/remember/${id}`, { method: "DELETE" });
