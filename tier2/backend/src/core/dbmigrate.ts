import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, type DbConfig } from "./config.js";
import { getLocalDb } from "./localdb.js";
import { buildConnectionUrl, connectServiceClient, type DocCommentRow } from "./servicedb.js";

// SP-00001 6절 "켜기/끄기 절차 (양방향 무손실)". `docs_index`는 순수 캐시라
// 이관 대상이 아니고(다음 조회에서 재생성됨), `doc_comments`만 원본
// 데이터라 행 개수까지 검증하며 옮긴다. 검증 실패 시 `docs/.config.json`을
// 건드리지 않고 그대로 실패한다 - "설정값만 바뀌고 데이터가 붕 뜨는" 상태를
// 만들지 않는다는 원칙(SP-00001 6절).

// prisma/schema.*.prisma는 이 backend 패키지 자신의 소스 트리에 있다
// (docs/ 쪽이 아니라) - dist/core/dbmigrate.js 기준 상대 경로로 찾는다.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function schemaPathFor(driver: DbConfig["driver"]): string {
  const file = driver === "mysql" || driver === "mariadb" ? "schema.mysql.prisma"
    : driver === "postgres" ? "schema.postgres.prisma"
    : "schema.sqlite.prisma";
  return path.join(BACKEND_ROOT, "prisma", file);
}

const PRISMA_CLI = path.join(BACKEND_ROOT, "node_modules", "prisma", "build", "index.js");

/** `prisma db push`로 스키마를 동기화(테이블이 없으면 생성) - 런타임에
 * 마이그레이션 파일을 미리 만들어둘 수 없는 "설계자가 아무 DB나 골라서
 * 지금 막 연결"하는 상황이라 migrate deploy 대신 db push를 쓴다.
 *
 * `npx prisma ...`가 아니라 node로 prisma CLI의 JS 진입점을 직접 실행한다 -
 * `npx`는 Windows에서 `.cmd` 셸 래퍼라 `execFileSync`(셸 없이 spawn)로는
 * 못 찾는다(`spawnSync npx ENOENT`, 실제로 겪은 문제); 셸을 거치지 않는
 * 이 방식이 플랫폼 무관하게 동작한다. */
function pushSchema(driver: DbConfig["driver"], url: string): void {
  execFileSync(
    process.execPath,
    [PRISMA_CLI, "db", "push", "--schema", schemaPathFor(driver), "--skip-generate", "--accept-data-loss"],
    { cwd: BACKEND_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
}

function readLocalComments(): DocCommentRow[] {
  const rows = getLocalDb()
    .prepare("SELECT id, doc_path, body, created_at, resolved_at FROM doc_comments ORDER BY id")
    .all() as unknown as { id: number; doc_path: string; body: string; created_at: string; resolved_at: string | null }[];
  return rows.map((r) => ({
    id: r.id, docPath: r.doc_path, body: r.body, createdAt: r.created_at, resolvedAt: r.resolved_at,
  }));
}

function replaceLocalComments(rows: DocCommentRow[]): void {
  const db = getLocalDb();
  db.exec("DELETE FROM doc_comments");
  const stmt = db.prepare(
    "INSERT INTO doc_comments (id, doc_path, body, created_at, resolved_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const r of rows) {
    stmt.run(r.id, r.docPath, r.body, r.createdAt, r.resolvedAt);
  }
}

export interface EnableResult {
  driver: DbConfig["driver"];
  migrated_rows: number;
}

export async function enableServiceDb(driver: DbConfig["driver"], connection: Record<string, unknown>): Promise<EnableResult> {
  const url = buildConnectionUrl(driver, connection);
  pushSchema(driver, url);

  const client = await connectServiceClient(driver, url);
  try {
    const localRows = readLocalComments();
    for (const row of localRows) {
      await client.docComment.create({ data: row });
    }
    const remoteCount = await client.docComment.count();
    if (remoteCount !== localRows.length) {
      throw new Error(
        `이관 후 행 개수가 일치하지 않습니다(로컬 ${localRows.length} vs 서비스 DB ${remoteCount}) - db.enabled를 켜지 않았습니다.`,
      );
    }
  } finally {
    await client.$disconnect();
  }

  const config = loadConfig();
  config.db = { enabled: true, driver, connection };
  config.features.db = true; // SP-00003 3절 features.db와 SP-00001 6절 db.enabled는
  // 같은 스위치를 가리키는 두 표기 - 둘 다 같이 갱신해서 설정 파일 안에서
  // 서로 모순돼 보이지 않게 한다(db.enabled가 실제 동작을 결정하는 쪽).
  saveConfig(config);
  // 로컬 SQLite 파일은 지우지 않고 백업으로 남긴다(SP-00001 6절).

  const finalCount = readLocalComments().length;
  return { driver, migrated_rows: finalCount };
}

export interface DisableResult {
  migrated_rows: number;
  dropped: boolean;
}

export async function disableServiceDb(drop: boolean): Promise<DisableResult> {
  const config = loadConfig();
  if (!config.db.enabled) {
    throw new Error("db가 이미 꺼져 있습니다");
  }
  const { driver, connection } = config.db;
  if (!connection) {
    throw new Error("db.connection 설정이 없습니다");
  }
  const url = buildConnectionUrl(driver, connection);

  const client = await connectServiceClient(driver, url);
  let remoteRows: DocCommentRow[];
  try {
    remoteRows = await client.docComment.findMany();
    replaceLocalComments(remoteRows);
    const localCount = readLocalComments().length;
    if (localCount !== remoteRows.length) {
      throw new Error(
        `이관 후 행 개수가 일치하지 않습니다(서비스 DB ${remoteRows.length} vs 로컬 ${localCount}) - db.enabled를 끄지 않았습니다.`,
      );
    }
    if (drop) {
      await client.docComment.deleteMany();
    }
  } finally {
    await client.$disconnect();
  }

  config.db = { enabled: false, driver, connection };
  config.features.db = false;
  saveConfig(config);

  return { migrated_rows: remoteRows.length, dropped: drop };
}
