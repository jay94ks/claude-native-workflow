// SP-00003 2절 공통 API를 그대로 호출하는 얇은 클라이언트. dev 서버는
// vite.config.ts의 프록시로 /api를 backend(기본 8766)에 넘긴다.
//
// basePath/authToken은 tier3/dashboard가 이 파일을 그대로(수정 없이)
// 재사용하기 위한 것 - SP-00002 8절 "커밋 이력/diff/blame/코멘트 자체는
// 등급 공통... 화면 자체는 SP-00001과 동일"이라, 문서 조회/편집 화면을
// tier3용으로 새로 만드는 대신 이 클라이언트 + tier2/dashboard의 Vue
// 컴포넌트를 그대로 가져다 쓰고 basePath만 `/api/projects/:id`로,
// authToken만 로그인 토큰으로 바꿔 끼운다. 기본값은 tier2 자신의 기존
// 동작(basePath "/api", 토큰 없음)과 완전히 같아서 tier2/dashboard
// 자체는 아무것도 안 바뀐다.
let basePath = "/api";
let authToken: string | undefined;

export function configureApi(opts: { basePath?: string; authToken?: string }): void {
  if (opts.basePath !== undefined) basePath = opts.basePath;
  if (opts.authToken !== undefined) authToken = opts.authToken;
}

export interface DocMeta {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  created?: string;
  updated?: string;
  links?: string[];
  reply_pending?: boolean;
  target?: string;
  [key: string]: unknown;
}

export interface TreeNode {
  name: string;
  type: "dir" | "file";
  children?: TreeNode[];
  path?: string;
  id?: string;
  title?: string;
  doc_type?: string;
  status?: string;
  reply_pending?: boolean;
}

export interface PendingOption {
  kind: "권장" | "대안";
  text: string;
}

export interface PendingItem {
  doc_path: string;
  doc_id: string;
  title: string;
  question_id: string;
  question: string;
  options: PendingOption[];
  updated: string;
}

export interface DocListItem {
  path: string;
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
  reply_pending: boolean;
  target: string;
}

export interface DocDetail {
  path: string;
  meta: DocMeta;
  body: string;
}

export interface SearchResult {
  path: string;
  id: string;
  title: string;
  type: string;
  snippet: string;
}

export interface Violation {
  path: string;
  field: string;
  rule: string;
  message: string;
}

export interface CommitSummary {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface Comment {
  id: number;
  doc_path: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

export interface ChangeNotice {
  id: number;
  doc_path: string;
  source: string;
  summary: string;
  ref: string | null;
  created_at: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiText(path: string): Promise<string> {
  const res = await fetch(`${basePath}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export const client = {
  tree: () => api<TreeNode>("/tree"),
  pending: () => api<PendingItem[]>("/pending"),
  design: () => api<DocListItem[]>("/design"),
  logs: () => api<DocListItem[]>("/logs"),
  all: () => api<DocListItem[]>("/all"),
  search: (q: string) => api<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
  validate: () => api<Violation[]>("/validate"),
  doc: (path: string, anchor?: string) =>
    api<DocDetail>(`/doc?path=${encodeURIComponent(path)}${anchor ? `&anchor=${encodeURIComponent(anchor)}` : ""}`),
  saveDoc: (path: string, body: string) =>
    api<{ path: string; updated: string }>("/doc/save", { method: "POST", body: JSON.stringify({ path, body }) }),
  createDoc: (type: string, title: string, links?: string[]) =>
    api<{ id: string; path: string }>("/docs", { method: "POST", body: JSON.stringify({ type, title, links }) }),
  reply: (path: string, questionId: string, answer: string) =>
    api<{ rp_id: string; lg_id: string; reply_pending: boolean }>(`/docs/${path}/reply`, {
      method: "POST", body: JSON.stringify({ question_id: questionId, answer }),
    }),
  transitionDone: (planId: string, report: string) =>
    api<{ dn_id: string; dn_path: string; pl_path: string }>(`/plan/${planId}/transition-done`, {
      method: "POST", body: JSON.stringify({ report }),
    }),

  gitLog: (path?: string, limit = 30) =>
    api<CommitSummary[]>(`/git/log?limit=${limit}${path ? `&path=${encodeURIComponent(path)}` : ""}`),
  gitDiff: (sha: string) => apiText(`/git/diff/${sha}`),
  gitBlame: (path: string) => apiText(`/git/blame?path=${encodeURIComponent(path)}`),
  gitCommit: (sha: string) => api<CommitSummary & { files: string[] }>(`/git/commits/${sha}`),

  comments: (path: string) => api<Comment[]>(`/docs/${path}/comments`),
  addComment: (path: string, body: string) =>
    api<{ id: number }>(`/docs/${path}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  resolveComment: (path: string, id: number) =>
    api<{ ok: true }>(`/docs/${path}/comments/${id}/resolve`, { method: "POST" }),

  changes: () => api<ChangeNotice[]>("/changes"),
  ackChange: (id: number) => api<{ ok: true }>(`/changes/${id}/ack`, { method: "POST" }),

  gitPull: () => api<{ attempted: boolean; ok: boolean; conflict: boolean; message: string }>("/git/pull", { method: "POST" }),
  gitPush: () => api<{ attempted: boolean; pushed: boolean; message: string }>("/git/push", { method: "POST" }),
  gitSync: (message?: string) =>
    api<{ pull: unknown; commit?: unknown; push?: unknown }>("/git/sync", { method: "POST", body: JSON.stringify({ message }) }),
};

export const TYPE_NAMES: Record<string, string> = {
  IX: "최상위 색인", SP: "설계 명세", PL: "실행 계획", DN: "결과 보고",
  DS: "설계", RM: "기억 지시", TP: "임시 문서", DC: "결정 요청",
  RV: "검토 요청", FX: "수정 검토", LG: "처리 기록", RP: "답변 항목",
};
