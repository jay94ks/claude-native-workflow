import mqtt from "mqtt";
import { getDb } from "./db.js";
import { realtimePublish, projectMessagesTopic } from "./realtime.js";

export interface MessageDetail {
  id: string;
  projectId: string;
  authorId: string | null;
  body: string;
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

export async function listMessages(projectId: string): Promise<MessageDetail[]> {
  const db = getDb();
  return db.message.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
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
 * 과함). */
export async function waitForMessage(projectId: string, timeoutSec: number): Promise<WaitResult> {
  const { url, username, password } = mqttConfig();
  const topic = projectMessagesTopic(projectId);

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, { username, password, connectTimeout: 10_000 });
    let settled = false;

    const finish = (result: WaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      resolve(result);
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
          message: { id: event.id, projectId, authorId: event.authorId, body: event.body, createdAt: new Date(event.createdAt) },
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
}
