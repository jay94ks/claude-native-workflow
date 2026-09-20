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
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export async function signup(username: string, password: string): Promise<{ architectId: string }> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

// design-notes.md "메시지 시스템": notices는 예외 없이 모든 액션 응답에
// 피기백되어 온다 - REST에서는 응답 바디 모양을 순수하게 유지하려고
// `X-Cnw-Notices` 헤더(JSON을 base64로 인코딩)로 대신 싣는다.
function surfaceNoticesFromHeader(res: Response): void {
  const header = res.headers.get("X-Cnw-Notices");
  if (!header) return;
  try {
    const notices = JSON.parse(atob(header)) as unknown[];
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
export const createProject = (apiKey: string, body: { name: string; description?: string; visibility?: "PUBLIC" | "PRIVATE" }) =>
  request(apiKey, "/projects", { method: "POST", body });
export const listMyInvites = (apiKey: string) => request(apiKey, "/projects/invites-for-me");
export const getProject = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}`);
export const updateProject = (apiKey: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}`, { method: "PATCH", body });
export const destroyProject = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}`, { method: "DELETE" });
export const getProjectMembers = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/members`);
export const inviteToProject = (apiKey: string, projectId: string, body: { username: string; role: "READ" | "WRITE" }) =>
  request(apiKey, `/projects/${projectId}/invite`, { method: "POST", body });
export const acceptInvite = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/accept-invite`, { method: "POST" });
export const transferProject = (apiKey: string, projectId: string, body: { toUsername: string }) =>
  request(apiKey, `/projects/${projectId}/transfer`, { method: "POST", body });

// ---- Documents ----
export const listDocuments = (
  apiKey: string,
  projectId: string,
  params?: { type?: string; kind?: string; state?: string; parentId?: string; page?: number; sort?: string }
) => request(apiKey, `/projects/${projectId}/documents`, { query: params });
export const createDocument = (apiKey: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/documents`, { method: "POST", body });
export const searchDocuments = (apiKey: string, projectId: string, params: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/documents/search`, { query: params });
export const getDocsStatus = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/documents/status`);
export const grepDocument = (apiKey: string, projectId: string, code: string, pattern: string) =>
  request(apiKey, `/projects/${projectId}/documents/grep`, { query: { code, pattern } });
export const getDocument = (apiKey: string, projectId: string, code: string) => request(apiKey, `/projects/${projectId}/documents/${code}`);
export const updateDocument = (apiKey: string, projectId: string, code: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/documents/${code}`, { method: "PATCH", body });
export const deleteDocument = (apiKey: string, projectId: string, code: string, body: { etag: string }) =>
  request(apiKey, `/projects/${projectId}/documents/${code}`, { method: "DELETE", body });
export const transitionDocument = (apiKey: string, projectId: string, code: string, to: string, from: string) =>
  request(apiKey, `/projects/${projectId}/documents/${code}/transition`, { method: "POST", body: { to, from } });
export const tagDocument = (
  apiKey: string,
  projectId: string,
  code: string,
  body: { etag: string; related?: { code: string; etag: string }[]; dependsOn?: { code: string; etag: string }[] }
) => request(apiKey, `/projects/${projectId}/documents/${code}/tag`, { method: "POST", body });

// ---- Repo (Code 탭) ----
export const listBranches = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/repo/branches`);
export const listTree = (apiKey: string, projectId: string, branch: string, path: string) =>
  request(apiKey, `/projects/${projectId}/repo/tree`, { query: { branch, path } });
export const readRepoFile = (apiKey: string, projectId: string, branch: string, path: string) =>
  request(apiKey, `/projects/${projectId}/repo/file`, { query: { branch, path } });
export const writeRepoFile = (
  apiKey: string,
  projectId: string,
  body: { branch: string; path: string; content: string; message?: string }
) => request(apiKey, `/projects/${projectId}/repo/file`, { method: "PUT", body });
export const listCommits = (apiKey: string, projectId: string, branch: string, limit?: number) =>
  request(apiKey, `/projects/${projectId}/repo/commits`, { query: { branch, limit } });
export const getCommitInfo = (apiKey: string, projectId: string, commitId: string) =>
  request(apiKey, `/projects/${projectId}/repo/commit-info`, { query: { commitId } });
export const getCommitDiff = (apiKey: string, projectId: string, commitId: string) =>
  request(apiKey, `/projects/${projectId}/repo/commit-diff`, { query: { commitId } });
export const getFileCommits = (apiKey: string, projectId: string, branch: string, path: string, limit?: number) =>
  request(apiKey, `/projects/${projectId}/repo/file-commits`, { query: { branch, path, limit } });
export const getFileDiff = (apiKey: string, projectId: string, base: string, head: string, path: string) =>
  request(apiKey, `/projects/${projectId}/repo/diff`, { query: { base, head, path } });
export const pushRepo = (apiKey: string, projectId: string, body?: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/repo/push`, { method: "POST", body: body ?? {} });

// ---- Pull requests ----
export const listPullRequests = (apiKey: string, projectId: string, state?: string) =>
  request(apiKey, `/projects/${projectId}/pull-requests`, { query: { state } });
export const createPullRequest = (
  apiKey: string,
  projectId: string,
  body: { title: string; description?: string; sourceBranch: string; targetBranch: string }
) => request(apiKey, `/projects/${projectId}/pull-requests`, { method: "POST", body });
export const getPullRequest = (apiKey: string, projectId: string, id: string) => request(apiKey, `/projects/${projectId}/pull-requests/${id}`);
export const mergePullRequest = (apiKey: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${projectId}/pull-requests/${id}/merge`, { method: "POST" });
export const closePullRequest = (apiKey: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${projectId}/pull-requests/${id}/close`, { method: "POST" });

// ---- Messages ----
export const listMessages = (apiKey: string, projectId: string, params?: { state?: string; page?: number }) =>
  request(apiKey, `/projects/${projectId}/messages`, { query: params });
export const sendMessage = (apiKey: string, projectId: string, body: { from: string; to: string; body: string; ttl?: number }) =>
  request(apiKey, `/projects/${projectId}/messages`, { method: "POST", body });
export const transitionMessage = (apiKey: string, projectId: string, id: string, state: "done" | "canceled") =>
  request(apiKey, `/projects/${projectId}/messages/${id}/transition`, { method: "POST", body: { state } });

// ---- Webhooks ----
export const listWebhooks = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/webhooks`);
export const addWebhook = (apiKey: string, projectId: string, url: string) =>
  request(apiKey, `/projects/${projectId}/webhooks`, { method: "POST", body: { url } });
export const deleteWebhook = (apiKey: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${projectId}/webhooks/${id}`, { method: "DELETE" });

// ---- Template (architect 계정 스코프) ----
export const getTemplate = (apiKey: string) => request(apiKey, "/template");
export const setTemplate = (apiKey: string, body: { claudeMd: string; skillMd: string }) => request(apiKey, "/template", { method: "PUT", body });
export const deployTemplate = (apiKey: string, projectId: string) => request(apiKey, `/projects/${projectId}/template/deploy`, { method: "POST" });

// ---- Remember ----
export const listRemember = (apiKey: string, projectId: string, params?: { category?: string; page?: number }) =>
  request(apiKey, `/projects/${projectId}/remember`, { query: params });
export const addRemember = (apiKey: string, projectId: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/remember`, { method: "POST", body });
export const updateRemember = (apiKey: string, projectId: string, id: string, body: Record<string, unknown>) =>
  request(apiKey, `/projects/${projectId}/remember/${id}`, { method: "PATCH", body });
export const deleteRemember = (apiKey: string, projectId: string, id: string) =>
  request(apiKey, `/projects/${projectId}/remember/${id}`, { method: "DELETE" });
