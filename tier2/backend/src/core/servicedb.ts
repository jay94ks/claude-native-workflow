import path from "node:path";
import type { DbConfig } from "./config.js";

// SP-00001 6절 선택적 서비스 DB. Prisma는 스키마 하나당 provider가
// 고정이라(런타임에 못 바꿈) prisma/schema.{mysql,postgres,sqlite}.prisma
// 세 개를 각자 다른 output(generated/<driver>/)으로 생성해두고, 여기서
// driver에 맞는 걸 동적으로 골라 부른다. 세 클라이언트는 모델이 동일해서
// 구조적으로 호환되므로, 우리가 실제 쓰는 부분만 아래 ServiceClient로
// 좁혀서 다룬다(생성기가 다른 세 타입을 하나로 취급하기 위한 캐스팅).
//
// `generated/`는 `npm run db:generate`(각 스키마 `prisma generate`)의
// 산출물이라 커밋하지 않는다(.gitignore) - 이 파일을 쓰는 코드를 빌드하기
// 전에 먼저 한 번 실행해야 한다(package.json `build` 스크립트가 이미
// db:generate를 먼저 돌리도록 되어 있음).

export interface DocCommentRow {
  id: number;
  docPath: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ServiceClient {
  docComment: {
    findMany(args?: { where?: { docPath?: string }; orderBy?: { id: "asc" | "desc" } }): Promise<DocCommentRow[]>;
    count(): Promise<number>;
    create(args: { data: { id?: number; docPath: string; body: string; createdAt: string; resolvedAt: string | null } }): Promise<DocCommentRow>;
    update(args: { where: { id: number }; data: { resolvedAt: string } }): Promise<DocCommentRow>;
    deleteMany(): Promise<{ count: number }>;
  };
  $disconnect(): Promise<void>;
  $executeRawUnsafe(query: string): Promise<number>;
}

type PrismaClientCtor = new (opts: { datasourceUrl: string }) => ServiceClient;

// The three generated clients are structurally near-identical (same models)
// but nominally distinct types, and each PrismaClient's real constructor
// type is far richer than the sliver of it (ServiceClient) we actually use -
// hence the through-unknown cast TS asks for on a deliberate narrowing.
async function loadClientCtor(driver: DbConfig["driver"]): Promise<PrismaClientCtor> {
  if (driver === "mysql" || driver === "mariadb") {
    const mod = await import("../../generated/mysql/index.js");
    return mod.PrismaClient as unknown as PrismaClientCtor;
  }
  if (driver === "postgres") {
    const mod = await import("../../generated/postgres/index.js");
    return mod.PrismaClient as unknown as PrismaClientCtor;
  }
  const mod = await import("../../generated/sqlite/index.js");
  return mod.PrismaClient as unknown as PrismaClientCtor;
}

export function buildConnectionUrl(driver: DbConfig["driver"], connection: Record<string, unknown>): string {
  if (driver === "sqlite") {
    // path.resolve (not a bare string concat) so a relative path resolves
    // against cwd properly and a native absolute path (C:\... on Windows)
    // round-trips correctly - Prisma's sqlite connector is picky about
    // `file:` URL shape (e.g. a raw Git-Bash-style "/c/Users/..." string is
    // neither a valid POSIX absolute path nor a Windows one).
    const file = path.resolve(String(connection.file ?? "docs/.workflow/service.db"));
    return `file:${file}`;
  }
  const host = String(connection.host ?? "localhost");
  const port = Number(connection.port ?? (driver === "postgres" ? 5432 : 3306));
  const user = String(connection.user ?? "");
  const password = connection.password !== undefined ? String(connection.password) : "";
  const database = String(connection.database ?? "");
  const scheme = driver === "postgres" ? "postgresql" : "mysql"; // mariadb -> mysql 커넥터 (DC-00001 RP-00004)
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `${scheme}://${auth}@${host}:${port}/${database}`;
}

export async function connectServiceClient(driver: DbConfig["driver"], url: string): Promise<ServiceClient> {
  const Ctor = await loadClientCtor(driver);
  return new Ctor({ datasourceUrl: url });
}
