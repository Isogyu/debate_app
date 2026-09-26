"use client";

/** 登録した立論の賛成側・反対側を入れ替える（自動判定が外れたとき用） */

import { useActionState } from "react";
import { switchSide, type ActionState } from "@/app/projects/[projectId]/cases/actions";

export function SwitchSideButton({
  projectId,
  variantId,
  currentLabel,
}: {
  projectId: string;
  variantId: string;
  currentLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(switchSide, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="variantId" value={variantId} />
      <button
        type="submit"
        disabled={pending}
        title={`自動で「${currentLabel}」と判定しました。違っていれば入れ替えてください`}
        className="min-h-9 rounded border border-[var(--line)] px-3 text-xs hover:border-[var(--accent)] disabled:opacity-40"
      >
        {pending ? "入れ替えています…" : "賛成側・反対側を入れ替える"}
      </button>
      {state.error && <span role="alert" className="text-xs text-[var(--neg)]">{state.error}</span>}
    </form>
  );
}
