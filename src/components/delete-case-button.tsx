"use client";

/**
 * 登録した立論の削除。押し間違いで消えないよう、2段階で確かめる。
 * 生成した立論には出さない（生成は各側3本までの上限があるため）。
 */

import { useActionState, useState } from "react";
import { deleteCase, type ActionState } from "@/app/projects/[projectId]/cases/actions";

export function DeleteCaseButton({ projectId, variantId }: { projectId: string; variantId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteCase, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-9 rounded border border-[var(--neg)] px-3 text-xs text-[var(--neg)] hover:bg-[var(--neg)] hover:text-white"
      >
        この立論を削除
      </button>
    );
  }
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2 rounded border-2 border-[var(--neg)] p-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="variantId" value={variantId} />
      <span className="text-xs">
        この立論と、付いている資料・質疑・雛形・練習の記録をすべて削除します。元に戻せません。
      </span>
      <button
        type="submit"
        disabled={pending}
        className="min-h-9 rounded bg-[var(--neg)] px-3 text-xs font-bold text-white disabled:opacity-50"
      >
        {pending ? "削除しています…" : "削除する"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-9 rounded border border-[var(--line)] px-3 text-xs"
      >
        やめる
      </button>
      {state.error && <span role="alert" className="text-xs text-[var(--neg)]">{state.error}</span>}
    </form>
  );
}
