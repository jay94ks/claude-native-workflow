import mqtt from "mqtt";
import { getDb } from "./db.js";
import { realtimePublish, projectMessagesTopic } from "./realtime.js";

export interface MessageDetail {
  id: string;
  projectId: string;
  authorId: string | null;
  body: string;
  deliveredAt: Date | null;
  createdAt: Date;
}

interface MessagePublishEvent {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export async function sendMessage(projectId: string, authorId: string, body: string): Promise<MessageDetail> {
  if (!body) throw new Error("body가 필요합니다");
  const db = getDb();
  const row = await db.message.create({ data: { projectId, authorId, body } });
  const event: MessagePublishEvent = {
    id: row.id,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
  await realtimePublish(projectMessagesTopic(projectId), event);
  return row;
}

export interface ListMessagesOptions {
  status?: "pending" | "delivered" | "all";
  markDelivered?: boolean;
}

/** status로 대기(deliveredAt null)/기록(deliveredAt 있음)을 필터한다.
 * markDelivered=true(CLI/MCP 호출부만 명시적으로 보냄 - "AI가 읽어감"의
 * 정의)면 조회 직후 그 결과 중 아직 대기 상태인 행들을 한 번에
 * deliveredAt=now()로 갱신하고, 반환 객체에도 그대로 반영한다(웹 UI는
 * 이 플래그를 안 보내므로 읽어도 상태가 안 바뀐다). */
export async function listMessages(projectId: string, opts: ListMessagesOptions = {}): Promise<MessageDetail[]> {
  const db = getDb();
  const where =
    opts.status === "pending"
      ? { projectId, deliveredAt: null }
      : opts.status === "delivered"
        ? { projectId, deliveredAt: { not: null } }
        : { projectId };
  const rows = await db.message.findMany({ where, orderBy: { createdAt: "asc" } });

  if (opts.markDelivered) {
    const pendingIds = rows.filter((r: MessageDetail) => !r.deliveredAt).map((r: MessageDetail) => r.id);
    if (pendingIds.length > 0) {
      const now = new Date();
      await db.message.updateMany({ where: { id: { in: pendingIds } }, data: { deliveredAt: now } });
      for (const r of rows) {
        if (pendingIds.includes(r.id)) r.deliveredAt = now;
      }
    }
  }

  return rows;
}

export interface MessagePage {
  items: MessageDetail[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 웹 메시지 화면 전용(요청 4번 페이지네이션) - 목록 조회만 하고
 * markDelivered는 지원하지 않는다(웹은 원래도 이 플래그를 안 보냄).
 * CLI/MCP가 쓰는 listMessages()는 그대로 둔다. */
export async function listMessagesPaged(
  projectId: string,
  opts: { status?: "pending" | "delivered" | "all"; page: number; pageSize: number },
): Promise<MessagePage> {
  const db = getDb();
  const where =
    opts.status === "pending"
      ? { projectId, deliveredAt: null }
      : opts.status === "delivered"
        ? { projectId, deliveredAt: { not: null } }
        : { projectId };
  const safePage = Math.max(1, opts.page);
  const [items, total] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    db.message.count({ where }),
  ]);
  return { items, page: safePage, pageSize: opts.pageSize, total, totalPages: Math.max(1, Math.ceil(total / opts.pageSize)) };
}

/** 상태를 전혀 바꾸지 않는 순수 조회 - 시스템 다운 등으로 세션이
 * 비정상 종료됐다가 복구됐을 때 "마지막 기록"을 확인하는 용도라 반복
 * 호출해도 부작용이 없어야 한다. */
export async function listRecentMessages(projectId: string, limit = 20): Promise<MessageDetail[]> {
  const db = getDb();
  return db.message.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: limit });
}

function mqttConfig(): { url: string; username: string; password: string } {
  const url = process.env.EMQX_MQTT_URL;
  const username = process.env.EMQX_SERVICE_USERNAME;
  const password = process.env.EMQX_SERVICE_PASSWORD;
  if (!url || !username || !password) {
    throw new Error("EMQX_MQTT_URL/EMQX_SERVICE_USERNAME/EMQX_SERVICE_PASSWORD 환경변수가 모두 필요합니다");
  }
  return { url, username, password };
}

export interface WaitResult {
  timedOut: boolean;
  message: MessageDetail | null;
}

/** `project/{projectId}/messages`를 백엔드 자신의 서비스 계정으로 구독해
 * 새 메시지가 오거나 타임아웃될 때까지 기다린다 - CLI/MCP는 이 함수를
 * 감싼 HTTP 롱폴 엔드포인트를 한 번 호출하기만 하면 된다(직접 MQTT를
 * 붙들지 않음 - "CLI/MCP는 REST만 호출하는 순수 클라이언트" 원칙 유지).
 * 매 호출마다 새로 연결한다(개인/소규모 설치 트래픽에서 커넥션 풀링은
 * 과함). 실제로 메시지를 받은 경우 그 행의 deliveredAt도 갱신(대기 중
 * 오는 새 메시지도 "AI가 즉시 수신"이므로 listMessages의 markDelivered와
 * 동일하게 기록 처리). */
export async function waitForMessage(projectId: string, timeoutSec: number): Promise<WaitResult> {
  const { url, username, password } = mqttConfig();
  const topic = projectMessagesTopic(projectId);

  const result = await new Promise<WaitResult>((resolve, reject) => {
    const client = mqtt.connect(url, { username, password, connectTimeout: 10_000 });
    let settled = false;

    const finish = (r: WaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      resolve(r);
    };

    const timer = setTimeout(() => finish({ timedOut: true, message: null }), timeoutSec * 1000);

    client.on("connect", () => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err && !settled) {
          settled = true;
          clearTimeout(timer);
          client.end(true);
          reject(err);
        }
      });
    });

    client.on("message", (_topic, payload) => {
      try {
        const event = JSON.parse(payload.toString("utf-8")) as MessagePublishEvent;
        finish({
          timedOut: false,
          message: {
            id: event.id,
            projectId,
            authorId: event.authorId,
            body: event.body,
            deliveredAt: null,
            createdAt: new Date(event.createdAt),
          },
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          client.end(true);
          reject(err);
        }
      }
    });

    client.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        client.end(true);
        reject(err);
      }
    });
  });

  if (result.message) {
    const db = getDb();
    const now = new Date();
    await db.message.update({ where: { id: result.message.id }, data: { deliveredAt: now } });
    result.message.deliveredAt = now;
  }

  return result;
}
