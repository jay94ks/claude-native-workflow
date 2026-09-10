import { getDb } from "./db.js";
import { verifyAccessToken } from "./auth.js";
import { emqxConfig } from "./realtime.js";

// EMQX 클라이언트 인증/인가 - 미래 웹 인터페이스(Phase 5)가 EMQX에
// MQTT-over-WebSocket으로 직접 붙을 때 쓸 인프라. 웹 UI는 CONNECT 시
// username=userId, password=API 액세스 토큰(JWT)으로 접속한다는 게
// 전제 - 별도 EMQX 전용 로그인을 만들지 않고 이미 발급하는 API JWT를
// 그대로 재사용한다.
//
// EMQX 내장 JWT 검증기 대신 HTTP 훅으로 우리 자신의 verifyAccessToken()
// (Phase 0부터 검증된 코드)을 그대로 쓴다 - EMQX 쪽 시크릿/알고리즘
// 설정이 우리 JWT 발급 설정과 정확히 일치해야 하는 별도 신뢰 지점을
// 늘리지 않기 위해서다.

export type AuthDecision = "allow" | "deny";

function serviceCredentials(): { username: string; password: string } {
  const username = process.env.EMQX_SERVICE_USERNAME;
  const password = process.env.EMQX_SERVICE_PASSWORD;
  if (!username || !password) {
    throw new Error("EMQX_SERVICE_USERNAME/EMQX_SERVICE_PASSWORD 환경변수가 필요합니다");
  }
  return { username, password };
}

/** MQTT CONNECT 인증 - username=userId, password=JWT 액세스 토큰이
 * 전제. 백엔드 자신의 서비스 계정(message wait용 내부 연결)은 고정
 * username/password로 즉시 허용한다. */
export function checkConnect(username: string | undefined, password: string | undefined): AuthDecision {
  if (!username || !password) return "deny";

  let svc: { username: string; password: string };
  try {
    svc = serviceCredentials();
    if (username === svc.username && password === svc.password) return "allow";
  } catch {
    // 서비스 계정 미설정 - 아래 일반 JWT 경로로 계속
  }

  try {
    const payload = verifyAccessToken(password);
    return payload.sub === username ? "allow" : "deny";
  } catch {
    return "deny";
  }
}

const TOPIC_PATTERN = /^project\/([^/]+)\/(changes|messages)$/;

/** topic 인가 - `project/{projectId}/(changes|messages)` 패턴에서
 * projectId를 뽑아 그 프로젝트의 Member인지 확인한다(역할 구분 없음 -
 * 멤버면 구독/발행 둘 다 허용). 패턴에 안 맞는 topic은 무조건 거부.
 * 서비스 계정은 모든 topic 허용(백엔드 자신의 message wait 내부 연결). */
export async function checkAcl(username: string | undefined, topic: string | undefined): Promise<AuthDecision> {
  if (!username || !topic) return "deny";

  try {
    const svc = serviceCredentials();
    if (username === svc.username) return "allow";
  } catch {
    // 서비스 계정 미설정 - 계속
  }

  const match = TOPIC_PATTERN.exec(topic);
  if (!match) return "deny";
  const projectId = match[1];

  const db = getDb();
  const member = await db.member.findUnique({ where: { projectId_userId: { projectId, userId: username } } });
  return member ? "allow" : "deny";
}

interface EmqxAdminRequestInit {
  method: string;
  path: string;
  body?: unknown;
}

async function emqxAdminRequest({ method, path, body }: EmqxAdminRequestInit): Promise<Response> {
  const { apiUrl, apiKey, apiSecret } = emqxConfig();
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64"),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** 서버 기동 시 호출(EMQX 미설정이면 조용히 스킵 - realtimePublish와
 * 같은 fail-soft 원칙) - HTTP 인증/인가 소스가 없으면 등록한다. EMQX
 * Admin API에 실제로 등록해보고 확정한 요청 형식(POST /api/v5/
 * authentication, POST /api/v5/authorization/sources)이다. */
export async function ensureEmqxAuthConfigured(): Promise<void> {
  try {
    emqxConfig();
  } catch {
    return;
  }
  const publicUrl = process.env.PUBLIC_BACKEND_URL;
  if (!publicUrl) return; // authn/authz 훅 콜백 주소가 없으면 등록해도 무의미

  const authnUrl = `${publicUrl.replace(/\/$/, "")}/api/emqx/authn`;
  const authzUrl = `${publicUrl.replace(/\/$/, "")}/api/emqx/authz`;

  try {
    const existingAuthn = await emqxAdminRequest({ method: "GET", path: "/api/v5/authentication" });
    const authnList = (await existingAuthn.json()) as unknown[];
    if (authnList.length === 0) {
      await emqxAdminRequest({
        method: "POST",
        path: "/api/v5/authentication",
        body: {
          mechanism: "password_based",
          backend: "http",
          method: "post",
          url: authnUrl,
          headers: { "content-type": "application/json" },
          body: { username: "${username}", password: "${password}", clientid: "${clientid}" },
        },
      });
    }

    const existingAuthz = await emqxAdminRequest({ method: "GET", path: "/api/v5/authorization/sources" });
    const authzList = ((await existingAuthz.json()) as { sources: { type: string }[] }).sources;
    if (!authzList.some((s) => s.type === "http")) {
      await emqxAdminRequest({
        method: "POST",
        path: "/api/v5/authorization/sources",
        body: {
          type: "http",
          enable: true,
          method: "post",
          url: authzUrl,
          headers: { "content-type": "application/json" },
          body: { username: "${username}", topic: "${topic}", action: "${action}" },
        },
      });
    }
  } catch (err) {
    console.error("ensureEmqxAuthConfigured 실패:", err);
  }
}
