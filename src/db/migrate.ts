/**
 * マイグレーション適用＋バックアップ（REQUIREMENTS.md §6.1 可用性）
 *
 * Dockerでの配布を前提とするため、起動時に自動で実行する。
 * データは ./data に置き、コンテナ再作成で消えないようボリュームマウントする。
 */

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { db, DB_DIR, DB_PATH } from "./index";

/** 適用前に現物をコピーしておく。壊れたときに戻せることが可用性の実体 */
function backup() {
  if (!fs.existsSync(DB_PATH)) return;
  const dir = path.join(DB_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(DB_PATH, path.join(dir, `debate-${stamp}.db`));

  // 直近30世代だけ残す
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 30))) {
    fs.unlinkSync(path.join(dir, old));
  }
}

backup();
migrate(db, { migrationsFolder: "./drizzle" });
console.log("マイグレーションを適用しました:", DB_PATH);
