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
      <p className="mb-6 text-sm text-[var(--muted)]">
        合言葉を入力すると、PCでもスマホでも同じ準備内容を使えます。
      </p>

      {!configured && (
        <p className="mb-5 rounded border-2 border-[var(--neg)] p-3 text-sm">
          <b>管理者の方へ:</b> サーバーの <code>.env</code> に{" "}
          <code>DEBATE_APP_PASSWORD</code> を設定してください。
          設定するまで誰もログインできません。
        </p>
      )}

      <LoginForm next={next ?? "/"} />

      <p className="mt-6 text-xs text-[var(--muted)]">
        ※お名前は自己申告です。「誰が直したか」の目安として記録しますが、
        なりすましを防ぐ仕組みではありません。
      </p>
    </main>
  );
}
