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
