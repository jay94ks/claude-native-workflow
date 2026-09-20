import * as crypto from "crypto";

/** Raw API key handed to the caller once; only its hash is ever stored. */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}
