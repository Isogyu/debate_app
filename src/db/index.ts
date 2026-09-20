/**
 * DB接続（REQUIREMENTS.md §4 永続化方式）
 *
 * SQLiteはWALモード必須。長時間の生成ジョブによる書き込みと、
 * 他の学生の閲覧（読み取り）を同時に成立させるため。
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const DB_DIR = process.env.DEBATE_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "debate.db");

function createConnection() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL"); // 同時読み取り＋長時間書き込みの両立
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

// 開発時のホットリロードで接続が増殖しないようグローバルに保持する
const globalForDb = globalThis as unknown as {
  __debateSqlite?: Database.Database;
};

const sqlite = globalForDb.__debateSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__debateSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema, sqlite, DB_PATH, DB_DIR };
