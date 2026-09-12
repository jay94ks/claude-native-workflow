import mqtt from "mqtt";
import { getDb } from "./db.js";
import { realtimePublish, projectMessagesTopic, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { isSuperAdmin } from "./auth.js";
import { getMemberRole } from "./members.js";

export interface MessageDetail {
  id: string;
  projectId: string;
  authorId: string | null;
  body: string;
  deliveredAt: Date | null;
  ackedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

async function assertIsProjectMember(projectId: string, userId: string): Promise<void> {
  const role = await getMemberRole(projectId, userId);
  if (!role) throw new Error("이 프로젝트의 멤버만 메시지를 처리할 수 있습니다");
}

interface MessagePublishEvent {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export async function sendMessage(projectId: string, authorId: string | null, body: string): Promise<MessageDetail> {
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

/** 본인이 보낸 메시지만(또는 superAdmin) 수정/삭제할 수 있다 -
 * core/comments.ts의 editComment/deleteComment와 같은 소유권 패턴
 * (authorId가 null인 시스템 브로드캐스트는 이 비교가 항상 실패해
 * 자연히 일반 사용자는 못 건드리고 superAdmin만 정리 가능).
 *
 * 주의: 이벤트는 project/{id}/messages가 아니라 project/{id}/changes
 * 토픽으로 발행한다 - waitForMessage()는 messages 토픽에 오는 어떤
 * payload든 "새 메시지 도착"으로 간주해 파싱하므로, 여기서 수정/삭제
 * 이벤트를 그 토픽에 올리면 대기 중인 message_wait 호출자가 이를
 * 새 메시지로 오인하게 된다. */
export async function editMessage(id: string, body: string, requesterId: string): Promise<MessageDetail> {
  if (!body.trim()) throw new Error("body가 필요합니다");
  const db = getDb();
  const existing = await db.message.findUnique({ where: { id } });
  if (!existing) throw new Error(`메시지를 찾을 수 없습니다: ${id}`);
  if (existing.authorId !== requesterId && !(await isSuperAdmin(requesterId))) {
    throw new Error("본인이 보낸 메시지만 수정할 수 있습니다");
  }
  // 대기 상태(ackedAt 없음)인 메시지는 수정할 수 없다 - 삭제만 가능
  // (설계자 지시 - 대기열에 올라온 것은 아직 아무도 처리를 시작하지
  // 않았으므로 수정 대신 삭제 후 다시 보내는 쪽으로 유도).
  if (!existing.ackedAt) {
    throw new Error("대기 중인 메시지는 수정할 수 없습니다 - 삭제만 가능합니다");
  }
  const row = await db.message.update({ where: { id }, data: { body } });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "message",
    action: "update",
    id,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
  return row;
}

export async function deleteMessage(id: string, requesterId: string): Promise<void> {
  const db = getDb();
  const existing = await db.message.findUnique({ where: { id } });
  if (!existing) throw new Error(`메시지를 찾을 수 없습니다: ${id}`);
  if (existing.authorId !== requesterId && !(await isSuperAdmin(requesterId))) {
    throw new Error("본인이 보낸 메시지만 삭제할 수 있습니다");
  }
  await db.message.delete({ where: { id } });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "message",
    action: "delete",
    id,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}

/** 대기(ackedAt 없음) → 처리중(ackedAt 있음, completedAt 없음)으로
 * 명시적으로 옮긴다 - 단순히 목록을 읽는 것(deliveredAt)과는 별개
 * 축이다(설계자 지시: "읽음"과 "처리 시작"을 분리). 이미 처리중/기록
 * 상태면 그대로 반환(idempotent - 중복 호출해도 에러 아님). */
export async function ackMessage(id: string, requesterId: string): Promise<MessageDetail> {
  const db = getDb();
  const existing = await db.message.findUnique({ where: { id } });
  if (!existing) throw new Error(`메시지를 찾을 수 없습니다: ${id}`);
  await assertIsProjectMember(existing.projectId, requesterId);
  if (existing.ackedAt) return existing;
  const now = new Date();
  const row = await db.message.update({ where: { id }, data: { ackedAt: now } });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "message",
    action: "update",
    id,
    at: now.toISOString(),
  } satisfies ChangeEvent);
  return row;
}

/** 처리중 → 기록(completedAt 있음)으로 옮긴다. ack 없이 바로
 * complete를 부르면(처리 시작 선언 없이 곧장 완료) ackedAt도 같이
 * 채워 넣는다 - 이미 완료됐다면 거기서 멈춰 있어야 자연스럽다. 이미
 * 기록 상태면 그대로 반환(idempotent). */
export async function completeMessage(id: string, requesterId: string): Promise<MessageDetail> {
  const db = getDb();
  const existing = await db.message.findUnique({ where: { id } });
  if (!existing) throw new Error(`메시지를 찾을 수 없습니다: ${id}`);
  await assertIsProjectMember(existing.projectId, requesterId);
  if (existing.completedAt) return existing;
  const now = new Date();
  const row = await db.message.update({
    where: { id },
    data: { completedAt: now, ackedAt: existing.ackedAt ?? now },
  });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "message",
    action: "update",
    id,
    at: now.toISOString(),
  } satisfies ChangeEvent);
  return row;
}

export interface ListMessagesOptions {
  status?: "pending" | "processing" | "delivered" | "all";
  markDelivered?: boolean;
}

/** status로 대기(ackedAt 없음)/처리중(ackedAt 있음, completedAt 없음)/
 * 기록(completedAt 있음)을 필터한다 - deliveredAt(AI가 읽어감)은 이
 * 분류와 별개 축이라 필터에 안 쓰인다. markDelivered=true(CLI/MCP
 * 호출부만 명시적으로 보냄 - "AI가 읽어감"의 정의)면 조회 직후 그
 * 결과 중 deliveredAt이 아직 없는 행들을 한 번에 deliveredAt=now()로
 * 갱신하고, 반환 객체에도 그대로 반영한다(웹 UI는 이 플래그를 안
 * 보내므로 읽어도 안 바뀐다). */
export async function listMessages(projectId: string, opts: ListMessagesOptions = {}): Promise<MessageDetail[]> {
  const db = getDb();
  const where =
    opts.status === "pending"
      ? { projectId, ackedAt: null }
      : opts.status === "processing"
        ? { projectId, ackedAt: { not: null }, completedAt: null }
        : opts.status === "delivered"
          ? { projectId, completedAt: { not: null } }
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
  opts: { status?: "pending" | "processing" | "delivered" | "all"; page: number; pageSize: number },
): Promise<MessagePage> {
  const db = getDb();
  const where =
    opts.status === "pending"
      ? { projectId, ackedAt: null }
      : opts.status === "processing"
        ? { projectId, ackedAt: { not: null }, completedAt: null }
        : opts.status === "delivered"
          ? { projectId, completedAt: { not: null } }
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

// 이 값보다 긴 timeoutSec을 요청해도 항상 이 상한으로 잘린다 - HTTP
// 요청 하나가 오래 블로킹하며 서버 커넥션/MQTT 구독을 길게 붙드는
// 것을 막기 위한 방어선(누가 이 엔드포인트를 직접 호출하든 항상
// 적용됨). 사용자가 원하는 "긴 대기"는 이 상한 대신 CLI/MCP가 이
// 짧은 대기를 반복 호출(폴링)해서 흉내낸다 - cli/apiclient.ts의
// waitForMessagePolling()/MESSAGE_WAIT_POLL_INTERVAL_SEC(같은 값,
// CLI/MCP는 core를 직접 import 못 해 별도 선언) 참고.
export const MESSAGE_WAIT_POLL_MAX_SEC = 10;

/** `project/{projectId}/messages`를 백엔드 자신의 서비스 계정으로 구독해
 * 새 메시지가 오거나 타임아웃될 때까지 기다린다 - CLI/MCP는 이 함수를
 * 감싼 HTTP 롱폴 엔드포인트를 한 번 호출하기만 하면 된다(직접 MQTT를
 * 붙들지 않음 - "CLI/MCP는 REST만 호출하는 순수 클라이언트" 원칙 유지).
 * 매 호출마다 새로 연결한다(개인/소규모 설치 트래픽에서 커넥션 풀링은
 * 과함). 실제로 메시지를 받은 경우 그 행의 deliveredAt도 갱신(대기 중
 * 오는 새 메시지도 "AI가 즉시 수신"이므로 listMessages의 markDelivered와
 * 동일하게 기록 처리). timeoutSec은 항상 MESSAGE_WAIT_POLL_MAX_SEC
 * 이하로 클램프된다. */
export async function waitForMessage(projectId: string, timeoutSec: number): Promise<WaitResult> {
  const clampedTimeoutSec = Math.min(Math.max(Math.trunc(timeoutSec) || 1, 1), MESSAGE_WAIT_POLL_MAX_SEC);
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

    const timer = setTimeout(() => finish({ timedOut: true, message: null }), clampedTimeoutSec * 1000);

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
            ackedAt: null,
            completedAt: null,
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
