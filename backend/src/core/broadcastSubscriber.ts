// EMQX의 `cnw/+/docs` 문서 이벤트를 구독해서 Meilisearch 인덱싱과 백엔드
// 캐시 무효화를 비동기로 처리한다 (design-notes.md "Meilisearch 활용
// 최적화 방안" - "인덱싱은 EMQX 브로드캐스트를 구독해서 비동기로").
// server.ts가 기동 시 한 번 start()를 호출한다. Phase 9 후속: 같은
// 구독에서 프로젝트별 등록된 웹훅에도 이벤트를 그대로 발송한다
// (webhooks.ts) - 이미 흐르는 이벤트를 재사용할 뿐, 별도 구독을 새로
// 만들지 않는다.

import { getEmqxClient, type DocEvent } from "./emqx";
import { indexDocument, removeFromIndex } from "./searchIndex";
import { invalidateProject } from "./cache";
import { deliverWebhooks } from "./webhooks";

let started = false;

export function startBroadcastSubscriber(): void {
  if (started) return;
  started = true;

  const client = getEmqxClient();
  client.on("connect", () => {
    client.subscribe("cnw/+/docs", (err) => {
      if (err) console.warn("[broadcastSubscriber] subscribe failed (ignored):", err.message);
    });
  });

  client.on("message", (topic, payload) => {
    if (!topic.endsWith("/docs")) return;
    let event: DocEvent;
    try {
      event = JSON.parse(payload.toString());
    } catch {
      return;
    }

    invalidateProject(event.projectId);
    if (event.op === "upsert") {
      void indexDocument(event.doc);
    } else {
      void removeFromIndex(event.id);
    }
    void deliverWebhooks(event.projectId, event);
  });
}
