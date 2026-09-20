// message.send / message.list / message.transition - 문서 체계와 별개의
// 경량 알림 엔티티 (design-notes.md "메시지 시스템 (상세 스펙)").
// 표준 응답의 `notices` piggyback은 api/server.ts에서 collectAndDeliver()를
// 호출해 구현한다.

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { generateDocumentId } from "./trackingCode";
import { publishEmerg } from "./emqx";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";
import type { Channel } from "./documentRules";

const FROM_VALUES = ["from-web", "etc", "emerg"] as const; // "notice"는 시스템 내부 생성 전용 - 액션으로 직접 못 만든다.

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

function isTargetedAt(to: string, ctx: ActionContext): boolean {
  if (to === ctx.channel) return true; // 'agent' | 'architect'
  if (to === ctx.architectId) return true; // 특정 architect 지정
  return false;
}

/** to가 가리키는 대상의 반대편(=사실상 보낸 쪽으로 간주)인지. */
function isSenderSideOf(to: string, channel: Channel): boolean {
  if (to === "agent") return channel === "architect";
  if (to === "architect") return channel === "agent";
  // 특정 architectId로 보낸 메시지는 클로드(시스템)가 보낸 것으로 간주한다.
  return channel === "agent";
}

export async function messageSend(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, from, to, body, ttl } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  if (typeof from !== "string" || !(FROM_VALUES as readonly string[]).includes(from)) {
    return fail(`from은 ${FROM_VALUES.join("/")} 중 하나여야 합니다("notice"는 시스템이 자동 생성).`);
  }
  if ((from === "from-web" || from === "emerg") && ctx.channel !== "architect") {
    return fail(`from: "${from}"는 architect 채널만 보낼 수 있습니다.`);
  }
  if (typeof to !== "string" || !to) return fail('to가 필요합니다("agent" | "architect" | 특정 architectId).');
  if (typeof body !== "string" || !body) return fail("body가 필요합니다.");

  const id = generateDocumentId();
  const message = await prisma.message.create({
    data: { id, projectId, from, to, body, ttl: typeof ttl === "number" ? ttl : -1 },
  });

  if (from === "emerg") {
    await publishEmerg(projectId, { id: message.id, body: message.body });
  }

  return { ok: true, data: { id: message.id } };
}

export async function messageList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, state, page } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const pageSize = 50;
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;
  const where = {
    projectId,
    ...(state ? { state } : {}),
    OR: [{ to: ctx.channel }, { to: ctx.architectId }],
  };

  const [total, items] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pageNumber - 1) * pageSize, take: pageSize }),
  ]);

  return { ok: true, data: { page: pageNumber, total, items } };
}

export async function messageTransition(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, id, state } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const message = await prisma.message.findFirst({ where: { id, projectId } });
  if (!message) return fail(`메시지 ${id}를 찾을 수 없습니다.`);

  if (state === "done") {
    if (message.state !== "read") return fail(`이미 전달된(read) 메시지만 done으로 전이할 수 있습니다(현재: ${message.state}).`);
    if (!isTargetedAt(message.to, ctx)) return fail("이 메시지의 수신자만 done으로 전이할 수 있습니다.");
  } else if (state === "canceled") {
    if (message.state !== "sent") return fail(`아직 전달되지 않은(sent) 메시지만 취소할 수 있습니다(현재: ${message.state}).`);
    if (!isSenderSideOf(message.to, ctx.channel)) return fail("이 메시지를 보낸 쪽만 취소할 수 있습니다.");
  } else {
    return fail('state는 "done" 또는 "canceled"만 가능합니다.');
  }

  const updated = await prisma.message.update({ where: { id: message.id }, data: { state } });
  return { ok: true, data: { id: updated.id, state: updated.state } };
}

/**
 * 표준 응답의 `notices` piggyback - 이 요청의 채널/architect에게 아직
 * 전달되지 않은(sent) 메시지를 모아 반환하고, 그 자리에서 `read`로
 * 전이시킨다(design-notes.md "전달되는 순간... sent -> read로 자동 전이").
 * TTL이 지난 메시지는 전달하지 않고 canceled로 만료시킨다.
 */
export async function collectAndDeliver(projectId: string, ctx: ActionContext): Promise<string[]> {
  const pending = await prisma.message.findMany({
    where: { projectId, state: "sent", OR: [{ to: ctx.channel }, { to: ctx.architectId }] },
  });

  const now = Date.now();
  const toDeliver: typeof pending = [];
  const toExpire: typeof pending = [];
  for (const m of pending) {
    if (m.ttl >= 0 && now - m.createdAt.getTime() > m.ttl * 1000) toExpire.push(m);
    else toDeliver.push(m);
  }

  if (toExpire.length > 0) {
    await prisma.message.updateMany({ where: { id: { in: toExpire.map((m) => m.id) } }, data: { state: "canceled" } });
  }
  if (toDeliver.length > 0) {
    await prisma.message.updateMany({ where: { id: { in: toDeliver.map((m) => m.id) } }, data: { state: "read" } });
  }

  return toDeliver.map((m) => m.body);
}

/** docs.add 등에서 이벤트 발생 시 자동으로 남기는 시스템 notice. */
export async function notify(projectId: string, to: string, body: string): Promise<void> {
  await prisma.message.create({
    data: { id: generateDocumentId(), projectId, from: "notice", to, body, ttl: -1 },
  });
}
