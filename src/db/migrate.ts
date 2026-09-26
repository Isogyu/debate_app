/**
 * マイグレーション適用＋バックアップ（REQUIREMENTS.md §6.1 可用性）
 *
 * Dockerでの配布を前提とするため、起動時に自動で実行する。
 * データは ./data に置き、コンテナ再作成で消えないようボリュームマウントする。
 *
 * v6 への移行（docs/IMPLEMENTATION_PLAN_v6.md §3.4）:
 * v5 のデータは引き継がず、v6 のスキーマで作り直すと決めた。
 * v5 のDBを見つけたら消さずに `backups/debate-v5-<日時>.db` へ退避し、空のDBから始める。
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = process.env.DEBATE_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "debate.db");
const BACKUP_DIR = path.join(DB_DIR, "backups");

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** 適用前に現物をコピーしておく。壊れたときに戻せることが可用性の実体 */
function backup() {
  if (!fs.existsSync(DB_PATH)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // WAL に残っている直近の書き込みを本体へ戻してから写す。
  // そのままコピーすると、直近の内容が欠けたバックアップになる
  const conn = new Database(DB_PATH);
  try {
    conn.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    conn.close();
  }
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `debate-${stamp()}.db`));

  // 直近30世代だけ残す（v5 の退避分は数えない。消えると戻せない）
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db") && !f.startsWith("debate-v5-"))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - 30))) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}

/** v5 のDBか。v5 にだけある `blocks` テーブルで見分ける */
function isV5Database(): boolean {
  if (!fs.existsSync(DB_PATH)) return false;
  const conn = new Database(DB_PATH, { readonly: true });
  try {
    const row = conn
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocks'",
      )
      .get();
    return !!row;
  } finally {
    conn.close();
  }
}

function retireV5Database() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `debate-v5-${stamp()}.db`);
  // WAL の中身を本体に書き戻してから移す。-wal を置き去りにすると退避分が欠ける
  const conn = new Database(DB_PATH);
  conn.pragma("wal_checkpoint(TRUNCATE)");
  conn.close();
  fs.renameSync(DB_PATH, target);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
  }
  console.log("v5 のデータベースを退避しました（v6 は空のDBから始めます）:", target);
}

fs.mkdirSync(DB_DIR, { recursive: true });
if (isV5Database()) {
  retireV5Database();
} else {
  backup();
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();
console.log("マイグレーションを適用しました:", DB_PATH);
