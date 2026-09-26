"use client";

/** 「別の切り口でもう1本」（v6 要件 F3）。各側3本まで。残りの本数を常に見せる */

import { useActionState, useState } from "react";
import { keepInputs } from "@/components/keep-inputs";
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
  // 押したときの残り本数。生成が始まって画面が更新され、残りが減ったら押せるように戻す
  // （成功したら押せないままにしていたため、2本目のあと再読み込みするまで押せなかった）
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const justStarted = state.ok && startedAt === remaining;
  return (
    <form
      onSubmit={keepInputs((fd) => {
        setStartedAt(remaining);
        action(fd);
      })}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="side" value={side} />
      <button
        type="submit"
        disabled={pending || disabled || none || justStarted}
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
      {state.message && justStarted && <p className="mt-2 text-xs">{state.message}</p>}
      {state.error && <p role="alert" className="mt-2 text-xs text-[var(--neg)]">{state.error}</p>}
    </form>
  );
}
