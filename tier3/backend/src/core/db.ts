// SP-00002 6절: Tier 3는 DB가 항상 켜져 있다(비활성 옵션 없음 - 계정/권한이
// DB 없이는 성립하지 않는다). Tier 2의 servicedb.ts와 달리 토글이 없으므로
// 여기서는 그 파일을 재사용하지 않고 별도로 한 번 연결해서 프로세스 내내
// 재사용한다. 세 provider(mysql/postgres/sqlite)가 모델은 동일하고
// datasource/output만 다른 별도 Prisma 클라이언트로 생성되므로(Tier 2의
// prisma/schema.*.prisma 참고), mysql 쪽 타입을 대표로 가져와 쓰고 런타임에
// 실제 driver의 생성자로 교체한다 - 세 클라이언트가 구조적으로 동일해서
// 안전한 캐스팅이다.
import type { PrismaClient } from "@claude-native-workflow/tier2-backend/generated/mysql/index.js";

export type Driver = "mysql" | "mariadb" | "postgres" | "sqlite";

type ClientCtor = new (opts: { datasourceUrl: string }) => PrismaClient;

async function loadClientCtor(driver: Driver): Promise<ClientCtor> {
  if (driver === "postgres") {
    const mod = await import("@claude-native-workflow/tier2-backend/generated/postgres/index.js");
    return mod.PrismaClient as unknown as ClientCtor;
  }
  if (driver === "sqlite") {
    const mod = await import("@claude-native-workflow/tier2-backend/generated/sqlite/index.js");
    return mod.PrismaClient as unknown as ClientCtor;
  }
  // mariadb -> mysql 커넥터로 호환(DC-00001 RP-00004, SP-00002 6절)
  const mod = await import("@claude-native-workflow/tier2-backend/generated/mysql/index.js");
  return mod.PrismaClient as unknown as ClientCtor;
}

let client: PrismaClient | null = null;

/** 프로세스 기동 시 한 번 연결(DATABASE_URL/DB_DRIVER 환경변수 필요, 없으면
 * 즉시 실패 - "DB 없이는 계정/권한이 성립하지 않는다"는 원칙을 시작부터
 * 강제한다. 이후 호출은 이미 연결된 클라이언트를 그대로 재사용). */
export async function connectDb(): Promise<PrismaClient> {
  if (client) return client;
  const driver = (process.env.DB_DRIVER as Driver | undefined) ?? "mysql";
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL 환경변수가 필요합니다 (SP-00002 6절: Tier 3는 DB가 항상 켜져 있어야 합니다)",
    );
  }
  const Ctor = await loadClientCtor(driver);
  client = new Ctor({ datasourceUrl: url });
  return client;
}

export function getDb(): PrismaClient {
  if (!client) {
    throw new Error("connectDb()를 먼저 호출해야 합니다");
  }
  return client;
}
