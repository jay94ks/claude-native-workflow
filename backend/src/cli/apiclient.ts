import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// concept 브랜치 tier3의 docs3 CLI와 같은 패턴 - CLI는 순수 REST
// 클라이언트다(로컬 DB/파일 직접 접근 없음, "CLI/MCP 명령어 완전성"
// 원칙). 토큰은 홈 디렉터리에 저장(권한 600).

const CREDENTIALS_DIR = path.join(os.homedir(), ".claude-native-workflow");
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, "credentials.json");

interface StoredCredentials {
  api_base: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string; // docs auth use-key로 저장 - 있으면 access_token보다 우선
}

export function loadCredentials(): StoredCredentials | null {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveCredentials(creds: StoredCredentials): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.chmodSync(CREDENTIALS_PATH, 0o600);
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_PATH);
  } catch {
    // 이미 없으면 조용히 무시
  }
}

export const credentialsPath = CREDENTIALS_PATH;

async function apiFetch(pathSuffix: string, init?: RequestInit): Promise<Response> {
  const creds = loadCredentials();
  const apiBase = process.env.CNW_API_BASE ?? creds?.api_base;
  if (!apiBase) {
    throw new Error("API 주소를 모릅니다 - 먼저 `docs login --api <서버 주소> ...`로 로그인하세요");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> ?? {}) };
  const token = creds?.api_key ?? creds?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${apiBase}${pathSuffix}`, { ...init, headers });
}

export async function apiCall<T>(pathSuffix: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(pathSuffix, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// git diff처럼 응답이 JSON이 아니라 순수 텍스트(unified diff)인 엔드포인트용.
export async function apiCallText(pathSuffix: string, init?: RequestInit): Promise<string> {
  const res = await apiFetch(pathSuffix, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.text();
}

// core/messages.ts의 MESSAGE_WAIT_POLL_MAX_SEC과 같은 값이어야 한다 -
// CLI/MCP는 core를 직접 import 못 해(REST만 호출하는 순수 클라이언트
// 원칙) 여기 별도로 선언한다. 서버가 어차피 이 이상은 잘라내지만,
// 클라이언트가 처음부터 그 상한 이하로만 요청해야 폴링 간격이
// 의도한 대로(짧고 일정하게) 유지된다.
const MESSAGE_WAIT_POLL_INTERVAL_SEC = 10;

// 폴링 루프 자체가 무한정 돌지 않도록 하는 바깥쪽 상한(1시간) - 각
// 폴은 항상 짧게 끝나 서버 자원 문제는 아니지만, 실수로 아주 큰
// timeoutSec을 넘겼을 때 CLI/MCP 프로세스가 하염없이 반복 호출하는
// 것을 막는 안전장치.
const MESSAGE_WAIT_TOTAL_MAX_SEC = 3600;

export interface MessageWaitResult {
  timedOut: boolean;
  message: unknown;
}

/** `message wait`의 서버 쪽 단일 호출은 MESSAGE_WAIT_POLL_MAX_SEC로
 * 짧게 제한돼 있다(긴 커넥션을 하나 붙들지 않기 위해) - 사용자가
 * 요청한 전체 대기 시간(totalTimeoutSec)은 이 짧은 폴을 반복 호출해
 * 흉내낸다. 메시지가 오면 그 폴 안에서 바로 잡혀 즉시 반환되므로
 * 실시간성은 유지된다. */
export async function waitForMessagePolling(projectId: string, totalTimeoutSec: number): Promise<MessageWaitResult> {
  const clampedTotal = Math.min(Math.max(Math.trunc(totalTimeoutSec) || 1, 1), MESSAGE_WAIT_TOTAL_MAX_SEC);
  const deadline = Date.now() + clampedTotal * 1000;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { timedOut: true, message: null };
    const pollSec = Math.min(MESSAGE_WAIT_POLL_INTERVAL_SEC, Math.max(1, Math.ceil(remainingMs / 1000)));
    const result = await apiCall<MessageWaitResult>(`/api/projects/${projectId}/messages/wait?timeout=${pollSec}`);
    if (!result.timedOut) return result;
  }
}
