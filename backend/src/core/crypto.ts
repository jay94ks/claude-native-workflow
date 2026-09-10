import crypto from "node:crypto";

// git 자격증명 저장용 AES-256-GCM 암호화. GCM을 쓰는 이유 - 단순 CBC와
// 달리 위변조 탐지용 인증 태그가 같이 나와서, 저장된 값이 변조됐는지도
// 복호화 시점에 검증 가능(암호문만 있고 무결성 확인이 없는 CBC보다 안전).
// 키는 CREDENTIAL_ENCRYPTION_KEY 환경변수(32바이트, hex 64자로 인코딩해
// 받음)에서 가져온다 - concept 세션에서 JWT_SECRET을 길이 검증 없이
// 아무 값이나 받아주다가 나중에야 문제를 발견했던 실수를 반복하지 않기
// 위해, 여기도 서버 기동 시점에 즉시 검증해 fail-fast시킨다.

const KEY_BYTES = 32; // AES-256
const KEY_HEX_LEN = KEY_BYTES * 2;
const IV_BYTES = 12; // GCM 권장 nonce 길이
const AUTH_TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY 환경변수가 필요합니다");
  }
  if (hex.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY은 ${KEY_HEX_LEN}자리 hex(32바이트)여야 합니다(현재 ${hex.length}자) - ` +
        "openssl rand -hex 32 로 생성하세요",
    );
  }
  return Buffer.from(hex, "hex");
}

/** connectDb()/assertJwtSecretConfigured()처럼 서버 기동 시 한 번 불러서
 * 즉시 실패시킨다 - 안 그러면 이 문제가 첫 자격증명 저장 요청이 들어올
 * 때까지 조용히 숨어있다가 그제서야 드러난다. */
export function assertCredentialEncryptionKeyConfigured(): void {
  encryptionKey();
}

// 저장 포맷: iv(12) + authTag(16) + ciphertext, 전부 이어붙여 하나의
// Buffer로. 컬럼이 Bytes 하나뿐이라 별도 컬럼 세 개로 안 쪼개도 되게.
export function encryptSecret(plaintext: string): Buffer {
  const key = encryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptSecret(payload: Buffer): string {
  const key = encryptionKey();
  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}
