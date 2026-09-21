// api.createKey / list / listForProject / revoke (docs/plan-nickname-apikey-policy.md)
// - v2의 "개인 키/프로젝트 키" 구분 계승("팀 키"는 v3에 팀 개념이 없어
// 대상 아님). 원문(secret)은 절대 저장하지 않고 해시만 저장한다 - 다시
// 보여줄 필요 자체가 없어야 하므로(로그인 apiKey 발급과 동일한 원칙).

import { prisma } from "./prisma";
import { generateApiKey, hashApiKey, apiKeyPrefix } from "./crypto";
import { requireMembership, MembershipError } from "./membership";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

function toSummary(key: {
  id: string;
  scope: string;
  projectId: string | null;
  label: string | null;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}) {
  const now = new Date();
  const status = key.revokedAt ? "revoked" : key.expiresAt && key.expiresAt <= now ? "expired" : "active";
  return {
    id: key.id,
    scope: key.scope,
    projectId: key.projectId,
    label: key.label,
    keyPrefix: key.keyPrefix,
    status,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
  };
}

/**
 * 본인 신원을 대행하되 범위만 좁힌 키를 만든다(다른 사람 대신 만드는
 * 기능은 없음 - v2와 동일 원칙). `scope: "project"`는 그 프로젝트의
 * collaborator(role 무관, READ 이상)만 만들 수 있다.
 */
export async function apiKeyCreate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { scope, projectId, label } = payload ?? {};
  if (scope !== "personal" && scope !== "project") return fail('scope는 "personal" 또는 "project"여야 합니다.');

  if (scope === "project") {
    if (typeof projectId !== "string" || !projectId) return fail("project 스코프에는 projectId가 필요합니다.");
    try {
      await requireMembership(projectId, ctx.architectId, "READ");
    } catch (err) {
      if (err instanceof MembershipError) return fail(err.message);
      throw err;
    }
  }

  const rawKey = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      accountId: ctx.architectId,
      keyHash: hashApiKey(rawKey),
      keyPrefix: apiKeyPrefix(rawKey),
      scope,
      projectId: scope === "project" ? projectId : null,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
    },
  });

  return { ok: true, data: { key: toSummary(key), secret: rawKey } };
}

/** 내가 가진 키 전부(personal + project, 두 스코프 다) - 로그인이 만드는 것도 포함. */
export async function apiKeyList(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  const keys = await prisma.apiKey.findMany({
    where: { accountId: ctx.architectId },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { slug: true, creator: { select: { username: true } } } } },
  });
  return {
    ok: true,
    data: {
      items: keys.map((k) => ({
        ...toSummary(k),
        projectOwnerUsername: k.project?.creator.username ?? null,
        projectSlug: k.project?.slug ?? null,
      })),
    },
  };
}

/** 그 프로젝트 Admin 전용 - collaborator들이 그 프로젝트로 발급해둔 키 전부. */
export async function apiKeyListForProject(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload ?? {};
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "ADMIN");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const keys = await prisma.apiKey.findMany({
    where: { projectId, scope: "project" },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { username: true } } },
  });
  return { ok: true, data: { items: keys.map((k) => ({ ...toSummary(k), ownerUsername: k.account.username })) } };
}

/**
 * "삭제"가 아니라 배제(soft revoke) - 행은 남고 revokedAt만 채운다(v2
 * 판단 계승, 감사 기록 보존). 본인 소유 키는 스코프 무관하게 항상 revoke
 * 가능하고, project 스코프 키는 그 프로젝트의 Admin도 (남의 것이라도)
 * revoke할 수 있다(v2의 "owner가 project 키 전체를 관리" 계승).
 */
export async function apiKeyRevoke(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { keyId } = payload ?? {};
  if (typeof keyId !== "string" || !keyId) return fail("keyId가 필요합니다.");

  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) return fail("키를 찾을 수 없습니다.");
  if (key.revokedAt) return fail("이미 배제된 키입니다.");

  const isOwner = key.accountId === ctx.architectId;
  let isProjectAdmin = false;
  if (!isOwner && key.scope === "project" && key.projectId) {
    try {
      await requireMembership(key.projectId, ctx.architectId, "ADMIN");
      isProjectAdmin = true;
    } catch {
      isProjectAdmin = false;
    }
  }
  if (!isOwner && !isProjectAdmin) return fail("이 키를 배제할 권한이 없습니다.");

  const updated = await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  return { ok: true, data: toSummary(updated) };
}
