"use client";

/**
 * 「確認済」への切り替え（v6 要件 §1 #5）。誰でもボタン一つで変えられる。記録は取らない。
 */

import { useActionState } from "react";
import { setVerified, type ActionState } from "@/app/projects/[projectId]/cases/actions";
import { VerificationBadge } from "./chrome";

export function VerifyToggle({
  target,
  id,
  projectId,
  variantId,
  verified,
  label,
}: {
  target: "case" | "questions" | "closing" | "strategy" | "material";
  id: string;
  projectId: string;
  variantId?: string;
  verified: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setVerified, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <VerificationBadge verified={verified} label={label} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      {variantId && <input type="hidden" name="variantId" value={variantId} />}
      <input type="hidden" name="value" value={verified ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-9 rounded border border-[var(--line)] px-3 text-xs disabled:opacity-50"
      >
        {pending ? "変更中…" : verified ? "未確認に戻す" : "確認済にする"}
      </button>
      {state.error && <span role="alert" className="text-xs text-[var(--neg)]">{state.error}</span>}
    </form>
  );
}
