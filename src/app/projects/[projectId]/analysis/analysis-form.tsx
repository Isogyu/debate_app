"use client";

/**
 * 分析確認画面（DESIGN.md §3 ANAL）★品質ゲート
 *
 * LLMの法解釈は誤りうる（REQUIREMENTS §13-3）。ここで人が直してから
 * 生成に進む、という流れを必須にすることで品質を担保する。
 * だから「AIの分析です」の警告バーは消さず、全項目を編集可能にする。
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveAnalysis, startGeneration, type FormState } from "../../actions";
import { Term } from "@/components/chrome";

export interface AnalysisFormData {
  projectId: string;
  resolution: string;
  policyChange: string;
  statusQuo: string;
  relatedLaws: { name: string; article: string }[];
  categories: string[];
  frameworks: {
    affirmative: { name: string; basisLaw?: string; criteria: string[] };
    negative: { name: string; basisLaw?: string; criteria: string[] };
  };
}

export function AnalysisForm({ data }: { data: AnalysisFormData }) {
  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(
    saveAnalysis,
    {},
  );
  const [genState, genAction, generating] = useActionState<FormState, FormData>(
    startGeneration,
    {},
  );
  const [laws, setLaws] = useState(
    data.relatedLaws.length > 0 ? data.relatedLaws : [{ name: "", article: "" }],
  );

  const busy = saving || generating;
  const error = genState.error ?? saveState.error;

  return (
    <form className="space-y-7">
      <input type="hidden" name="projectId" value={data.projectId} />

      <p
        role="status"
        className="rounded border-2 border-[var(--neg)] bg-[var(--neg)]/5 p-3 text-sm"
      >
        ⚠ これはAIの分析です。<b>間違いがあればこの画面で直してください。</b>
        ここで直した内容をもとに、立論や資料要件が作られます。
      </p>

      {error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-bold">
          この政策が変えるもの{" "}
          <Term note="論題によって現状のどこが変わるのかを一文で表したものです。ここがずれると立論全体がずれます。">
            とは
          </Term>
        </h2>
        <textarea
          name="policyChange"
          rows={2}
          defaultValue={data.policyChange}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
        <h2 className="mt-4 mb-2 font-bold">現状の制度</h2>
        <textarea
          name="statusQuo"
          rows={2}
          defaultValue={data.statusQuo}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">
            関連する法令{" "}
            <Term note="条文の全文はAIに書かせていません。誤記を避けるため、資料画面でe-Gov法令検索から取得して登録します。">
              条文について
            </Term>
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => setLaws([...laws, { name: "", article: "" }])}
            className="rounded border border-[var(--line)] px-3 py-1 text-sm"
          >
            ＋ 追加
          </button>
        </div>
        <ul className="space-y-2">
          {laws.map((law, i) => (
            <li key={i} className="flex gap-2">
              <input
                name="lawName"
                defaultValue={law.name}
                disabled={busy}
                placeholder="法令名（例: 所得税法）"
                className="flex-1 rounded border border-[var(--line)] p-2"
              />
              <input
                name="lawArticle"
                defaultValue={law.article}
                disabled={busy}
                placeholder="条（例: 第56条）"
                className="w-40 rounded border border-[var(--line)] p-2"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setLaws(laws.filter((_, j) => j !== i))}
                aria-label={`${law.name || "この法令"}を削除`}
                className="rounded border border-[var(--line)] px-3"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-sm text-[var(--muted)]">
          条文の全文はあとから資料画面で登録します（AIには書かせていません）。
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">
          争点カテゴリ{" "}
          <Term note="質疑を整理する見出しになります。">
            重要
          </Term>
        </h2>
        <textarea
          name="categories"
          rows={3}
          defaultValue={data.categories.join("、")}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
        <p className="mt-1 text-sm text-[var(--muted)]">
          読点か改行で区切ってください。
          質疑の分類に使います
          。4〜8件程度が目安です。
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">
          評価基準の枠組み{" "}
          <Term note="どの物差しで政策の是非を測るかの枠組みです。賛成側と反対側で別々の枠組みを使うことがあります（例: 租税公平主義 と 税の基本原則）。">
            とは
          </Term>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              { key: "aff", label: "賛成側", color: "var(--aff)", fw: data.frameworks.affirmative },
              { key: "neg", label: "反対側", color: "var(--neg)", fw: data.frameworks.negative },
            ] as const
          ).map((side) => (
            <div
              key={side.key}
              className="rounded border-2 p-3"
              style={{ borderColor: side.color }}
            >
              <p className="mb-2 font-bold" style={{ color: side.color }}>
                {side.label}
              </p>
              <label className="mb-2 block">
                <span className="mb-1 block text-sm">枠組み名</span>
                <input
                  name={`${side.key}Framework`}
                  defaultValue={side.fw.name}
                  disabled={busy}
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-sm">根拠となる法令（任意）</span>
                <input
                  name={`${side.key}BasisLaw`}
                  defaultValue={side.fw.basisLaw ?? ""}
                  disabled={busy}
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm">評価基準（読点区切り）</span>
                <input
                  name={`${side.key}Criteria`}
                  defaultValue={side.fw.criteria.join("、")}
                  disabled={busy}
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          ← あとで続ける
        </Link>
        <div className="flex gap-3">
          <button
            type="submit"
            formAction={saveAction}
            disabled={busy}
            className="rounded border-2 border-[var(--line)] px-5 py-3 disabled:opacity-60"
          >
            {saving ? "保存中…" : "修正を保存する"}
          </button>
          <button
            type="submit"
            formAction={genAction}
            disabled={busy}
            className="rounded bg-[var(--accent)] px-6 py-3 font-bold text-white disabled:opacity-60"
          >
            {generating ? "開始しています…" : "この内容で生成開始 →"}
          </button>
        </div>
      </div>
      <p className="text-right text-sm text-[var(--muted)]">
        生成には数分かかります。開始したら画面を閉じても大丈夫です。
      </p>
    </form>
  );
}
