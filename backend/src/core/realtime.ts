// EMQX REST API로 발행(publish)만 하는 얇은 래퍼(Phase 0 범위 - 구독
// 측/클라이언트 인증 연동은 Phase 4). search.ts의 indexSync()와 같은
// 원칙: 문서/코멘트 등 쓰기가 일어날 때마다 realtimePublish()를 호출해
// 해당 프로젝트 topic에 이벤트를 올린다 - Phase 0 시점엔 구독자가 없어도
// 발행 자체는 항상 한다(나중에 구독 기능을 붙일 때 발행 쪽을 되짚어
// 고치지 않아도 되게).

interface EmqxPublishBody {
  topic: string;
  payload: string;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export function emqxConfig(): { apiUrl: string; apiKey: string; apiSecret: string } {
  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;
  if (!apiUrl || !apiKey || !apiSecret) {
    throw new Error("EMQX_API_URL/EMQX_API_KEY/EMQX_API_SECRET 환경변수가 모두 필요합니다");
  }
  return { apiUrl, apiKey, apiSecret };
}

export function projectChangesTopic(projectId: string): string {
  return `project/${projectId}/changes`;
}

export function projectMessagesTopic(projectId: string): string {
  return `project/${projectId}/messages`;
}

export interface ChangeEvent {
  entity: "document" | "comment" | "question" | "answer" | "project" | "kanbanColumn" | "kanbanCard" | "kanbanCardComment";
  action: "create" | "update" | "delete";
  id: string;
  trackingCode?: string;
  at: string; // ISO timestamp
}

/** EMQX가 설정 안 됐거나(로컬 개발 등) 일시적으로 응답이 없어도 쓰기
 * 자체(DB 커밋)는 이미 끝난 뒤라 실패를 조용히 삼킨다 - 실시간 알림은
 * "있으면 좋은" 부가 기능이라, 이게 실패했다고 문서 저장 자체가
 * 실패한 것처럼 보이면 안 된다. 대신 에러는 로그로 남긴다.
 *
 * 제네릭 - `ChangeEvent`(문서/코멘트 등 변경 알림)뿐 아니라 인스턴스
 * 메시지 페이로드(본문 텍스트 포함, 모양이 다름)도 같은 함수로 발행한다. */
export async function realtimePublish<T>(topic: string, event: T): Promise<void> {
  let config: { apiUrl: string; apiKey: string; apiSecret: string };
  try {
    config = emqxConfig();
  } catch {
    return; // EMQX 미설정 - 로컬 개발 등에서 조용히 스킵
  }
  // retain을 명시적으로 false로 준다 - 여기서 다루는 건 "지금 연결돼
  // 있는 쪽에 실시간으로만 알려주는" 이벤트라 브로커가 topic별 마지막
  // 메시지를 붙들고 있을 필요가 없다(진짜 히스토리는 Message DB
  // 테이블이 담당). 기본값에 기대지 않고 의도를 명시적으로 남겨둔다.
  const body: EmqxPublishBody = { topic, payload: JSON.stringify(event), qos: 1, retain: false };
  try {
    const res = await fetch(`${config.apiUrl}/api/v5/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64"),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`realtimePublish 실패: HTTP ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("realtimePublish 실패:", err);
  }
}
