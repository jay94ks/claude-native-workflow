// 런타임에 DB_DRIVER 환경변수로 postgres/mysql/sqlite 중 하나를 골라 그
// 드라이버용으로 생성된 Prisma 클라이언트를 동적 import한다 - concept
// 브랜치(tier2/backend의 db.ts/servicedb.ts)에서 이미 검증한 패턴.
// 세 클라이언트는 스키마 모델이 동일해서 구조적으로는 호환되지만,
// TypeScript가 "어느 걸 골랐는지"를 정적으로 알 수 없으므로 반환
// 타입은 any로 둔다 - 호출부는 core/*.ts의 각 함수를 통해서만 접근하므로
// 실사용 코드에서 타입 안전성이 크게 손해보진 않는다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

const DRIVERS: Record<string, string> = {
  postgres: "../../generated/postgres/index.js",
  postgresql: "../../generated/postgres/index.js",
  mysql: "../../generated/mysql/index.js",
  sqlite: "../../generated/sqlite/index.js",
};

export async function connectDb(): Promise<void> {
  const driver = (process.env.DB_DRIVER ?? "sqlite").toLowerCase();
  const modPath = DRIVERS[driver];
  if (!modPath) {
    throw new Error(`알 수 없는 DB_DRIVER: ${driver} (postgres|mysql|sqlite 중 하나)`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 환경변수가 필요합니다");
  }
  const mod = await import(modPath);
  client = new mod.PrismaClient();
  // 실제로 연결이 되는지 여기서 확인 - 연결 실패를 첫 쿼리 시점까지
  // 미루지 않고 기동 시점에 fail-fast(JWT_SECRET/CREDENTIAL_ENCRYPTION_KEY
  // 검증과 같은 원칙).
  await client.$connect();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any {
  if (!client) {
    throw new Error("DB가 아직 연결되지 않았습니다 - connectDb()를 먼저 호출하세요");
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
