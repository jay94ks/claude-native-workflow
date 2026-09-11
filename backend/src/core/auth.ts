import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { getDb } from "./db.js";
import { ensureGiteaAccountForUser } from "./giteaAccounts.js";
import { assertNotLocked, clearIdentifierAttempts, recordFailedAttempt } from "./loginRateLimit.js";

// ID/PW 계정, argon2id 비밀번호 해시, Access(JWT, 단명) + Refresh(장기,
// DB에 해시로 저장 - 원문은 저장하지 않는다) 토큰 - concept 브랜치
// tier3의 SP-00002 인증 설계를 그대로 이식(리프레시 토큰 회전, 탈취
// 감지 등 이미 실전 검증된 패턴이라 다시 설계할 이유가 없음).

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15분
const REFRESH_TOKEN_TTL_DAYS = 30;
const JWT_SECRET_MIN_LEN = 32;

// concept 세션의 QA로 발견: JWT_SECRET이 비어있지만 않으면 뭐든 그대로
// 받아줬었다 - "changeme"처럼 짧고 흔한 값을 그대로 배포해도 기동
// 시점엔 아무 신호가 없어, HS256 서명이 사실상 무차별 대입으로 위조
// 가능한 상태로 계속 운영될 수 있었다. 최소 길이만 강제해서 이런
// 흔한 실수를 배포 전에 막는다.
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET 환경변수가 필요합니다");
  if (secret.length < JWT_SECRET_MIN_LEN) {
    throw new Error(
      `JWT_SECRET이 너무 짧습니다(${secret.length}자) - 최소 ${JWT_SECRET_MIN_LEN}자 이상의 무작위 값을 쓰세요`,
    );
  }
  return secret;
}

/** connectDb()처럼 서버 기동 시 한 번 불러서 즉시 실패시킨다 - 안 그러면
 * 이 문제가 첫 로그인 시도가 들어올 때까지 조용히 숨어있다가 그제서야
 * 드러난다. */
export function assertJwtSecretConfigured(): void {
  jwtSecret();
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
}

function issueAccessToken(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username } satisfies AccessTokenPayload, jwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, jwtSecret()) as AccessTokenPayload;
}

// refresh token은 JWT가 아니라 고엔트로피 난수 문자열 - DB엔 SHA-256
// 해시만 저장한다(원문 유출 시 DB 값만으로 재구성 불가, 조회는 해시로
// 빠르게).
function generateRefreshTokenValue(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueRefreshToken(userId: string): Promise<string> {
  const value = generateRefreshTokenValue();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await getDb().refreshToken.create({
    data: { userId, tokenHash: hashRefreshToken(value), expiresAt },
  });
  return value;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  username: string;
  email?: string;
  password: string;
}

const MIN_PASSWORD_LENGTH = 8;

function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

// ---------------------------------------------------------------- 닉네임 넘버링

const DEFAULT_NICKNAME_LABEL = "설계자";
const NICKNAME_COOLDOWN_DAYS = 7;

/** nickname이 null인 계정은 표시상 공통 라벨 "설계자"를 쓴다 - where
 * 절도 그 규칙 그대로: label이 "설계자"면 nickname IS NULL인 행들이
 * 그 풀, 아니면 nickname === label인 행들이 그 풀. */
function nicknameWhereForLabel(label: string) {
  return label === DEFAULT_NICKNAME_LABEL ? { nickname: null } : { nickname: label };
}

/** 그 라벨 풀 안에서 다음 순번(1부터) - 매번 다시 세지 않고 닉네임이
 * 바뀌는 시점(가입 시 "설계자" 풀 편입 포함)에만 계산해 User.nicknameNumber
 * 에 확정 저장한다. */
async function nextNicknameNumber(db: ReturnType<typeof getDb>, label: string): Promise<number> {
  const top = await db.user.findFirst({
    where: nicknameWhereForLabel(label),
    orderBy: { nicknameNumber: "desc" },
    select: { nicknameNumber: true },
  });
  return (top?.nicknameNumber ?? 0) + 1;
}

function formatDisplayLabel(nickname: string | null, nicknameNumber: number): string {
  return `${nickname ?? DEFAULT_NICKNAME_LABEL} #${nicknameNumber}`;
}

export async function register(
  input: RegisterInput,
): Promise<{ id: string; username: string; email: string | null }> {
  const db = getDb();
  // 실측 중 발견 - 길이 검증이 전혀 없어 1글자 비밀번호도 그대로
  // 통과했다. 이 시스템은 개인 PC뿐 아니라 서버/클라우드 배포도
  // 대상이라(README 참고) 최소 길이는 있어야 한다.
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`);
  }
  const existing = await db.user.findFirst({
    where: {
      OR: [{ username: input.username }, ...(input.email ? [{ email: input.email }] : [])],
    },
  });
  if (existing) {
    throw new AuthError(
      existing.username === input.username ? "이미 사용 중인 아이디입니다" : "이미 사용 중인 이메일입니다",
    );
  }
  const passwordHash = await hashPassword(input.password);
  const nicknameNumber = await nextNicknameNumber(db, DEFAULT_NICKNAME_LABEL);
  const user = await db.user.create({
    data: { username: input.username, email: input.email ?? null, passwordHash, nicknameNumber },
  });
  // Gitea 사용자 계정 마스터링 - ensureGiteaAccountForUser()는 내부에서
  // 모든 실패를 잡아 로그만 남기고 절대 throw하지 않으므로, 가입
  // 자체가 이 때문에 막힐 일은 없다(Gitea 네트워크 실패 등으로 여기서
  // 못 만들어도 부팅 시 보완 스윕이 다음 재기동에서 재시도 -
  // core/giteaAccounts.ts 참고). await로 가입 응답 시점에 이미 계정이
  // 만들어져 있게 한다.
  await ensureGiteaAccountForUser(user.id);
  return { id: user.id, username: user.username, email: user.email };
}

// 설계자 확정 - 최초 설치 시 계정이 하나도 없으면 관리자 계정을 id=admin,
// password=12345678로 항상 만들어둔다(다른 값으로 바뀌지 않음 - 보안
// 지침(예: 무작위 초기 비밀번호 발급)과 어긋나더라도 이 값 그대로
// 고정하라는 명시적 지시). 계정이 이미 하나라도 있으면(이 시드가 이미
// 실행됐거나 설계자가 직접 가입했거나) 절대 건드리지 않는다 - 순수
// "빈 설치를 부팅 가능한 상태로 만드는" 1회성 동작.
export const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "12345678";

export async function seedDefaultAdminAccount(): Promise<void> {
  const db = getDb();
  const userCount = await db.user.count();
  if (userCount > 0) return;
  await register({ username: DEFAULT_ADMIN_USERNAME, password: DEFAULT_ADMIN_PASSWORD });
}

// admin 계정은 항상 최고 관리자다(설계자 확정 - 모든 역할/관리자 판정을
// 우회한다). username은 가입 후 절대 안 바뀌므로(프로필 수정에
// username 필드가 없음) 한 번 찾은 id를 프로세스 수명 동안 캐시해도
// 안전하다 - 못 찾았을 때만(아직 시드 전 등) 매번 재조회한다.
let cachedAdminUserId: string | null = null;

export async function isSuperAdmin(userId: string): Promise<boolean> {
  if (!cachedAdminUserId) {
    const db = getDb();
    const admin = await db.user.findUnique({ where: { username: DEFAULT_ADMIN_USERNAME } });
    cachedAdminUserId = admin?.id ?? null;
  }
  return cachedAdminUserId === userId;
}

export async function login(usernameOrEmail: string, password: string, clientIp: string): Promise<AuthResult> {
  assertNotLocked(usernameOrEmail, clientIp);
  const db = getDb();
  const user = await db.user.findFirst({
    where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
  });
  if (!user) {
    recordFailedAttempt(usernameOrEmail, clientIp);
    throw new AuthError("아이디/이메일 또는 비밀번호가 올바르지 않습니다");
  }
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    recordFailedAttempt(usernameOrEmail, clientIp);
    throw new AuthError("아이디/이메일 또는 비밀번호가 올바르지 않습니다");
  }
  clearIdentifierAttempts(usernameOrEmail);
  return {
    access_token: issueAccessToken(user.id, user.username),
    refresh_token: await issueRefreshToken(user.id),
  };
}

/** 리프레시 토큰 회전(rotation) - 쓴 토큰은 즉시 폐기하고 새로 하나 발급해서
 * 반환한다. 탈취된 토큰이 재사용되면 그 순간 이미 폐기돼 있어 실패한다. */
export async function refresh(refreshTokenValue: string): Promise<AuthResult> {
  const db = getDb();
  const tokenHash = hashRefreshToken(refreshTokenValue);
  const record = await db.refreshToken.findFirst({ where: { tokenHash } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AuthError("유효하지 않거나 만료된 refresh token입니다");
  }
  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new AuthError("사용자를 찾을 수 없습니다");

  await db.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  return {
    access_token: issueAccessToken(user.id, user.username),
    refresh_token: await issueRefreshToken(user.id),
  };
}

export async function logout(refreshTokenValue: string): Promise<void> {
  const db = getDb();
  const tokenHash = hashRefreshToken(refreshTokenValue);
  await db.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------- 프로필

export interface MeProfile {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  emailVisible: boolean;
  phoneVisible: boolean;
  nickname: string | null;
  nicknameNumber: number;
  displayLabel: string;
  nicknameChangedAt: string | null;
  giteaUsername: string | null;
  isSuperAdmin: boolean;
}

export async function getMe(userId: string): Promise<MeProfile> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError(`사용자를 찾을 수 없습니다: ${userId}`);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    emailVisible: user.emailVisible,
    phoneVisible: user.phoneVisible,
    nickname: user.nickname,
    nicknameNumber: user.nicknameNumber,
    displayLabel: formatDisplayLabel(user.nickname, user.nicknameNumber),
    nicknameChangedAt: user.nicknameChangedAt ? user.nicknameChangedAt.toISOString() : null,
    giteaUsername: user.giteaUsername,
    isSuperAdmin: await isSuperAdmin(user.id),
  };
}

export interface UpdateMeInput {
  email?: string;
  phone?: string;
  emailVisible?: boolean;
  phoneVisible?: boolean;
  nickname?: string;
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<MeProfile> {
  const db = getDb();
  const current = await db.user.findUnique({ where: { id: userId } });
  if (!current) throw new AuthError(`사용자를 찾을 수 없습니다: ${userId}`);

  let nicknameUpdate: { nickname: string | null; nicknameNumber: number; nicknameChangedAt: Date } | undefined;
  if (input.nickname !== undefined) {
    const trimmed = input.nickname.trim();
    const newValue = trimmed || null;
    if (newValue !== current.nickname) {
      if (current.nicknameChangedAt) {
        const elapsedMs = Date.now() - current.nicknameChangedAt.getTime();
        const remainingDays = NICKNAME_COOLDOWN_DAYS - elapsedMs / (24 * 60 * 60 * 1000);
        if (remainingDays > 0) {
          throw new AuthError(
            `닉네임은 마지막 변경 후 ${NICKNAME_COOLDOWN_DAYS}일간 다시 변경할 수 없습니다(약 ${Math.ceil(remainingDays)}일 후 가능)`,
          );
        }
      }
      const label = newValue ?? DEFAULT_NICKNAME_LABEL;
      const nicknameNumber = await nextNicknameNumber(db, label);
      nicknameUpdate = { nickname: newValue, nicknameNumber, nicknameChangedAt: new Date() };
    }
  }

  const user = await db.user.update({
    where: { id: userId },
    data: {
      email: input.email !== undefined ? input.email.trim() || null : undefined,
      phone: input.phone !== undefined ? input.phone.trim() || null : undefined,
      emailVisible: input.emailVisible,
      phoneVisible: input.phoneVisible,
      ...nicknameUpdate,
    },
  });
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    emailVisible: user.emailVisible,
    phoneVisible: user.phoneVisible,
    nickname: user.nickname,
    nicknameNumber: user.nicknameNumber,
    displayLabel: formatDisplayLabel(user.nickname, user.nicknameNumber),
    nicknameChangedAt: user.nicknameChangedAt ? user.nicknameChangedAt.toISOString() : null,
    giteaUsername: user.giteaUsername,
    isSuperAdmin: await isSuperAdmin(user.id),
  };
}

export interface PublicProfile {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  nickname: string | null;
  nicknameNumber: number;
  displayLabel: string;
}

/** 본인이면 email/phone 전체 공개, 아니면 emailVisible/phoneVisible에
 * 따라 가린다 - username/id는 이미 CLI 로그인 아이디로도 쓰이는 값이라
 * 민감정보로 취급하지 않고 항상 공개. 닉네임(표시용 라벨)도 애초에
 * 비공개 개념이 아니라 항상 공개(emailVisible류 토글 대상 아님). */
export async function getPublicProfile(viewerId: string, targetUserId: string): Promise<PublicProfile> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new AuthError(`사용자를 찾을 수 없습니다: ${targetUserId}`);
  const isSelf = viewerId === targetUserId;
  return {
    id: user.id,
    username: user.username,
    email: isSelf || user.emailVisible ? user.email : null,
    phone: isSelf || user.phoneVisible ? user.phone : null,
    nickname: user.nickname,
    nicknameNumber: user.nicknameNumber,
    displayLabel: formatDisplayLabel(user.nickname, user.nicknameNumber),
  };
}

export interface UserListItem {
  id: string;
  username: string;
  displayLabel: string;
}

/** 사용자 선택기(엔티티 선택기의 kind="user")용 - username/닉네임
 * 부분 일치 검색. 이 시스템엔 조직 간 격리가 없어(단일 설치) 로그인한
 * 누구나 설계자 목록을 볼 수 있다 - 프로젝트 멤버/팀장 추가처럼 "이미
 * 존재하는 계정을 골라야 하는" 자리에서 재사용한다. */
export async function listUsers(search?: string, limit = 50): Promise<UserListItem[]> {
  const db = getDb();
  const trimmed = search?.trim();
  const rows = await db.user.findMany({
    where: trimmed
      ? {
          OR: [
            { username: { contains: trimmed } },
            { nickname: { contains: trimmed } },
          ],
        }
      : undefined,
    orderBy: { username: "asc" },
    take: limit,
  });
  return rows.map((u: { id: string; username: string; nickname: string | null; nicknameNumber: number }) => ({
    id: u.id,
    username: u.username,
    displayLabel: formatDisplayLabel(u.nickname, u.nicknameNumber),
  }));
}

export interface AdminUserListItem {
  id: string;
  username: string;
  email: string | null;
  nickname: string | null;
  displayLabel: string;
  createdAt: string;
}

/** admin 전용 "사용자 관리" 화면용 - listUsers()(엔티티 선택기용,
 * {id,username,displayLabel}만)와 달리 이메일/가입일까지 포함한다.
 * 다른 화면이 listUsers()의 좁은 응답 모양에 의존하므로 그 함수는
 * 그대로 두고 이 함수를 따로 둔다. admin 여부 확인은 라우트의
 * requireSuperAdmin이 담당(이 함수 자체는 조회만). */
export async function listAllUsersForAdmin(): Promise<AdminUserListItem[]> {
  const db = getDb();
  const rows = await db.user.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(
    (u: { id: string; username: string; email: string | null; nickname: string | null; nicknameNumber: number; createdAt: Date }) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      nickname: u.nickname,
      displayLabel: formatDisplayLabel(u.nickname, u.nicknameNumber),
      createdAt: u.createdAt.toISOString(),
    }),
  );
}

function generateTemporaryPassword(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** admin이 다른 설계자의 비밀번호를 잊었을 때 대신 재설정한다(이
 * 시스템엔 이메일 발송 인프라가 없어 self-service 플로우 대신 이
 * 방식을 택함 - "admin이 곧 설치자"라는 기존 전제와 일치). 새 임시
 * 비밀번호는 이 반환값에만 평문으로 담기고 어디에도 저장되지 않는다
 * (API 키 secret 발급과 동일한 "1회 노출" 원칙). admin 여부 확인은
 * 라우트의 requireSuperAdmin이 담당 - 이 함수는 대상 존재만 검증. */
export async function resetPasswordAsAdmin(targetUserId: string): Promise<{ username: string; temporaryPassword: string }> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new AuthError(`사용자를 찾을 수 없습니다: ${targetUserId}`);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.user.update({ where: { id: targetUserId }, data: { passwordHash } });
  return { username: user.username, temporaryPassword };
}
