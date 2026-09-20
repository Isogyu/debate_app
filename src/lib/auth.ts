/**
 * 認証（REQUIREMENTS.md §6.2）
 *
 * 運用方針: ゼミで共通のパスワードを1つ決め、それを知っている人だけが
 * 自分のPC・スマホから使える。人数に関わらず登録作業が要らない。
 *
 *  - 合言葉（共通パスワード） … これがアクセス制御の実体
 *  - 名前を選ぶだけ            … 誰が編集したかの記録用
 *
 * 個人識別が名前選択である以上、否認防止が成立するのは
 * 「このパスワードを知る集団の誰か」までで、個人単位は参考値。
 * できない保証をしないため、その旨を画面にも明記する。
 */

import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "debate_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30日

/** パスワード未設定のまま動かすと誰でも入れてしまう。起動時に気付けるようにする */
export function appPasswordConfigured(): boolean {
  return !!process.env.DEBATE_APP_PASSWORD?.trim();
}

export function checkAppPassword(input: string): boolean {
  const expected = process.env.DEBATE_APP_PASSWORD?.trim();
  if (!expected) return false;
  const a = Buffer.from(input.normalize("NFKC"));
  const b = Buffer.from(expected.normalize("NFKC"));
  // 長さが違うと timingSafeEqual が投げるので、先に長さを揃えて比較する
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // 比較時間を揃える
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * セッションの署名鍵。環境変数が未設定なら共通パスワードから導出する。
 * 別途の秘密を管理させない（ゼミ運用で鍵が2つあると必ず片方を忘れる）。
 */
function sessionSecret(): Buffer {
  const explicit = process.env.DEBATE_SESSION_SECRET;
  if (explicit) return Buffer.from(explicit);
  const password = process.env.DEBATE_APP_PASSWORD ?? "";
  return scryptSync(password, "debate-session", 32);
}

/** userId と有効期限を署名して1つの文字列にする */
export function signSession(userId: string): string {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${expires}`;
  const mac = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

/** 署名と有効期限を検証する。壊れていれば null */
export function verifySession(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts;

  const expected = createHmac("sha256", sessionSecret())
    .update(`${userId}.${expires}`)
    .digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Number(expires) < Date.now()) return null;
  return userId;
}

// ── プロジェクト単位のパスコード（将来チームを分ける場合に使う） ──
// いまは共通パスワード運用のため、作成時はランダム値を入れて無効化している。
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

export const USER_COOKIE = "debate_user";
