// EMQX 연동 - 공유 MQTT 클라이언트 하나로 발행/구독 전부 처리한다.
// Phase 4: `emerg` 메시지 즉시 브로드캐스트. Phase 5: 문서 CRUD 전체
// 브로드캐스트(design-notes.md "실시간 브로드캐스트(EMQX)") - Meilisearch
// 인덱싱/캐시 무효화가 이제 이 브로드캐스트를 구독해서 비동기로 처리한다
// (broadcastSubscriber.ts).

import mqtt, { type MqttClient } from "mqtt";

let client: MqttClient | null = null;

export function getEmqxClient(): MqttClient {
  if (!client) {
    client = mqtt.connect(process.env.EMQX_MQTT_URL ?? "mqtt://127.0.0.1:1883", {
      username: process.env.EMQX_SERVICE_USERNAME,
      password: process.env.EMQX_SERVICE_PASSWORD,
      connectTimeout: 3000,
    });
    client.on("error", (err) => console.warn("[emqx] connection error (ignored):", err.message));
  }
  return client;
}

export async function publishEmerg(projectId: string, message: { id: string; body: string }): Promise<void> {
  try {
    const mqttClient = getEmqxClient();
    await new Promise<void>((resolve, reject) => {
      mqttClient.publish(`cnw/${projectId}/emerg`, JSON.stringify(message), { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    console.warn("[emqx] failed to publish emerg (ignored):", (err as Error).message);
  }
}

export type DocEvent =
  | {
      op: "upsert";
      projectId: string;
      doc: {
        id: string;
        projectId: string;
        type: string;
        kind: string;
        state: string;
        branch: string | null;
        author: string;
        title: string;
        content: string;
      };
    }
  | { op: "delete"; projectId: string; id: string };

export function publishDocEvent(event: DocEvent): void {
  try {
    getEmqxClient().publish(`cnw/${event.projectId}/docs`, JSON.stringify(event), { qos: 1 });
  } catch (err) {
    console.warn("[emqx] failed to publish doc event (ignored):", (err as Error).message);
  }
}
