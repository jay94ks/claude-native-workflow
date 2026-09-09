import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { docsDir } from "./paths.js";

// docs/.workflow/data.db - local data with no markdown-file source of truth
// (comments now, change_notices in PL-00001 2단계 7번), mirroring
// tier1/tools/docs/server.py's _data_conn(). Stays local/gitignored even
// when db.enabled later moves it to a real service DB (SP-00001 6절) - this
// file remains the off-db fallback and the pre-migration source.

let db: DatabaseSync | null = null;
let dbForRoot: string | null = null;

export function getLocalDb(): DatabaseSync {
  const dbPath = path.join(docsDir(), ".workflow", "data.db");
  if (db && dbForRoot === dbPath) return db;
  if (db) db.close();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_path TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_path TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      ref TEXT,
      created_at TEXT NOT NULL
    )
  `);
  dbForRoot = dbPath;
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
