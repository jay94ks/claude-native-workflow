// 프로젝트별 외부 연동 웹훅(design-notes.md "프로젝트 설정 항목" -
// "Webhook/외부 연동 설정" - v2의 push-hook류 기능도 유지한다). v2는
// Gitea가 이 시스템으로 push 웹훅을 "수신"하는 구조였지만, v3는 아직
// Gitea를 운영하지 않으므로(내부 저장소는 es-git 로컬 유지 + 옵션
// push-mirror뿐) 방향을 반대로 잡았다 - 이 시스템에서 문서 CRUD 같은
// 일이 생길 때마다 등록된 외부 URL로 "발신"한다. 서명 방식(HMAC-SHA256,
// 헤더에 hex 다이제스트)은 v2가 Gitea/GitHub 웹훅 검증에 쓰던 것과 같은
// 관례를 그대로 가져왔다 - 방향은 바뀌었어도 "본문을 그대로 HMAC해서
// 헤더로 보낸다"는 검증 모델 자체는 업계 표준이라 재발명하지 않았다.

import crypto from "node:crypto";
import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function requireAdmin(projectId: string, architectId: string): Promise<ActionResult | null> {
  try {
    await requireMembership(projectId, architectId, "ADMIN");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

/** 등록 - 그 프로젝트의 Admin만. secret은 서버가 생성해서 이 응답에만 실어 보낸다(다시 조회 불가). */
export async function webhookAdd(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, url } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  if (typeof url !== "string" || !url) return fail("url이 필요합니다.");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    return fail("url은 http(s):// 로 시작하는 유효한 주소여야 합니다.");
  }

  const secret = crypto.randomBytes(24).toString("hex");
  const webhook = await prisma.webhook.create({ data: { projectId, url, secret } });

  return { ok: true, data: { id: webhook.id, url: webhook.url, secret } };
}

/** 목록 - 그 프로젝트의 Admin만, secret은 절대 다시 내려주지 않는다. */
export async function webhookList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  const webhooks = await prisma.webhook.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  return { ok: true, data: { items: webhooks.map((w) => ({ id: w.id, url: w.url, createdAt: w.createdAt })) } };
}

/** 삭제 - 그 프로젝트의 Admin만. */
export async function webhookDelete(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, id } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  if (typeof id !== "string" || !id) return fail("id가 필요합니다.");
  const deleted = await prisma.webhook.deleteMany({ where: { id, projectId } });
  if (deleted.count === 0) return fail(`웹훅 ${id}를 찾을 수 없습니다.`);
  return { ok: true };
}

/**
 * broadcastSubscriber.ts가 문서 이벤트마다 호출한다 - 등록된 웹훅 각각에
 * HMAC-SHA256 서명(`X-Cnw-Signature: sha256=<hex>`)을 실어 fire-and-forget
 * 으로 발송한다. 재시도 큐는 이번 라운드 범위 밖(design-notes.md에 계획
 * 항목으로 기록) - 실패는 경고 로그만 남기고 삼킨다(웹훅 발송 실패가
 * 문서 CRUD 자체를 막으면 안 된다).
 */
export async function deliverWebhooks(projectId: string, event: unknown): Promise<void> {
  const webhooks = await prisma.webhook.findMany({ where: { projectId } });
  if (webhooks.length === 0) return;

  const body = JSON.stringify(event);
  await Promise.all(
    webhooks.map(async (w) => {
      const signature = "sha256=" + crypto.createHmac("sha256", w.secret).update(body).digest("hex");
      try {
        await fetch(w.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Cnw-Signature": signature },
          body,
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        console.warn(`[webhooks] delivery to ${w.url} failed (ignored):`, (err as Error).message);
      }
    })
  );
}
