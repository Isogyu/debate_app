"use client";

/**
 * 反駁・比較画面（DESIGN.md §8 REB）
 *
 * 相手の主張を「前提・根拠・因果・効果」の4つに分解して整理する。
 * 本番で引けるようにするため、反駁はブロック集へ送れる。
 */

import { useState } from "react";
import Link from "next/link";

export interface RebuttalView {
  id: string;
  targetClaimTitle: string;
  targetVariantLabel: string;
  attackPoint: "premise" | "evidence" | "causality" | "impact";
  argument: string;
  categoryIds: string[];
}

export interface ComparisonView {
  criteria: {
    categoryId: string;
    name: string;
    affirmative: string;
    negative: string;
  }[];
  verdictLogic: string;
}

const ATTACK_POINTS = [
  { key: "premise", label: "前提", hint: "相手が当然視している前提を疑う" },
  { key: "evidence", label: "根拠", hint: "資料の射程・古さ・代表性を突く" },
  { key: "causality", label: "因果", hint: "「AだからB」の飛躍を突く" },
  { key: "impact", label: "効果", hint: "正しくても論題の判断を変えないと示す" },
] as const;

export function RebuttalView({
  projectId,
  rebuttals,
  comparison,
  categoryNames,
}: {
  projectId: string;
  rebuttals: RebuttalView[];
  comparison: ComparisonView | null;
  categoryNames: Record<string, string>;
}) {
  const [attackPoint, setAttackPoint] = useState<string | null>(null);
  const [claimTitle, setClaimTitle] = useState<string | null>(null);

  const claimTitles = [...new Set(rebuttals.map((r) => r.targetClaimTitle))].filter(
    Boolean,
  );

  const visible = rebuttals.filter(
    (r) =>
      (!attackPoint || r.attackPoint === attackPoint) &&
      (!claimTitle || r.targetClaimTitle === claimTitle),
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">相手の主張への反駁</h2>

        {claimTitles.length > 0 && (
          <label className="mb-3 block text-sm">
            <span className="mr-2 text-[var(--muted)]">相手の主張:</span>
            <select
              value={claimTitle ?? ""}
              onChange={(e) => setClaimTitle(e.target.value || null)}
              className="rounded border border-[var(--line)] p-2"
            >
              <option value="">すべて</option>
              {claimTitles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <button
            onClick={() => setAttackPoint(null)}
            className={`rounded px-3 py-2 ${
              !attackPoint
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)]"
            }`}
          >
            全て（{rebuttals.length}）
          </button>
          {ATTACK_POINTS.map((p) => (
            <button
              key={p.key}
              onClick={() => setAttackPoint(p.key)}
              title={p.hint}
              className={`rounded px-3 py-2 ${
                attackPoint === p.key
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)]"
              }`}
            >
              {p.label}（{rebuttals.filter((r) => r.attackPoint === p.key).length}）
            </button>
          ))}
        </div>

        {attackPoint && (
          <p className="mb-3 text-sm text-[var(--muted)]">
            {ATTACK_POINTS.find((p) => p.key === attackPoint)?.hint}
          </p>
        )}

        {visible.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            該当する反駁はありません。
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => (
              <li key={r.id} className="rounded border border-[var(--line)] p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-[var(--line)]/60 px-2 py-0.5">
                    {ATTACK_POINTS.find((p) => p.key === r.attackPoint)?.label}
                  </span>
                  {r.targetClaimTitle && (
                    <span className="text-[var(--muted)]">
                      対象: {r.targetClaimTitle}
                    </span>
                  )}
                  {r.categoryIds.map((id) => (
                    <span
                      key={id}
                      className="rounded bg-[var(--line)]/60 px-2 py-0.5"
                    >
                      {categoryNames[id] ?? "?"}
                    </span>
                  ))}
                </div>
                <p className="leading-7">{r.argument}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">比較衡量</h2>
        {!comparison || comparison.criteria.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            比較衡量表がまだ生成されていません。
          </p>
        ) : (
          <>
            {/* スマホでは横スクロールさせる。表を潰して読めなくしない */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--line)] text-left">
                    <th className="p-2">評価基準</th>
                    <th className="p-2" style={{ color: "var(--aff)" }}>
                      肯定側
                    </th>
                    <th className="p-2" style={{ color: "var(--neg)" }}>
                      否定側
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.criteria.map((c, i) => (
                    <tr key={i} className="border-b border-[var(--line)]">
                      <td className="p-2 font-bold">
                        {c.name}
                        {categoryNames[c.categoryId] && (
                          <span className="block text-xs font-normal text-[var(--muted)]">
                            {categoryNames[c.categoryId]}
                          </span>
                        )}
                      </td>
                      <td className="p-2">{c.affirmative}</td>
                      <td className="p-2">{c.negative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comparison.verdictLogic && (
              <p className="mt-3 rounded bg-[var(--line)]/30 p-3">
                <b>判断の軸: </b>
                {comparison.verdictLogic}
              </p>
            )}
          </>
        )}
      </section>

      <p className="text-sm text-[var(--muted)]">
        本番で引く形に整理したものは{" "}
        <Link
          href={`/projects/${projectId}/blocks`}
          className="text-[var(--accent)] underline underline-offset-2"
        >
          ブロック集
        </Link>{" "}
        にまとまっています。
      </p>
    </div>
  );
}
