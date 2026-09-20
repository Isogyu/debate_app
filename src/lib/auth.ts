/**
 * 認証（REQUIREMENTS.md §6.2）
 *
 * ゼミ規模に合わせた二層構成:
 *  - チーム/プロジェクト単位 … パスコード（これでアクセス制御が成立する）
 *  - 個人単位              … 名前を選ぶだけ（誰が編集したかの記録用）
 *
 * 個人識別は名前選択なので、否認防止が成立するのはチーム単位まで。
 * できない保証をしないため、その旨をUIにも明記する。
 */

import "server-only";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(passcode.normalize("NFKC"), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(passcode.normalize("NFKC"), salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export const PROJECT_SESSION_COOKIE = "debate_project_access";
export const USER_COOKIE = "debate_user";
