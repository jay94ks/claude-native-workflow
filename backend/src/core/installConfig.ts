import crypto from "node:crypto";
import { getDb } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

const SINGLETON_ID = "singleton";

export interface InstallConfig {
  teamsEnabled: boolean;
}

/** 싱글턴 InstallConfig 행을 읽는다 - 없으면 기본값(teamsEnabled
 * true, 스키마 @default와 동일)으로 만들어서 반환한다. 이 토글을 바꾸는
 * 쓰기 API는 아직 없음(웹 UI 첫 조각은 읽기만 필요 - 관리 화면에서
 * 팀 메뉴를 보여줄지 결정하는 용도). */
export async function getInstallConfig(): Promise<InstallConfig> {
  const db = getDb();
  const row = await db.installConfig.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return { teamsEnabled: row.teamsEnabled };
}

/** Gitea 시스템 웹훅 서명 검증용 시크릿 - 없으면 새로 생성해 암호화
 * 저장한 뒤 반환한다(멱등 - 이미 있으면 복호화만). 새 환경변수 없이
 * 서버가 스스로 발급·보관한다. */
export async function getOrCreateGiteaSystemWebhookSecret(): Promise<string> {
  const db = getDb();
  const row = await db.installConfig.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  if (row.giteaSystemWebhookSecretEncrypted) {
    return decryptSecret(row.giteaSystemWebhookSecretEncrypted);
  }
  const secret = crypto.randomBytes(24).toString("hex");
  await db.installConfig.update({
    where: { id: SINGLETON_ID },
    data: { giteaSystemWebhookSecretEncrypted: encryptSecret(secret) },
  });
  return secret;
}

/** 읽기 전용 조회 - 웹훅 요청마다 서명 검증에 쓴다. 아직 발급된 적이
 * 없으면 null(부팅 시 ensureGiteaSystemWebhookConfigured()가 미리
 * 발급해두므로 정상 흐름에서는 null이 드물다). */
export async function getGiteaSystemWebhookSecret(): Promise<string | null> {
  const db = getDb();
  const row = await db.installConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!row?.giteaSystemWebhookSecretEncrypted) return null;
  return decryptSecret(row.giteaSystemWebhookSecretEncrypted);
}
