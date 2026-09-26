import Link from "next/link";

/** 見つからないページ。英語の既定画面を出さない */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-bold">ページが見つかりません</h1>
      <p className="mb-6 text-[var(--muted)]">
        URL が間違っているか、ページが移動した可能性があります。
      </p>
      <Link href="/" className="text-[var(--accent)] underline underline-offset-2">
        現テーマへ戻る
      </Link>
    </main>
  );
}
