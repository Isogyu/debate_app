"use client";

/**
 * ブロック集画面（DESIGN.md §9 BLK）
 *
 * 「相手がXと言ったら→Yを返す」をカテゴリ別に整理する。本番・模擬戦の武器。
 * カテゴリのサイドバーは本番モードと同じ軸にする（§14 カテゴリ軸）。
 */

import { useState } from "react";
import Link from "next/link";

export interface BlockView {
  id: string;
  categoryIds: string[];
  opponentArgument: string;
  summary: string;
  rebuttals: { id: string; attackPoint: string; argument: string }[];
  crossExams: { id: string; question: string }[];
  materials: { id: string; number: number; provesWhat: string }[];
}

const ATTACK_LABELS: Record<string, string> = {
  premise: "前提",
  evidence: "根拠",
  causality: "因果",
  impact: "効果",
};

export function BlocksView({
  projectId,
  blocks,
  categories,
}: {
  projectId: string;
  blocks: BlockView[];
  categories: { id: string; name: string }[];
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const visible = categoryId
    ? blocks.filter((b) => b.categoryIds.includes(categoryId))
    : blocks;

  const countFor = (id: string) =>
    blocks.filter((b) => b.categoryIds.includes(id)).length;

  return (
    <div className="grid gap-5 sm:grid-cols-[11rem_1fr]">
      {/* スマホでは横スクロールのタブ、PCでは縦のサイドバーになる */}
      <nav className="flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible">
        <button
          onClick={() => setCategoryId(null)}
          className={`shrink-0 rounded px-3 py-2 text-left text-sm ${
            !categoryId
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--line)]"
          }`}
        >
          全て（{blocks.length}）
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            className={`shrink-0 rounded px-3 py-2 text-left text-sm ${
              categoryId === c.id
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)]"
            }`}
          >
            {c.name}（{countFor(c.id)}）
          </button>
        ))}
      </nav>

      <div>
        {visible.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            このカテゴリのブロックはありません。
          </p>
        ) : (
          <ul className="space-y-4">
            {visible.map((block) => (
              <li
                key={block.id}
                className="rounded border border-[var(--line)] p-4"
              >
                <p className="font-bold">相手: 「{block.opponentArgument}」</p>
                <hr className="my-2 border-[var(--line)]" />
                <p>返し: {block.summary}</p>

                {block.rebuttals.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {block.rebuttals.map((r) => (
                      <li key={r.id} className="text-sm">
                        <span className="mr-2 rounded bg-[var(--line)]/60 px-2 py-0.5">
                          {ATTACK_LABELS[r.attackPoint] ?? r.attackPoint}
                        </span>
                        {r.argument}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--muted)]">
                  {block.materials.length > 0 && (
                    <span>
                      根拠:{" "}
                      <Link
                        href={`/projects/${projectId}/sources`}
                        className="text-[var(--accent)] underline underline-offset-2"
                      >
                        {block.materials
                          .map((m) => `資料${m.number}`)
                          .join("、")}
                      </Link>
                    </span>
                  )}
                  {block.crossExams.length > 0 && (
                    <span>
                      質疑:{" "}
                      <Link
                        href={`/projects/${projectId}/crossexam`}
                        className="text-[var(--accent)] underline underline-offset-2"
                      >
                        {block.crossExams.length}件
                      </Link>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
