import * as argon2 from "argon2";
import { prisma } from "./prisma";
import { generateApiKey, hashApiKey } from "./crypto";

export class AuthError extends Error {}

export interface LoginResult {
  architectId: string;
  apiKey: string;
}

/** Username/password login (docs/design-notes.md "회원가입/초대 절차"). */
export async function login(username: string, password: string): Promise<LoginResult> {
  const account = await prisma.account.findUnique({ where: { username } });
  if (!account) throw new AuthError("invalid username or password");

  const valid = await argon2.verify(account.passwordHash, password);
  if (!valid) throw new AuthError("invalid username or password");

  const apiKey = generateApiKey();
  await prisma.apiKey.create({
    data: { accountId: account.id, keyHash: hashApiKey(apiKey) },
  });

  return { architectId: account.id, apiKey };
}

/** Anyone can self-register an account; project membership is a separate, invite-only step. */
export async function signup(username: string, password: string): Promise<{ architectId: string }> {
  const existing = await prisma.account.findUnique({ where: { username } });
  if (existing) throw new AuthError("username already taken");

  const passwordHash = await argon2.hash(password);
  const account = await prisma.account.create({ data: { username, passwordHash } });
  return { architectId: account.id };
}

export async function resolveApiKey(rawKey: string): Promise<{ architectId: string } | null> {
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } });
  if (!key) return null;
  return { architectId: key.accountId };
}
