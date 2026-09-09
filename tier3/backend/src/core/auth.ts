import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { getDb } from "./db.js";

// SP-00002 1~2절: ID/PW 계정, argon2id 비밀번호 해시, Access(JWT, 단명) +
// Refresh(장기, DB에 해시로 저장 - 원문은 저장하지 않는다) 토큰.

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15분
const REFRESH_TOKEN_TTL_DAYS = 30;

// QA로 발견: JWT_SECRET이 비어있지만 않으면 뭐든 그대로 받아줬다 -
// "changeme"처럼 짧고 흔한 값을 그대로 배포해도 기동 시점엔 아무 신호가
// 없었다는 뜻(그 상태로는 HS256 서명이 사실상 무차별 대입으로 위조
// 가능). 최소 길이만 강제해서 최소한 이런 명백히 약한 값은 기동 자체를
// 막는다 - 실제 무작위성까지 검증할 순 없지만(길이만 볼 뿐), 값을 아예
// 안 채우거나 짧게 대충 채우는 흔한 실수는 배포 전에 걸린다.
const JWT_SECRET_MIN_LEN = 32;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET 환경변수가 필요합니다");
  if (secret.length < JWT_SECRET_MIN_LEN) {
    throw new Error(`JWT_SECRET이 너무 짧습니다(${secret.length}자) - 최소 ${JWT_SECRET_MIN_LEN}자 이상의 무작위 값을 쓰세요`);
  }
  return secret;
}

/** connectDb()처럼 서버 기동 시 한 번 불러서 즉시 실패시킨다 - 안 그러면
 * 이 문제가 첫 로그인 시도가 들어올 때까지 조용히 숨어있다가 그제서야
 * 400으로 드러난다(실제로 그렇게 재현해서 확인함). */
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

// refresh token은 JWT가 아니라 고엔트로피 난수 문자열 - DB엔 SHA-256 해시만
// 저장한다(원문 유출 시 DB 값만으로 재구성 불가, 조회는 해시로 빠르게).
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
  email: string;
  password: string;
}

export async function register(input: RegisterInput): Promise<{ id: string; username: string; email: string }> {
  const db = getDb();
  const existing = await db.user.findFirst({
    where: { OR: [{ username: input.username }, { email: input.email }] },
  });
  if (existing) {
    throw new AuthError(
      existing.username === input.username ? "이미 사용 중인 아이디입니다" : "이미 사용 중인 이메일입니다",
    );
  }
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await db.user.create({
    data: { username: input.username, email: input.email, passwordHash },
  });
  return { id: user.id, username: user.username, email: user.email };
}

export async function login(usernameOrEmail: string, password: string): Promise<AuthResult> {
  const db = getDb();
  const user = await db.user.findFirst({
    where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
  });
  if (!user) throw new AuthError("아이디/이메일 또는 비밀번호가 올바르지 않습니다");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw new AuthError("아이디/이메일 또는 비밀번호가 올바르지 않습니다");
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
