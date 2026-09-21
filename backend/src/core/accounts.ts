// account.changePassword / resetPassword / disable / enable / delete / list
// (docs/plan-account-management.md) - v2의 두 정책(부트스트랩 계정 = 최고
// 관리자, admin 대행 임시 비밀번호 재설정 + 강제 변경 없음)을 그대로
// 계승하고, 계정 비활성화/삭제는 v2에 선례가 없는 v3 신규 설계다.

import * as crypto from "crypto";
import * as argon2 from "argon2";
import { prisma } from "./prisma";
import { isSuperAdmin, nextNicknameNumber, formatDisplayLabel, NICKNAME_COOLDOWN_DAYS } from "./auth";
import { getActiveKeyScope } from "./requestScope";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

const MIN_PASSWORD_LENGTH = 8;

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function requireSuperAdmin(ctx: ActionContext): Promise<ActionResult | null> {
  // docs/plan-nickname-apikey-policy.md - 계정 관리는 시스템 전체 스코프라,
  // 특정 프로젝트로 좁혀 발급한 키는 그 키 소유자가 최고 관리자 본인이어도
  // 쓸 수 없다(유출된 프로젝트 키 하나가 시스템 전체 계정 관리로 번지지
  // 않게 - membership.ts의 requireMembership과 같은 원칙).
  if (getActiveKeyScope().type !== "unrestricted") {
    return fail("이 작업은 프로젝트로 범위가 제한된 API 키로는 할 수 없습니다.");
  }
  if (await isSuperAdmin(ctx.architectId)) return null;
  return fail("이 작업은 최고 관리자만 할 수 있습니다.");
}

function generateTemporaryPassword(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** 시스템 전체 계정 목록(최고 관리자 전용) - 계정 관리 화면용. */
export async function accountList(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  const guard = await requireSuperAdmin(ctx);
  if (guard) return guard;

  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, disabledAt: true, createdAt: true, nickname: true, nicknameNumber: true },
  });
  return {
    ok: true,
    data: { items: accounts.map((a) => ({ ...a, displayLabel: formatDisplayLabel(a.nickname, a.nicknameNumber) })) },
  };
}

/** 내 프로필(닉네임/표시 라벨 포함) - 로그인 응답엔 없어서 화면이 따로 조회한다. */
export async function accountMe(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  const account = await prisma.account.findUnique({ where: { id: ctx.architectId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");
  return {
    ok: true,
    data: {
      id: account.id,
      username: account.username,
      nickname: account.nickname,
      displayLabel: formatDisplayLabel(account.nickname, account.nicknameNumber),
      nicknameChangedAt: account.nicknameChangedAt,
      isSuperAdmin: await isSuperAdmin(account.id),
    },
  };
}

/**
 * 닉네임 정책(v2 계승, docs/plan-nickname-apikey-policy.md) - 닉네임은
 * 중복 가능하고, 구분을 위해 같은 문자열(또는 미설정 시 공통 풀 "설계자")
 * 안에서의 순번을 표시 라벨에 붙인다("김철수 #2"처럼) - 그 순번은 닉네임이
 * 바뀌는 시점에만 다시 계산해 확정 저장한다. 변경엔 7일 쿨다운이 있다
 * (같은 값으로 "변경"해도 실제로 안 바뀌었으면 쿨다운을 소모하지 않는다).
 */
export async function accountUpdateNickname(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { nickname } = payload ?? {};
  if (nickname !== null && typeof nickname !== "string") return fail("nickname은 문자열 또는 null이어야 합니다.");

  const account = await prisma.account.findUnique({ where: { id: ctx.architectId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");

  const trimmed = typeof nickname === "string" ? nickname.trim() : null;
  const newValue = trimmed || null;
  if (newValue === account.nickname) {
    return {
      ok: true,
      data: { nickname: account.nickname, displayLabel: formatDisplayLabel(account.nickname, account.nicknameNumber) },
    };
  }

  if (account.nicknameChangedAt) {
    const elapsedMs = Date.now() - account.nicknameChangedAt.getTime();
    const remainingDays = NICKNAME_COOLDOWN_DAYS - elapsedMs / (24 * 60 * 60 * 1000);
    if (remainingDays > 0) {
      return fail(`닉네임은 마지막 변경 후 ${NICKNAME_COOLDOWN_DAYS}일간 다시 변경할 수 없습니다(약 ${Math.ceil(remainingDays)}일 후 가능).`);
    }
  }

  const nicknameNumber = await nextNicknameNumber(newValue);
  const updated = await prisma.account.update({
    where: { id: ctx.architectId },
    data: { nickname: newValue, nicknameNumber, nicknameChangedAt: new Date() },
  });
  return { ok: true, data: { nickname: updated.nickname, displayLabel: formatDisplayLabel(updated.nickname, updated.nicknameNumber) } };
}

/** 본인이 이미 아는 현재 비밀번호로 직접 바꾼다 (v2 changeOwnPassword 계승). */
export async function accountChangePassword(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { currentPassword, newPassword } = payload ?? {};
  if (typeof currentPassword !== "string" || !currentPassword) return fail("currentPassword가 필요합니다.");
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return fail(`newPassword는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  }

  const account = await prisma.account.findUnique({ where: { id: ctx.architectId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");
  const valid = await argon2.verify(account.passwordHash, currentPassword);
  if (!valid) return fail("현재 비밀번호가 올바르지 않습니다.");

  const passwordHash = await argon2.hash(newPassword);
  await prisma.account.update({ where: { id: account.id }, data: { passwordHash } });
  return { ok: true };
}

/**
 * admin이 다른 계정의 비밀번호를 잊었을 때 대신 재설정한다(v2
 * resetPasswordAsAdmin 계승 - 이메일 발송 인프라가 없어 self-service
 * 찾기 대신 이 방식을 쓴다). 새 임시 비밀번호는 이 응답에만 평문으로
 * 실리고 어디에도 저장되지 않는다(API 키 secret과 동일한 1회 노출
 * 원칙) - 다음 로그인을 강제로 전환시키는 절차는 없다(설계자 확인,
 * v2와 동일 수준 유지).
 */
export async function accountResetPassword(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guard = await requireSuperAdmin(ctx);
  if (guard) return guard;

  const { accountId } = payload ?? {};
  if (typeof accountId !== "string" || !accountId) return fail("accountId가 필요합니다.");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await argon2.hash(temporaryPassword);
  await prisma.account.update({ where: { id: accountId }, data: { passwordHash } });

  return { ok: true, data: { username: account.username, temporaryPassword } };
}

/** 최고 관리자 전용 - 로그인을 막고, 이미 발급된 apiKey도 전부 무효화한다. */
export async function accountDisable(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guard = await requireSuperAdmin(ctx);
  if (guard) return guard;

  const { accountId } = payload ?? {};
  if (typeof accountId !== "string" || !accountId) return fail("accountId가 필요합니다.");
  if (await isSuperAdmin(accountId)) return fail("최고 관리자 계정은 비활성화할 수 없습니다.");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");

  await prisma.$transaction([
    prisma.account.update({ where: { id: accountId }, data: { disabledAt: new Date() } }),
    prisma.apiKey.deleteMany({ where: { accountId } }),
  ]);
  return { ok: true };
}

export async function accountEnable(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guard = await requireSuperAdmin(ctx);
  if (guard) return guard;

  const { accountId } = payload ?? {};
  if (typeof accountId !== "string" || !accountId) return fail("accountId가 필요합니다.");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");

  await prisma.account.update({ where: { id: accountId }, data: { disabledAt: null } });
  return { ok: true };
}

/**
 * 최고 관리자 전용 - 완전 삭제. "콘텐츠 보존"(설계자 결정,
 * docs/plan-account-management.md) 원칙에 따라 그 계정이 만든 프로젝트
 * 자체는 절대 함께 지우지 않는다 - 아직 생성자로 남아있는 프로젝트가
 * 있으면 project.transfer로 먼저 넘기라고 안내하고 거부한다(Prisma
 * 스키마의 Project.creator가 onDelete: Restrict라 실수로도 막힌다 -
 * 이 사전 검증은 그 상황을 사용자에게 친절한 메시지로 미리 알려주는
 * 역할). 멤버십/초대/API 키/개인 메모리/개인 템플릿은 그 계정 자신의
 * 소유물일 뿐 다른 사람이 참조하는 콘텐츠가 아니므로 cascade로 함께
 * 삭제된다(스키마의 onDelete: Cascade).
 */
export async function accountDelete(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guard = await requireSuperAdmin(ctx);
  if (guard) return guard;

  const { accountId } = payload ?? {};
  if (typeof accountId !== "string" || !accountId) return fail("accountId가 필요합니다.");
  if (await isSuperAdmin(accountId)) return fail("최고 관리자 계정은 삭제할 수 없습니다.");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");

  const ownedProjectCount = await prisma.project.count({ where: { creatorAccountId: accountId } });
  if (ownedProjectCount > 0) {
    return fail(
      `이 계정이 생성한 프로젝트가 ${ownedProjectCount}개 남아있습니다 - 콘텐츠 보존을 위해 project.transferOwnership으로 다른 계정에 먼저 넘긴 뒤 삭제하세요.`
    );
  }

  // 버그로 발견(실기동 검증 중) - creatorAccountId만 옮기고 ProjectMembership의
  // ADMIN 역할은 그대로 두면, 이 계정을 지우는 순간 그 멤버십 행이
  // cascade로 같이 사라져서 그 프로젝트에 Admin이 한 명도 안 남는 사고가
  // 난다("Admin은 프로젝트당 1명이 항상 있어야 한다"는 기존 불변식을
  // 계정 삭제가 우회해버림). ADMIN 역할을 가진 프로젝트가 남아있으면
  // project.transfer로 그 역할부터 다른 collaborator에게 넘기라고 막는다.
  const adminMemberships = await prisma.projectMembership.findMany({
    where: { accountId, role: "ADMIN" },
    select: { project: { select: { slug: true, creator: { select: { username: true } } } } },
  });
  if (adminMemberships.length > 0) {
    const names = adminMemberships.map((m) => `${m.project.creator.username}/${m.project.slug}`).join(", ");
    return fail(`이 계정이 Admin으로 남아있는 프로젝트가 있습니다(${names}) - project.transfer로 Admin 역할을 먼저 넘긴 뒤 삭제하세요.`);
  }

  await prisma.account.delete({ where: { id: accountId } });
  return { ok: true };
}
