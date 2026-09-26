"use client";

/**
 * 試合で使う質疑（連鎖）を選ぶ・外す・並べ替えるボタン。
 * どの質疑を使うかはゼミ生が決める（自動の「8分セット」は廃止）。
 */

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { selectChain, type ActionState } from "@/app/projects/[projectId]/cases/actions";

export function ChainSelectButton({
  projectId,
  variantId,
  chainId,
  order,
  canMove = false,
  isLast = false,
}: {
  projectId: string;
  variantId: string;
  chainId: string;
  /** 選んだ順番。選んでいなければ null */
  order: number | null | undefined;
  canMove?: boolean;
  isLast?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await selectChain(prev, fd);
    // 分岐図（クライアント側）でも選んだ状態がすぐ見えるように読み直す
    if (r.ok) router.refresh();
    return r;
  }, {});
  const selected = typeof order === "number";

  const button = (op: "add" | "remove" | "up" | "down", label: string, primary = false, disabled = false) => (
    <form action={action} onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="chainId" value={chainId} />
      <input type="hidden" name="op" value={op} />
      <button
        type="submit"
        disabled={pending || disabled}
        aria-label={label}
        className={`min-h-9 rounded px-3 text-sm disabled:opacity-40 ${
          primary
            ? "bg-[var(--accent)] font-bold text-white"
            : "border border-[var(--line)] bg-white hover:border-[var(--accent)]"
        }`}
      >
        {label}
      </button>
    </form>
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected ? (
        <>
          <span className="mr-1 rounded bg-[var(--accent)] px-2 py-0.5 text-xs font-bold text-white">
            使う {order}番目
          </span>
          {canMove && button("up", "↑", false, order === 1)}
          {canMove && button("down", "↓", false, isLast)}
          {button("remove", "外す")}
        </>
      ) : (
        button("add", "この質疑を使う", true)
      )}
      {state.error && <span role="alert" className="text-xs text-[var(--neg)]">{state.error}</span>}
    </div>
  );
}
