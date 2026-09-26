"use client";

/** 立論詳細で使う小さなフォーム群 */

import { useActionState, useState } from "react";
import { keepInputs } from "@/components/keep-inputs";
import {
  addQuestions,
  copyMaterial,
  saveMaterial,
  type ActionState,
} from "../actions";

/** 作成手順どおりに自分で見つけた資料を入れる */
export function MaterialForm({
  materialId,
  projectId,
  variantId,
  initial,
}: {
  materialId: string;
  projectId: string;
  variantId: string;
  initial?: { citation?: string | null; url?: string | null; quote?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMaterial, {});
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="min-h-9 rounded border border-[var(--line)] px-3 text-sm">
        {initial?.quote ? "資料を直す" : "見つけた資料を入力する"}
      </button>
    );
  }
  return (
    <form onSubmit={keepInputs((fd) => action(fd))} className="mt-3 space-y-3 rounded border-2 border-[var(--accent)] p-3">
      <input type="hidden" name="materialId" value={materialId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="variantId" value={variantId} />
      {state.error && <p role="alert" className="text-sm text-[var(--neg)]">{state.error}</p>}
      {state.ok && <p className="text-sm text-[var(--aff)]">保存しました（確認済）。</p>}
      <label className="block">
        <span className="mb-1 block text-sm font-bold">出典（発行元・題名・頁）</span>
        <input name="citation" defaultValue={initial?.citation ?? ""} className="w-full rounded border border-[var(--line)] p-2" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">URL</span>
        <input name="url" type="url" defaultValue={initial?.url ?? ""} className="w-full rounded border border-[var(--line)] p-2" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">最終確認日</span>
        <input name="lastCheckedAt" type="date" className="rounded border border-[var(--line)] p-2" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">引用文・資料の中身</span>
        <textarea name="quote" rows={6} defaultValue={initial?.quote ?? ""} className="w-full rounded border border-[var(--line)] p-2" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-[var(--line)] px-4 py-2 text-sm">
          閉じる
        </button>
        <button type="submit" disabled={pending} className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {pending ? "保存中…" : "保存する"}
        </button>
      </div>
    </form>
  );
}

/** 過去テーマの資料を現テーマの立論へコピーする（§3.5） */
export function CopyMaterialForm({
  materialId,
  targets,
}: {
  materialId: string;
  targets: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(copyMaterial, {});
  if (targets.length === 0) {
    return <p className="text-xs text-[var(--muted)]">現テーマに立論がないため、コピーできません。</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="materialId" value={materialId} />
      <select name="targetVariantId" className="min-h-9 max-w-full rounded border border-[var(--line)] p-1 text-sm">
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="min-h-9 rounded border border-[var(--line)] px-3 text-sm disabled:opacity-50">
        {pending ? "コピー中…" : "現テーマの立論へコピー"}
      </button>
      {state.message && <span className="text-xs text-[var(--aff)]">{state.message}</span>}
      {state.error && <span className="text-xs text-[var(--neg)]">{state.error}</span>}
    </form>
  );
}

/** 「この箇所をもっと」（§4.1） */
export function MoreQuestionsButton({ variantId, claimId }: { variantId: string; claimId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addQuestions, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="claimId" value={claimId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-9 rounded border border-[var(--accent)] px-3 text-sm text-[var(--accent)] disabled:opacity-50"
      >
        {pending ? "依頼中…" : "この箇所の質疑をもっと"}
      </button>
      {state.message && <span className="text-xs">{state.message}</span>}
      {state.error && <span className="text-xs text-[var(--neg)]">{state.error}</span>}
    </form>
  );
}
