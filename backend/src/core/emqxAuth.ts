import crypto from "node:crypto";
import { getDb } from "./db.js";
import { verifyAccessToken } from "./auth.js";
import { emqxConfig } from "./realtime.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

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

/** CLI/MCP가 message wait에서 EMQX에 직접 구독할 때 쓰는 전용
 * 계정을 조회하고, 없으면 만든다(설계자 지시 - 백엔드가 대신
 * 구독하지 않고 CLI/MCP가 직접 구독하도록 전환). JWT 액세스
 * 토큰과 달리 수명이 없고 REST 전체 권한도 아닌, MQTT 접속에만
 * 쓰이는 좁은 범위의 자격증명이다 - core/giteaAccounts.ts의
 * "User 행에 암호화해 직접 두고 첫 필요 시점에 생성"과 같은 패턴
 * (항상 1:1 관계라 별도 테이블 불필요). */
export async function getOrCreateMqttCredential(userId: string): Promise<{ username: string; password: string }> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId }, select: { mqttPasswordEncrypted: true } });
  if (!user) throw new Error("사용자를 찾을 수 없습니다");
  if (user.mqttPasswordEncrypted) {
    return { username: userId, password: decryptSecret(user.mqttPasswordEncrypted) };
  }
  const password = crypto.randomBytes(24).toString("hex");
  await db.user.update({ where: { id: userId }, data: { mqttPasswordEncrypted: encryptSecret(password) } });
  return { username: userId, password };
}

/** MQTT CONNECT 인증 - username=userId, 아래 세 password 방식 중 하나를
 * 허용한다: (1) 백엔드 자신의 서비스 계정(고정 username/password,
 * message wait 폴백 경로의 내부 연결), (2) JWT 액세스 토큰(웹 UI가
 * EMQX-WS에 직접 붙을 때 씀 - realtime.ts), (3) getOrCreateMqttCredential()
 * 이 발급한 전용 계정(CLI/MCP의 message wait 직접 구독 - #message-wait-
 * mqtt-direct). DB 조회가 필요해져 비동기로 바뀜(유일한 호출부인
 * server.ts의 /api/emqx/authn 라우트에 await 추가). */
export async function checkConnect(username: string | undefined, password: string | undefined): Promise<AuthDecision> {
  if (!username || !password) return "deny";

  let svc: { username: string; password: string };
  try {
    svc = serviceCredentials();
    if (username === svc.username && password === svc.password) return "allow";
  } catch {
    // 서비스 계정 미설정 - 아래 경로로 계속
  }

  try {
    const payload = verifyAccessToken(password);
    if (payload.sub === username) return "allow";
  } catch {
    // JWT 아님 - 아래 전용 MQTT 계정 경로로 계속
  }

  try {
    const db = getDb();
    const user = await db.user.findUnique({ where: { id: username }, select: { mqttPasswordEncrypted: true } });
    if (user?.mqttPasswordEncrypted && decryptSecret(user.mqttPasswordEncrypted) === password) return "allow";
  } catch {
    // 계속 - 아래 deny로
  }

  return "deny";
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
