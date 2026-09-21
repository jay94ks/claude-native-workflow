import * as crypto from "crypto";

/** Raw API key handed to the caller once; only its hash is ever stored. */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// docs/plan-nickname-apikey-policy.md - v2의 keyPrefix 계승: 목록 화면에서
// 원문(secret)을 다시 보여줄 수 없으니(1회 노출 원칙) 구분용으로 앞부분만
// 저장해둔다.
export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 10);
}
