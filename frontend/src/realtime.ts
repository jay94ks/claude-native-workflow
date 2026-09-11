// 브라우저가 EMQX에 MQTT-over-WebSocket으로 직접 붙어 프로젝트 topic을
// 구독한다(core/emqxAuth.ts의 checkConnect/checkAcl이 그대로 검증 -
// username=userId, password=JWT 액세스 토큰). /api/realtime-config가
// null을 반환하면(EMQX WS 미노출) 실시간 갱신 없이 조용히 비활성화된다 -
// 다른 모든 EMQX 통합 지점과 같은 fail-soft 원칙.
import mqtt, { type MqttClient } from "mqtt";
import { apiCall, getAccessToken } from "./api/client";

export interface ChangeEvent {
  entity: "document" | "comment" | "question" | "answer" | "project" | "kanbanColumn" | "kanbanCard";
  action: "create" | "update" | "delete";
  id: string;
  trackingCode?: string;
  targetType?: string;
  targetKey?: string;
  at: string;
}

export interface MessageEvent {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export interface RealtimeHandlers {
  onChange?: (event: ChangeEvent) => void;
  onMessage?: (event: MessageEvent) => void;
}

function decodeUserId(accessToken: string): string | null {
  try {
    const payloadB64 = accessToken.split(".")[1];
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** 반환된 cleanup 함수를 사용하는 컴포넌트의 onUnmounted에서 반드시
 * 호출한다(연결을 끊지 않으면 떠난 화면이 계속 구독을 물고 있게 됨). */
export async function connectProjectRealtime(
  projectId: string,
  handlers: RealtimeHandlers,
): Promise<() => void> {
  const noop = () => {};

  const { mqttWsUrl } = await apiCall<{ mqttWsUrl: string | null }>("/realtime-config");
  if (!mqttWsUrl) return noop;

  const accessToken = getAccessToken();
  if (!accessToken) return noop;
  const userId = decodeUserId(accessToken);
  if (!userId) return noop;

  let client: MqttClient;
  try {
    client = mqtt.connect(mqttWsUrl, { username: userId, password: accessToken, connectTimeout: 10_000 });
  } catch {
    return noop;
  }

  const changesTopic = `project/${projectId}/changes`;
  const messagesTopic = `project/${projectId}/messages`;

  client.on("connect", () => {
    client.subscribe([changesTopic, messagesTopic], { qos: 1 });
  });

  client.on("message", (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString("utf-8"));
      if (topic === changesTopic) handlers.onChange?.(data as ChangeEvent);
      else if (topic === messagesTopic) handlers.onMessage?.(data as MessageEvent);
    } catch {
      // 파싱 실패한 이벤트는 조용히 무시 - 실시간 갱신은 부가 기능이라
      // 화면 자체를 깨뜨리면 안 된다.
    }
  });

  client.on("error", () => {
    // 연결 실패도 같은 fail-soft 원칙 - 화면은 REST 기반 초기 로드만으로
    // 계속 동작한다.
  });

  return () => client.end(true);
}
