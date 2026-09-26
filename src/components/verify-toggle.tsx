"use client";

/**
 * 「確認済」への切り替え（v6 要件 §1 #5）。誰でもボタン一つで変えられる。記録は取らない。
 */

import { useActionState } from "react";
import { setVerified, type ActionState } from "@/app/projects/[projectId]/cases/actions";
import { VerificationBadge } from "./chrome";

/** 何を確かめたら「確認済」にしてよいか（押す基準を画面に出す） */
const CHECK_GUIDE: Record<"case" | "questions" | "closing" | "strategy" | "material", string> = {
  case: "本文を読み、論理のつながりと【資料N参照】の資料が主張を支えているかを確かめたら押してください。",
  questions: "質問と模範回答を読み、立論と矛盾しないか・試合で使える言い方かを確かめたら押してください。",
  closing: "雛形と記入例を読み、質疑の内容と合っているか・新しい論点が入っていないかを確かめたら押してください。",
  strategy: "特徴と戦い方を読み、チームの方針と合っているかを確かめたら押してください。",
  material: "出典のリンクを開き、引用文・数値が元の資料と一致しているかを確かめたら押してください。",
};

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
    <div>
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
    {!verified && (
      <p className="mt-1 text-xs text-[var(--muted)]">
        AIが作ったものは、人が確かめるまで「未確認」です。{CHECK_GUIDE[target]}
      </p>
    )}
    </div>
  );
}
