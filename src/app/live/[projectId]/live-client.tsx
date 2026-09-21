"use client";

/**
 * 本番モード（DESIGN.md §10）★最重要画面
 *
 * 設計上の制約:
 *  - 2タップで「返し」が読める。カテゴリ → ブロック一覧（返しの要点が載っている）
 *    詳細は3タップ目。一覧が見出しだけだと2タップで用が足りない。
 *  - 画面遷移100ms以内・検索200ms以内。そのためデータは全件クライアントに渡し、
 *    サーバーへの往復を発生させない。検索対象も事前計算済みの searchText を使う。
 *  - 読み取り専用。編集UIは一切出さない。
 */

import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import Link from "next/link";

export interface LiveBlock {
  id: string;
  categoryIds: string[];
  opponentArgument: string;
  summary: string;
  searchText: string;
  rebuttals: { id: string; attackPoint: string; argument: string }[];
  materials: { id: string; number: number; provesWhat: string; citation?: string }[];
  crossExams: { id: string; question: string }[];
}

export interface LiveCategory {
  id: string;
  name: string;
}

export interface LiveData {
  projectId: string;
  title: string;
  side: "affirmative" | "negative";
  categories: LiveCategory[];
  blocks: LiveBlock[];
  builtAt: string;
}

const ATTACK_LABELS: Record<string, string> = {
  premise: "前提",
  evidence: "根拠",
  causality: "因果",
  impact: "効果",
};

export function LiveClient({ data }: { data: LiveData }) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // 事前計算済みテキストに対して検索する。試合中にサーバーへ問い合わせない
  const fuse = useMemo(
    () =>
      new Fuse(data.blocks, {
        keys: ["opponentArgument", "summary", "searchText"],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [data.blocks],
  );

  const visibleBlocks = useMemo(() => {
    if (query.trim()) return fuse.search(query.trim()).map((r) => r.item);
    if (categoryId)
      return data.blocks.filter((b) => b.categoryIds.includes(categoryId));
    return [];
  }, [query, categoryId, data.blocks, fuse]);

  const block = blockId ? data.blocks.find((b) => b.id === blockId) : null;
  const category = categoryId
    ? data.categories.find((c) => c.id === categoryId)
    : null;

  const countFor = (id: string) =>
    data.blocks.filter((b) => b.categoryIds.includes(id)).length;

  const goBack = () => {
    if (block) setBlockId(null);
    else if (query) setQuery("");
    else setCategoryId(null);
  };

  const showingList = !block && (categoryId || query.trim());

  return (
    <div className="live-mode flex min-h-screen flex-col">
      {/* 検索バーは常時最上部。カテゴリを飛ばしてキーワード直撃もできる */}
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--background)] px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          {(categoryId || query || block) && (
            <button
              onClick={goBack}
              className="shrink-0 rounded border-2 border-[var(--line)] px-4 py-3 text-base font-bold"
              aria-label="戻る"
            >
              ← 戻る
            </button>
          )}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setBlockId(null);
            }}
            placeholder="キーワードで探す"
            className="min-h-11 w-full rounded border-2 border-[var(--line)] px-3 py-2 text-base"
          />
          <Link
            href={`/projects/${data.projectId}`}
            className="shrink-0 text-sm text-[var(--muted)] hover:underline"
          >
            終了
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
        {/* 1タップ目: カテゴリ選択 */}
        {!showingList && !block && (
          <>
            <h1 className="mb-1 text-xl font-bold">{data.title}</h1>
            <p className="mb-5 text-base">相手の主張はどのカテゴリ？</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* 件数の多い順に並べ、0件は末尾かつ押せなくする。
                  試合中に押して空振りするのが一番困る */}
              {[...data.categories]
                .sort((a, b) => countFor(b.id) - countFor(a.id))
                .map((c) => {
                  const n = countFor(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      disabled={n === 0}
                      className="min-h-28 rounded border-2 border-[var(--accent)] p-4 text-lg font-bold text-[var(--accent)] disabled:border-[var(--line)] disabled:text-[var(--muted)]"
                    >
                      {c.name}
                      <span className="mt-1 block text-sm font-normal text-[var(--muted)]">
                        {n === 0 ? "なし" : `(${n})`}
                      </span>
                    </button>
                  );
                })}
            </div>
            {data.categories.length === 0 && (
              <p className="text-[var(--muted)]">
                争点カテゴリがまだありません。準備画面で生成してください。
              </p>
            )}
          </>
        )}

        {/* 2タップ目: ブロック一覧。カードに「返しの要点」まで載せる */}
        {showingList && (
          <>
            <h1 className="mb-4 text-lg font-bold">
              {query.trim() ? `「${query}」の検索結果` : `カテゴリ: ${category?.name}`}
              <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                {visibleBlocks.length}件
              </span>
            </h1>
            <ul className="space-y-3">
              {visibleBlocks.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setBlockId(b.id)}
                    className="w-full rounded border-2 border-[var(--line)] p-4 text-left"
                  >
                    <p className="font-bold">相手: 「{b.opponentArgument}」</p>
                    <p className="mt-2">返し: {b.summary}</p>
                    <span className="mt-2 block text-right text-sm text-[var(--accent)]">
                      開く →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visibleBlocks.length === 0 && (
              <p className="text-[var(--muted)]">
                {query.trim()
                  ? "見つかりませんでした。語を短くするか、カテゴリから探してください。"
                  : "このカテゴリの準備はまだありません。別のカテゴリを見てください。"}
              </p>
            )}
          </>
        )}

        {/* 3タップ目: 詳細 */}
        {block && (
          <article>
            <h1 className="mb-4 text-lg font-bold">
              相手の主張: 「{block.opponentArgument}」
            </h1>

            <section className="mb-5">
              <h2 className="mb-2 border-l-4 border-[var(--accent)] pl-2 font-bold">
                返し方
              </h2>
              <p>{block.summary}</p>
            </section>

            {block.rebuttals.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-2 border-l-4 border-[var(--accent)] pl-2 font-bold">
                  関連する反駁
                </h2>
                <ul className="space-y-3">
                  {block.rebuttals.map((r) => (
                    <li key={r.id} className="rounded border border-[var(--line)] p-3">
                      <span className="mr-2 rounded bg-[var(--line)] px-2 py-0.5 text-sm">
                        {ATTACK_LABELS[r.attackPoint] ?? r.attackPoint}
                      </span>
                      {r.argument}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              {block.materials.length > 0 && (
                <section>
                  <h2 className="mb-2 border-l-4 border-[var(--accent)] pl-2 font-bold">
                    使える根拠
                  </h2>
                  <ul className="space-y-2">
                    {block.materials.map((m) => (
                      <li key={m.id}>
                        <b>[資料{m.number}]</b> {m.provesWhat}
                        {m.citation && (
                          <span className="block text-sm text-[var(--muted)]">
                            {m.citation}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {block.crossExams.length > 0 && (
                <section>
                  <h2 className="mb-2 border-l-4 border-[var(--accent)] pl-2 font-bold">
                    使える質疑
                  </h2>
                  <ul className="space-y-2">
                    {block.crossExams.map((q) => (
                      <li key={q.id}>Q: {q.question}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </article>
        )}
      </main>

      <footer className="px-4 py-3 text-center text-xs text-[var(--muted)]">
        このデータは {data.builtAt.slice(0, 16).replace("T", " ")} 時点のものです。
        資料を追加したら本番前に開き直してください。
      </footer>
    </div>
  );
}
