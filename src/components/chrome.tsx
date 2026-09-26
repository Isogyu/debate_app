/**
 * 共通レイアウト部品（DESIGN.md §0）
 *
 */

import Link from "next/link";

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
      {aff ? "賛成側" : "反対側"}
    </span>
  );
}

export function OriginBadge({ origin }: { origin: "uploaded" | "generated" }) {
  return (
    <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs">
      {origin === "uploaded" ? "登録（自作）" : "生成（AI）"}
    </span>
  );
}

/**
 * AI生成物であることを常に明示する（v6 要件 §1 #5）。
 * 生成の不確実性をUIに偽装しない、が設計の原則。
 */
export function VerificationBadge({
  verified,
  label = "AI生成（未確認）",
}: {
  verified: boolean;
  /** 未確認のときの表示（「AI取得（未確認）」など） */
  label?: string;
}) {
  if (verified) {
    return (
      <span className="rounded border border-[var(--aff)] px-2 py-0.5 text-xs text-[var(--aff)]">
        確認済
      </span>
    );
  }
  return (
    <span className="rounded border border-[var(--neg)] px-2 py-0.5 text-xs text-[var(--neg)]">
      {label}
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
