"use client";

/** 「別の切り口でもう1本」（v6 要件 F3）。各側3本まで。残りの本数を常に見せる */

import { useActionState } from "react";
import { generateCase, type ActionState } from "./cases/actions";
import type { Side } from "@/domain/types";

export function GenerateButton({
  projectId,
  side,
  remaining,
  disabled,
  first,
}: {
  projectId: string;
  side: Side;
  remaining: number;
  disabled: boolean;
  first: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(generateCase, {});
  const none = remaining <= 0;
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="side" value={side} />
      <button
        type="submit"
        disabled={pending || disabled || none || state.ok}
        className="min-h-11 rounded bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-40"
      >
        {pending
          ? "開始しています…"
          : none
            ? "生成は各側3本までです"
            : first
              ? `AIで生成する（残り${remaining}本）`
              : `別の切り口でもう1本（残り${remaining}本）`}
      </button>
      {state.message && <p className="mt-2 text-xs">{state.message}</p>}
      {state.error && <p role="alert" className="mt-2 text-xs text-[var(--neg)]">{state.error}</p>}
    </form>
  );
}
