"use server";

/**
 * ログイン（REQUIREMENTS.md §6.2）
 *
 * 共通パスワード＋名前の入力。名前は「誰が編集したか」の記録用で、
 * アクセス制御は共通パスワードが担う。
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  appPasswordConfigured,
  checkAppPassword,
  signSession,
} from "@/lib/auth";
import { log, resolveUser } from "@/lib/session";

export interface LoginState {
  error?: string;
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const next = String(formData.get("next") ?? "/");

  if (!appPasswordConfigured()) {
    return {
      error:
        "サーバーに合言葉が設定されていません。管理者に連絡してください。（.env の DEBATE_APP_PASSWORD）",
    };
  }
  if (!displayName) {
    return { error: "お名前を入力してください。編集の記録に使います。" };
  }
  if (!checkAppPassword(password)) {
    // どちらが違うかは言わない。総当たりの手がかりを与えないため
    return { error: "合言葉が違います。" };
  }

  const userId = await resolveUser(displayName);
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
    // 開発中はhttpで使うため、本番相当のときだけsecureにする
    secure: process.env.NODE_ENV === "production",
  });

  await log(userId, "login", displayName);
  // オープンリダイレクト防止。自サイト内のパスだけ許す
  redirect(safeNextPath(next));
}

/**
 * ログイン後の戻り先。自サイト内のパスだけ許す（オープンリダイレクト防止）。
 * "//evil.com" や "/\\evil.com"（ブラウザが // と同じに扱う）を弾くため、
 * URL として解釈した結果が同じオリジンかどうかで判定する。
 */
function safeNextPath(next: string): string {
  if (!next.startsWith("/")) return "/";
  try {
    const base = "http://localhost";
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    if (/[\\\r\n\t]/.test(next)) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
