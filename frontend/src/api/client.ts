// design-notes.md "역할(채널) 판별": WEB UI는 X-Cnw-Channel 헤더를
// 보내지 않는다(그래서 백엔드가 architect로 간주한다) - shared/apiclient.ts
// (CLI/MCP 전용, 항상 agent 헤더를 싣는다)를 그대로 쓰면 이 구분이
// 깨지므로, frontend는 그것과 무관한 자기만의 클라이언트를 둔다.

export interface Action {
  action: string;
  [key: string]: unknown;
}

export interface ActionResult {
  ok: boolean;
  data?: unknown;
  reason?: string[];
}

export interface Envelope {
  notices: unknown[];
  status: string;
  result: ActionResult[];
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

export async function runActions(apiKey: string, actions: Action[]): Promise<Envelope> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(actions),
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

/** 편의 함수 - 액션 하나만 보내고 그 결과 하나만 돌려받는다. */
export async function runAction(apiKey: string, action: Action): Promise<ActionResult> {
  const { result } = await runActions(apiKey, [action]);
  return result[0];
}
