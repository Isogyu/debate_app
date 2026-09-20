/**
 * 未ログインのリクエストをログイン画面へ送る（Next.js 16 の proxy。旧 middleware）
 *
 * ここでやるのはクッキーの有無を見るだけの「楽観的チェック」。
 * 署名の検証は requireSession() がサーバー側で行う。
 * proxyは全リクエストを通るので、重い処理や本当の認可判断は置かない。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = new URL("/login", request.url);
  // ログイン後に元の画面へ戻す
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // ログイン画面と静的ファイルは素通しする
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
