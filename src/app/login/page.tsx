/**
 * ログイン画面（REQUIREMENTS.md §6.2）
 *
 * スマホからも使うので、入力欄とボタンを大きめに取る。
 */

import { appPasswordConfigured } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "ログイン | ディベート支援" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const configured = appPasswordConfigured();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">ディベート支援</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        政策ディベートの準備と練習に使うアプリです。
      </p>

      {/* URLだけ渡された人が「何これ」とならないように、先に中身を示す */}
      <ul className="mb-6 space-y-1 rounded bg-[var(--line)]/30 p-3 text-sm">
        <li>・テーマを登録すると、賛成側・反対側の立論と資料を用意します</li>
        <li>・自作の立論と資料を登録して、質疑と回答・フローチャートを作れます</li>
        <li>・最終弁論の雛形と、立論ごとの戦い方をまとめます</li>
        <li>・タイマーと読み上げ練習、AI相手の質疑練習ができます</li>
      </ul>

      {!configured && (
        <p className="mb-5 rounded border-2 border-[var(--neg)] p-3 text-sm">
          <b>管理者の方へ:</b> サーバーの <code>.env</code> に{" "}
          <code>DEBATE_APP_PASSWORD</code> を設定してください。
          設定するまで誰もログインできません。
        </p>
      )}

      <LoginForm next={next ?? "/"} />

      <p className="mt-4 text-sm">
        <a href="/manual.html" target="_blank" rel="noopener" className="text-[var(--accent)] underline">
          はじめての方へ：使い方の説明書を読む
        </a>
      </p>

      <p className="mt-6 text-xs text-[var(--muted)]">
        ※お名前は自己申告です。「誰が直したか」の目安として記録しますが、
        なりすましを防ぐ仕組みではありません。
      </p>
    </main>
  );
}
