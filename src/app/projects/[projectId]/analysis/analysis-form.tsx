"use client";

/**
 * 論題の分析（v7）
 *
 * v7 で役割を分けた:
 *  - ここは論題そのものの一般的な分析（制度・法令・争点）と、チームのメモを置く場所
 *  - 評価基準の枠組みと生成の開始は「立論を生成する」画面へ移した
 *  - 立論ごとの特徴と戦い方は、各立論の「特徴と戦い方」タブにある
 *
 * LLMの法解釈は誤りうる（REQUIREMENTS §13-3）。だから「AIの分析です」の警告は消さず、
 * 全項目を人が直せるようにしておく。
 *
 * 用語の説明は、点線の下線（ホバーで出る説明）をやめて見出しの下に普通に書く。
 * 「とは」「重要」に下線が付いて不自然に見えていたため（v7）。
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveAnalysis, type FormState } from "../../actions";
import { keepInputs } from "@/components/keep-inputs";

export interface AnalysisFormData {
  projectId: string;
  resolution: string;
  policyChange: string;
  statusQuo: string;
  relatedLaws: { name: string; article: string }[];
  stakeholders: string[];
  coreIssues: string[];
  categories: string[];
  memo: string;
}

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-bold">{title}</h2>
      {note && <p className="text-sm text-[var(--muted)]">{note}</p>}
    </div>
  );
}

export function AnalysisForm({
  data,
  readOnly = false,
  canGenerate = false,
}: {
  data: AnalysisFormData;
  readOnly?: boolean;
  /** 「立論を生成する」への案内を出すか（生成の上限に達していない現テーマのみ） */
  canGenerate?: boolean;
}) {
  const [state, action, saving] = useActionState<FormState, FormData>(saveAnalysis, {});
  const [laws, setLaws] = useState(
    data.relatedLaws.length > 0 ? data.relatedLaws : [{ name: "", article: "" }],
  );

  // 過去テーマは閲覧のみ。入力も送信もさせない
  const busy = saving || readOnly;

  return (
    <form
      className="space-y-7"
      // 送信後も入力を残す（React 19 の自動リセットで、追加した法令などが消えていた）
      onSubmit={keepInputs((fd) => action(fd))}
    >
      <input type="hidden" name="projectId" value={data.projectId} />

      <p role="status" className="rounded border-2 border-[var(--neg)] bg-[var(--neg)]/5 p-3 text-sm">
        ⚠ これはAIの分析です。<b>間違いがあればこの画面で直してください。</b>
        税法ゼミのディベートを前提に、論題の制度・法令・争点を整理しています。
        立論ごとの特徴と戦い方は、各立論の「特徴と戦い方」タブにあります。
      </p>

      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}
      {!state.error && state.ok && !saving && (
        <p role="status" className="rounded border-2 border-[var(--aff)] p-3 text-sm">
          保存しました。
        </p>
      )}

      <section>
        <Heading
          title="この政策が変えるもの"
          note="論題によって現状のどこが変わるのかを一文で。ここがずれると立論全体がずれます。"
        />
        <textarea
          name="policyChange"
          rows={2}
          defaultValue={data.policyChange}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
        <div className="mt-4">
          <Heading title="現状の制度" />
        </div>
        <textarea
          name="statusQuo"
          rows={3}
          defaultValue={data.statusQuo}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      <section>
        <div className="mb-2 flex items-start justify-between gap-3">
          <Heading
            title="関連する法令"
            note="条文の全文はAIに書かせていません。誤記を避けるため、資料としてe-Gov法令検索から取得します。"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setLaws([...laws, { name: "", article: "" }])}
            className="shrink-0 rounded border border-[var(--line)] px-3 py-1 text-sm"
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
                className="min-w-0 flex-1 rounded border border-[var(--line)] p-2"
              />
              <input
                name="lawArticle"
                defaultValue={law.article}
                disabled={busy}
                placeholder="条（例: 第56条）"
                className="w-28 min-w-0 rounded border border-[var(--line)] p-2 sm:w-40"
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
      </section>

      <section>
        <Heading title="影響を受ける人・主体" note="読点か改行で区切ってください。" />
        <textarea
          name="stakeholders"
          rows={2}
          defaultValue={data.stakeholders.join("、")}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      <section>
        <Heading title="この論題の中心的な争点" note="1行に1つずつ書いてください。" />
        <textarea
          name="coreIssues"
          rows={Math.max(3, data.coreIssues.length + 1)}
          defaultValue={data.coreIssues.join("\n")}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      <section>
        <Heading
          title="争点カテゴリ（質疑を整理する見出し）"
          note="質疑と回答・フローチャートを分類する見出しになります。読点か改行で区切り、4〜8件程度が目安です。"
        />
        <textarea
          name="categories"
          rows={3}
          defaultValue={data.categories.join("、")}
          disabled={busy}
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      <section>
        <Heading
          title="メモ"
          note="チームの気づき・方針・調べたいことなどを自由に書き留めてください。AIの生成には使いません。"
        />
        <textarea
          name="memo"
          rows={8}
          defaultValue={data.memo}
          disabled={busy}
          placeholder="例: 反対側は執行コストで来そう。国税庁の統計年報で調査件数を確認しておく。"
          className="w-full rounded border border-[var(--line)] p-3"
        />
      </section>

      {readOnly ? (
        <p className="border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
          過去テーマのため閲覧のみです。編集するには、テーマ画面で現テーマに戻してください。
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
          <Link href={`/projects/${data.projectId}`} className="text-sm text-[var(--muted)] hover:underline">
            ← テーマの画面に戻る
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {canGenerate && (
              <Link
                href={`/projects/${data.projectId}/generate`}
                className="text-sm text-[var(--accent)] underline"
              >
                立論を生成する →
              </Link>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-[var(--accent)] px-6 py-3 font-bold text-white disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存する"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
