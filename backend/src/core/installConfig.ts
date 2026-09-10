import { getDb } from "./db.js";

const SINGLETON_ID = "singleton";

export interface InstallConfig {
  institutionsEnabled: boolean;
}

/** 싱글턴 InstallConfig 행을 읽는다 - 없으면 기본값(institutionsEnabled
 * true, 스키마 @default와 동일)으로 만들어서 반환한다. 이 토글을 바꾸는
 * 쓰기 API는 아직 없음(웹 UI 첫 조각은 읽기만 필요 - 관리 화면에서
 * 기관 메뉴를 보여줄지 결정하는 용도). */
export async function getInstallConfig(): Promise<InstallConfig> {
  const db = getDb();
  const row = await db.installConfig.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return { institutionsEnabled: row.institutionsEnabled };
}
