import * as argon2 from "argon2";
import { prisma } from "./prisma";
import { generateApiKey, hashApiKey, apiKeyPrefix } from "./crypto";
import type { KeyScope } from "./requestScope";

export class AuthError extends Error {}

export interface LoginResult {
  architectId: string;
  apiKey: string;
}

// docs/plan-account-management.md - v2의 isSuperAdmin() 패턴을 그대로 계승:
// 별도 role 컬럼 없이 부트스트랩 계정(username "admin")을 곧 최고 관리자로
// 취급한다("admin이 곧 설치자"라는 전제, v2 core/auth.ts에서 확인). username은
// 가입 후 바뀌지 않으므로 한 번 찾은 id를 프로세스 수명 동안 캐시해도 안전하다.
const BOOTSTRAP_ADMIN_USERNAME = "admin";
let cachedSuperAdminId: string | null = null;

export async function isSuperAdmin(accountId: string): Promise<boolean> {
  if (!cachedSuperAdminId) {
    const admin = await prisma.account.findUnique({ where: { username: BOOTSTRAP_ADMIN_USERNAME } });
    cachedSuperAdminId = admin?.id ?? null;
  }
  return cachedSuperAdminId === accountId;
}

// docs/plan-nickname-apikey-policy.md - v2 nextNicknameNumber() 계승: 닉네임이
// null인 계정은 공통 라벨 풀("설계자")을 쓰고, 있으면 그 문자열 자체가 풀
// 키다. 이 풀 안에서 다음 순번(1부터) - 매번 다시 세지 않고 닉네임이 바뀌는
// 시점(가입 시 기본 풀 편입 포함)에만 계산해 Account.nicknameNumber에
// 확정 저장한다(accounts.ts의 changeNickname()이 재사용).
export async function nextNicknameNumber(nickname: string | null): Promise<number> {
  const top = await prisma.account.findFirst({
    where: { nickname },
    orderBy: { nicknameNumber: "desc" },
    select: { nicknameNumber: true },
  });
  return (top?.nicknameNumber ?? 0) + 1;
}

const DEFAULT_NICKNAME_LABEL = "설계자";
export const NICKNAME_COOLDOWN_DAYS = 7;

export function formatDisplayLabel(nickname: string | null, nicknameNumber: number): string {
  return `${nickname ?? DEFAULT_NICKNAME_LABEL} #${nicknameNumber}`;
}

/** Username/password login (docs/design-notes.md "회원가입/초대 절차"). */
export async function login(username: string, password: string): Promise<LoginResult> {
  const account = await prisma.account.findUnique({ where: { username } });
  if (!account) throw new AuthError("invalid username or password");

  const valid = await argon2.verify(account.passwordHash, password);
  if (!valid) throw new AuthError("invalid username or password");

  // docs/plan-account-management.md - 비활성화된 계정은 자격증명이 맞아도
  // 로그인 자체를 거부한다(account.disable이 기존 apiKey를 이미 지우지만,
  // 여기서도 한 번 더 막아 재로그인 자체를 원천 차단한다).
  if (account.disabledAt) throw new AuthError("this account has been disabled");

  // docs/plan-nickname-apikey-policy.md - 로그인이 발급하는 키는 항상
  // personal(무제한) 스코프다 - v2도 로그인(JWT)을 unrestricted와 동급으로
  // 취급했다. 프로젝트로 범위를 좁힌 키는 account.createApiKey로 별도 발급.
  const apiKey = generateApiKey();
  await prisma.apiKey.create({
    data: { accountId: account.id, keyHash: hashApiKey(apiKey), keyPrefix: apiKeyPrefix(apiKey), scope: "personal" },
  });

  return { architectId: account.id, apiKey };
}

/** Anyone can self-register an account; project membership is a separate, invite-only step. */
export async function signup(username: string, password: string): Promise<{ architectId: string }> {
  const existing = await prisma.account.findUnique({ where: { username } });
  if (existing) throw new AuthError("username already taken");

  const passwordHash = await argon2.hash(password);
  // docs/plan-nickname-apikey-policy.md - 신규 계정은 항상 nickname null로
  // 시작하므로("설계자" 공통 풀) 그 풀의 다음 순번을 실제로 계산해 저장한다
  // (스키마 기본값 1을 그대로 두면 모든 신규 계정이 "설계자 #1"로 겹친다).
  const nicknameNumber = await nextNicknameNumber(null);
  const account = await prisma.account.create({ data: { username, passwordHash, nicknameNumber } });
  return { architectId: account.id };
}

export interface ResolvedApiKey {
  architectId: string;
  scope: KeyScope;
}

export async function resolveApiKey(rawKey: string): Promise<ResolvedApiKey | null> {
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } });
  if (!key) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt <= new Date()) return null;

  // 매 요청마다 쓰지만 응답을 기다릴 필요는 없는 부수 기록 - 관리 화면의
  // "마지막 사용 시각"으로 오래된/미사용 키를 판단하는 용도(v2 계승).
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  const scope: KeyScope = key.scope === "project" && key.projectId ? { type: "project", projectId: key.projectId } : { type: "unrestricted" };
  return { architectId: key.accountId, scope };
}
