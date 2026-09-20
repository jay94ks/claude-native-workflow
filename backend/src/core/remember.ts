// remember.add / remember.update / remember.delete / remember.list - (프로젝트,
// architect) 단위로 개인화된, 문서 체계와 별개인 메모리 항목
// (design-notes.md "`remember` 항목(메모리) - 문서 체계와 별개").

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { generateDocumentId } from "./trackingCode";
import { verifyTaggedRefs } from "./refs";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

const CATEGORIES = ["user", "feedback", "project", "reference"] as const;

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function guardMembership(projectId: unknown, ctx: ActionContext): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

export async function rememberAdd(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx);
  if (membershipFailure) return membershipFailure;

  const { projectId, category, title, summary, content, related } = payload;
  if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) {
    return fail(`category는 ${CATEGORIES.join("/")} 중 하나여야 합니다.`);
  }
  if (typeof title !== "string" || !title) return fail("title이 필요합니다.");
  if (typeof summary !== "string" || !summary) return fail("summary가 필요합니다.");

  if (related !== undefined) {
    const check = await verifyTaggedRefs(projectId, related);
    if (!check.ok) return fail(check.reason);
  }

  const item = await prisma.rememberItem.create({
    data: {
      id: generateDocumentId(),
      projectId,
      ownerAccountId: ctx.architectId,
      category,
      title,
      summary,
      content: content ?? "",
      related: related ?? [],
    },
  });

  return { ok: true, data: { id: item.id } };
}

async function findOwn(projectId: string, id: string, architectId: string) {
  return prisma.rememberItem.findFirst({ where: { id, projectId, ownerAccountId: architectId } });
}

export async function rememberUpdate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx);
  if (membershipFailure) return membershipFailure;

  const { projectId, id, title, summary, content, related } = payload;
  const existing = await findOwn(projectId, id, ctx.architectId);
  if (!existing) return fail(`remember 항목 ${id}를 찾을 수 없습니다(본인 소유만 수정 가능).`);

  if (related !== undefined) {
    const check = await verifyTaggedRefs(projectId, related);
    if (!check.ok) return fail(check.reason);
  }

  await prisma.rememberItem.update({
    where: { id: existing.id },
    data: {
      title: title ?? existing.title,
      summary: summary ?? existing.summary,
      content: content ?? existing.content,
      related: related ?? (existing.related as any),
    },
  });

  return { ok: true };
}

export async function rememberDelete(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx);
  if (membershipFailure) return membershipFailure;

  const { projectId, id } = payload;
  const existing = await findOwn(projectId, id, ctx.architectId);
  if (!existing) return fail(`remember 항목 ${id}를 찾을 수 없습니다(본인 소유만 삭제 가능).`);

  await prisma.rememberItem.delete({ where: { id: existing.id } });
  return { ok: true };
}

export async function rememberList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx);
  if (membershipFailure) return membershipFailure;

  const { projectId, category, page } = payload;
  const pageSize = 50;
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;
  const where = { projectId, ownerAccountId: ctx.architectId, ...(category ? { category } : {}) };

  const [total, items] = await Promise.all([
    prisma.rememberItem.count({ where }),
    prisma.rememberItem.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (pageNumber - 1) * pageSize, take: pageSize }),
  ]);

  return { ok: true, data: { page: pageNumber, total, items } };
}
