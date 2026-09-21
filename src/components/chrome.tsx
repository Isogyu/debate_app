/**
 * 共通レイアウト部品（DESIGN.md §0）
 *
 * 本番モードはこれを使わない。グローバルナビを出さず画面いっぱいを使う。
 */

import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-[var(--line)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          ディベート支援
        </Link>
        {/* 未実装の画面（練習問題・ガイド・管理）へのリンクは置かない。
            押して404を見せるくらいなら、無い方がよい */}
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">
            論題一覧
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="mb-4 text-sm text-[var(--muted)]">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1">›</span>}
          {item.href ? (
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            item.label
          )}
        </span>
      ))}
    </nav>
  );
}

export function SideBadge({ side }: { side: "affirmative" | "negative" }) {
  const aff = side === "affirmative";
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-bold text-white"
      style={{ background: aff ? "var(--aff)" : "var(--neg)" }}
    >
      {aff ? "肯定側" : "否定側"}
    </span>
  );
}

/**
 * AI生成物であることを常に明示する（REQUIREMENTS §6.2 信頼性）。
 * 生成の不確実性をUIに偽装しない、が設計の原則。
 */
export function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="rounded border border-[var(--aff)] px-2 py-0.5 text-xs text-[var(--aff)]">
      確認済
    </span>
  ) : (
    <span className="rounded border border-[var(--neg)] px-2 py-0.5 text-xs text-[var(--neg)]">
      AI生成（未確認）
    </span>
  );
}

/** 専門用語の注釈（DESIGN §0）。非情報系・ディベート初学者のゼミ生向け */
export function Term({
  children,
  note,
}: {
  children: React.ReactNode;
  note: string;
}) {
  return (
    <span
      title={note}
      className="cursor-help border-b border-dotted border-[var(--muted)]"
    >
      {children}
      <span className="ml-0.5 align-super text-[0.65em] text-[var(--muted)]">
        ?
      </span>
    </span>
  );
}
