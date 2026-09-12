import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import mqtt from "mqtt";

// concept 브랜치 tier3의 docs3 CLI와 같은 패턴 - CLI는 순수 REST
// 클라이언트다(로컬 DB/파일 직접 접근 없음, "CLI/MCP 명령어 완전성"
// 원칙). 토큰은 홈 디렉터리에 저장(권한 600).
// waitForMessageDirect()만 이 원칙의 의도적 예외 - 자격증명은 REST로
// 받아오지만 실제 대기는 EMQX에 직접 구독한다(설계자 지시 -
// #message-wait-mqtt-direct, 아래 함수 docstring 참고).

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

/** process.cwd()(CLI/MCP를 실행한 실제 로컬 git clone)가 실제 git
 * 저장소면 그 현재 체크아웃 브랜치명을 반환한다 - 상태 파일이나
 * "switch branch" 명령 없이, 매 호출마다 라이브로 실측한다(설계자
 * 지시 - "로컬 git 저장소에서 자동 감지"). git 미설치/저장소 아님/
 * detached HEAD(git이 문자열 그대로 "HEAD"를 반환)는 전부 null로
 * fail-soft한다 - 이 값은 항상 명시적 --branch가 없을 때만 쓰이므로
 * 감지가 실패해도 절대 throw하지 않고 "브랜치 필터 없음"으로 자연스럽게
 * 떨어진다. */
export function detectCurrentGitBranch(cwd: string = process.cwd()): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    return !out || out === "HEAD" ? null : out;
  } catch {
    return null;
  }
}

// access_token(15분 단명)을 refresh_token으로 갱신 - frontend의
// api/client.ts와 같은 패턴. api_key(`auth use-key`) 로그인은 만료
// 개념이 아예 다르므로(TTL 기반, 여기서 다루지 않음) 대상에서 제외.
async function refreshAccessToken(apiBase: string, creds: StoredCredentials): Promise<boolean> {
  if (!creds.refresh_token) return false;
  try {
    const res = await fetch(`${apiBase}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    saveCredentials({ ...creds, access_token: body.access_token, refresh_token: body.refresh_token });
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(pathSuffix: string, init?: RequestInit): Promise<Response> {
  const creds = loadCredentials();
  const apiBase = process.env.CNW_API_BASE ?? creds?.api_base;
  if (!apiBase) {
    throw new Error("API 주소를 모릅니다 - 먼저 `docs login --api <서버 주소> ...`로 로그인하세요");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> ?? {}) };
  const token = creds?.api_key ?? creds?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${pathSuffix}`, { ...init, headers });
  if (res.status === 401 && creds?.access_token && creds.refresh_token && !creds.api_key) {
    // access_token이 만료됐을 가능성 - refresh_token으로 한 번 갱신
    // 시도한 뒤 원래 요청을 재시도한다(CLI/MCP는 이 파일 하나를
    // 공유하므로 두 표면 모두 여기서 한 번에 고쳐진다). 이전엔
    // refresh_token을 저장만 해두고 실제로는 한 번도 쓰지 않아, 15분
    // 넘게 이어지는 세션이면 매번 재로그인이 필요했다(이번 QA 라운드
    // 중 실제로 겪어 발견).
    if (await refreshAccessToken(apiBase, creds)) {
      const retried = loadCredentials();
      const retryHeaders = { ...headers, Authorization: `Bearer ${retried?.access_token}` };
      return fetch(`${apiBase}${pathSuffix}`, { ...init, headers: retryHeaders });
    }
  }
  return res;
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

/** `message wait`의 서버 쪽 단일 호출(HTTP 폴백 경로)은
 * MESSAGE_WAIT_POLL_MAX_SEC로 짧게 제한돼 있다(긴 커넥션을 하나 붙들지
 * 않기 위해) - 사용자가 요청한 전체 대기 시간(totalTimeoutSec)은 이
 * 짧은 폴을 반복 호출해 흉내낸다. 메시지가 오면 그 폴 안에서 바로
 * 잡혀 즉시 반환되므로 실시간성은 유지된다. waitForMessageDirect()가
 * MQTT 직접 구독을 못 쓸 때(PUBLIC_EMQX_MQTT_URL 미설정, 연결 실패
 * 등) 쓰는 폴백 경로 - 그 자체로도 완결된 기능이라 그대로 둔다. */
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

interface MqttCredentials {
  mqttUrl: string | null;
  username: string | null;
  password: string | null;
}

async function getMqttCredentials(): Promise<MqttCredentials> {
  return apiCall<MqttCredentials>("/api/auth/me/mqtt-credentials");
}

interface MessagePublishEvent {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

/** message wait의 기본 경로 - "CLI/MCP는 REST만 호출하는 순수
 * 클라이언트" 원칙(이 파일 상단 주석)의 의도적 예외다(설계자 지시 -
 * 백엔드가 message wait을 대신 구독하며 오래 블로킹하지 않도록,
 * CLI/MCP가 전용 MQTT 계정으로 EMQX를 직접 구독해 기다린다). 자격
 * 증명 자체는 여전히 REST(GET /api/auth/me/mqtt-credentials)로만
 * 받아온다 - core를 직접 부르는 게 아니라 EMQX와의 실시간 통신
 * 하나만 REST 밖으로 나간다.
 *
 * PUBLIC_EMQX_MQTT_URL이 서버에 설정 안 돼 있거나(로컬 최소 구성 등)
 * 실제 연결/구독이 실패하면(방화벽 등, 서버는 설정돼 있다고 응답했지만
 * 이 클라이언트에서 도달이 안 되는 경우) waitForMessagePolling(기존
 * HTTP 반복 폴)으로 그대로 폴백한다 - fail-soft, 이 경로가 아예 안
 * 되는 게 아니라 덜 효율적인 방식으로 계속 동작한다. */
export async function waitForMessageDirect(projectId: string, totalTimeoutSec: number): Promise<MessageWaitResult> {
  const clampedTotal = Math.min(Math.max(Math.trunc(totalTimeoutSec) || 1, 1), MESSAGE_WAIT_TOTAL_MAX_SEC);
  const creds = await getMqttCredentials().catch(() => ({ mqttUrl: null, username: null, password: null }) as MqttCredentials);
  if (!creds.mqttUrl || !creds.username || !creds.password) {
    return waitForMessagePolling(projectId, clampedTotal);
  }

  const topic = `project/${projectId}/messages`;
  const mqttUrl = creds.mqttUrl;
  const username = creds.username;
  const password = creds.password;

  return new Promise<MessageWaitResult>((resolve) => {
    let settled = false;
    const client = mqtt.connect(mqttUrl, { username, password, connectTimeout: 10_000 });

    const finishViaPolling = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      waitForMessagePolling(projectId, clampedTotal).then(resolve);
    };
    const finish = (r: MessageWaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      resolve(r);
    };

    const timer = setTimeout(() => finish({ timedOut: true, message: null }), clampedTotal * 1000);

    client.on("connect", () => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) finishViaPolling();
      });
    });

    client.on("message", async (_topic, payload) => {
      try {
        const event = JSON.parse(payload.toString("utf-8")) as MessagePublishEvent;
        // MQTT로 직접 받으면 서버가 deliveredAt을 못 찍어준다 - 기존
        // "AI가 읽어감 = 기록 처리" 시맨틱을 유지하려고 markDelivered
        // 조회를 한 번 더 호출해 실제 deliveredAt이 찍힌 행을 가져온다.
        const list = await apiCall<{ id: string; deliveredAt: string | null }[]>(
          `/api/projects/${projectId}/messages?status=pending&markDelivered=true`,
        ).catch(() => []);
        const matched = list.find((m) => m.id === event.id);
        finish({
          timedOut: false,
          message:
            matched ??
            { id: event.id, projectId, authorId: event.authorId, body: event.body, createdAt: event.createdAt, deliveredAt: null },
        });
      } catch {
        finishViaPolling();
      }
    });

    client.on("error", finishViaPolling);
  });
}
