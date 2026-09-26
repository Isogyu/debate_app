"use client";

import { useActionState } from "react";
import { createThemeAction, type FormState } from "../actions";

export function WizardForm({ isChange }: { isChange: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createThemeAction, {});
  return (
    <form action={action} className="space-y-6">
      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="resolution" className="mb-1 block font-bold">
          論題（テーマ）
        </label>
        <textarea
          id="resolution"
          name="resolution"
          rows={3}
          required
          placeholder="例: 日本は所得税法第56条および第57条を廃止すべきである"
          className="w-full rounded border border-[var(--line)] p-3"
        />
        <p className="mt-1 text-sm text-[var(--muted)]">
          登録すると論題を分析し、賛成側・反対側の立論を1本ずつ生成します（各側3本まで追加できます）。
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="reviewAnalysis" className="mt-1 h-5 w-5" />
        <span>
          <b>論題の分析を確認してから生成する</b>
          <span className="block text-[var(--muted)]">
            チェックすると、分析（関連法令・争点・評価基準）ができたところで止まります。
            内容を直してから生成を始められます。チェックしなければ、止まらずに最後まで生成します。
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-60"
      >
        {pending ? "登録しています…" : isChange ? "テーマを変更する" : "テーマを登録する"}
      </button>
    </form>
  );
}
