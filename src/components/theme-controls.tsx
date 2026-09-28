"use client";

/**
 * 過去テーマの操作（v7）
 *  - 現テーマに戻す … いまの現テーマは過去テーマに回る（入れ替え）
 *  - 削除する … 元に戻せないので、何が消えるかを示し、チェックを入れないと押せない
 *
 * ブラウザの確認ダイアログは使わない（スマホで見落としやすく、文面も出せないため）。
 */

import { useActionState, useState } from "react";
import { deleteThemeAction, restoreThemeAction, type FormState } from "@/app/projects/actions";

export function RestoreThemeButton({
  projectId,
  currentResolution,
  disabledReason,
}: {
  projectId: string;
  /** いまの現テーマ（入れ替えで過去テーマになる）。なければ null */
  currentResolution: string | null;
  disabledReason?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(restoreThemeAction, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!!disabledReason}
        title={disabledReason}
        className="min-h-11 rounded bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-40"
      >
        このテーマを現テーマにする
      </button>
    );
  }
  return (
    <form action={action} className="w-full rounded border-2 border-[var(--accent)] p-4 text-sm">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="mb-2 font-bold">このテーマを現テーマに戻しますか？</p>
      <ul className="mb-3 list-disc space-y-1 pl-5">
        {currentResolution ? (
          <li>
            いまの現テーマ「{currentResolution}」は<b>過去テーマ</b>になります（消えません。あとで戻すこともできます）。
          </li>
        ) : (
          <li>いまは現テーマがないので、このテーマがそのまま現テーマになります。</li>
        )}
        <li>戻したテーマでは、立論や資料の編集・生成・練習がまたできるようになります。</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded bg-[var(--accent)] px-4 font-bold text-white disabled:opacity-50"
        >
          {pending ? "切り替えています…" : "現テーマにする"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-11 rounded border border-[var(--line)] px-4"
        >
          やめる
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-[var(--neg)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function DeleteThemeButton({
  projectId,
  resolution,
  counts,
}: {
  projectId: string;
  resolution: string;
  counts: { cases: number; materials: number; questions: number; sessions: number };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteThemeAction, {});
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded border border-[var(--neg)] px-4 text-sm text-[var(--neg)] hover:bg-[var(--neg)] hover:text-white"
      >
        このテーマを削除する…
      </button>
    );
  }
  return (
    <form action={action} className="w-full rounded border-2 border-[var(--neg)] bg-[var(--neg)]/5 p-4 text-sm">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="mb-2 text-base font-bold text-[var(--neg)]">⚠ このテーマを完全に削除します。元に戻せません。</p>
      <p className="mb-2">「{resolution}」について、次のものがすべて消えます。</p>
      <ul className="mb-3 list-disc space-y-1 pl-5">
        <li>立論 {counts.cases}本（生成したもの・登録したものの両方）と、登録したWordファイル</li>
        <li>資料 {counts.materials}件、質疑と回答 {counts.questions}問、最終弁論の雛形、特徴と戦い方</li>
        <li>質疑練習の記録 {counts.sessions}回分と、論題の分析・メモ</li>
      </ul>
      <p className="mb-3 text-[var(--muted)]">
        ※ 過去テーマは、削除しない限りずっと残ります。見返す可能性があるなら、削除せずに残しておくことをおすすめします。
        必要なら、先に「エクスポート・印刷」で手元に保存してください。
        <br />
        ※ すでに現テーマの立論へコピーした資料は、コピー先に残ります。
      </p>
      <label className="mb-3 flex items-start gap-2">
        <input
          type="checkbox"
          name="understood"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="mt-0.5 h-5 w-5"
        />
        <span>削除すると元に戻せないことを理解しました</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !understood}
          className="min-h-11 rounded bg-[var(--neg)] px-4 font-bold text-white disabled:opacity-40"
        >
          {pending ? "削除しています…" : "完全に削除する"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setUnderstood(false);
          }}
          className="min-h-11 rounded border border-[var(--line)] px-4"
        >
          やめる
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-[var(--neg)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
