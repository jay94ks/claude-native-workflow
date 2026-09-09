// tier2/dashboard의 api.ts(configureApi로 basePath/authToken을 주입)가
// 문서 조회/편집 쪽을 담당하고, 여기는 tier2에 없는 Tier 3 전용 API만
// (인증/프로젝트/멤버십, SP-00002 2·4절) 다룬다.

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface Project {
  id: string;
  name: string;
  gitRepoUrl: string;
  createdAt: string;
  role: string;
}

export interface Member {
  id: string;
  username: string;
  email: string;
  role: string;
  joined_at: string;
}

async function raw<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const auth3 = {
  login: (usernameOrEmail: string, password: string) =>
    raw<AuthTokens>("/auth/login", { method: "POST", body: JSON.stringify({ username_or_email: usernameOrEmail, password }) }),
  register: (username: string, email: string, password: string) =>
    raw<{ id: string; username: string; email: string }>("/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) }),
  refresh: (refreshToken: string) =>
    raw<AuthTokens>("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }),
  logout: (refreshToken: string) =>
    raw<{ ok: true }>("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }),
};

export function projects3(token: string) {
  return {
    list: () => raw<Project[]>("/projects", undefined, token),
    create: (name: string, gitRepoUrl: string) =>
      raw<Project>("/projects", { method: "POST", body: JSON.stringify({ name, git_repo_url: gitRepoUrl }) }, token),
    members: (projectId: string) => raw<Member[]>(`/projects/${projectId}/members`, undefined, token),
    invite: (projectId: string, email: string, role: string) =>
      raw<unknown>(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ email, role }) }, token),
    updateRole: (projectId: string, userId: string, role: string) =>
      raw<unknown>(`/projects/${projectId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }, token),
    removeMember: (projectId: string, userId: string) =>
      raw<{ ok: true }>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }, token),
  };
}
