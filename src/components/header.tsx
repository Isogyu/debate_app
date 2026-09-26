/**
 * 画面上部の共通ヘッダー（サーバー部品）。
 * ログイン中の名前とログアウトを出す。共用のPCで名前を切り替えられるようにするため。
 */

import Link from "next/link";
import { logout } from "@/app/login/actions";
import { currentUserName } from "@/lib/session";

export async function Header() {
  const name = await currentUserName();
  return (
    <header className="border-b border-[var(--line)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="whitespace-nowrap text-lg font-bold">
          ディベート支援
        </Link>
        <nav className="flex items-center gap-3 whitespace-nowrap text-sm">
          <Link href="/" className="hover:underline">
            現テーマ
          </Link>
          <a href="/manual.html" target="_blank" rel="noopener" className="hover:underline">
            使い方
          </a>
          {name && (
            <form action={logout} className="flex items-center gap-2">
              <span className="hidden text-[var(--muted)] sm:inline">{name}</span>
              <button type="submit" className="min-h-9 rounded border border-[var(--line)] px-3 hover:underline">
                ログアウト
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
