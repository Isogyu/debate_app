"use client";

/**
 * 立論パターンの追加・削除（A1 立論バリエーション生成）
 *
 * 模擬戦の相手役が1パターンしかないと、同じ相手と何度やっても練習の効果が
 * 頭打ちになる。枠組みや切り口を変えた立論を足して、相手の想定を広げる。
 *
 * 生成は2〜3分かかるので、押したあとは背後で進む。
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Side } from "@/domain/types";
import { useOnline } from "@/components/pwa";
import {
  addVariant,
  deleteVariant,
  retryVariant,
  type ActionState,
} from "./actions";

/** 実物で使われていた枠組み。ゼロから考えさせるより選ばせる方が早い */
const FRAMEWORK_HINTS = [
  "租税公平主義（担税力・公平・中立性）",
  "税の基本原則（公平・中立・簡素）",
  "個人の尊重・自己決定権",
  "制度の安定性・予測可能性",
];

const APPROACH_HINTS = [
  "環境変化型（社会や制度の変化で今こそ変えるべきと論じる）",
  "比較衡量型（現行の利点と変更の利益を比べる）",
  "実務コスト重視（執行・事務負担から論じる）",
  "権利論重視（憲法上の権利から論じる）",
];

export function VariantManager({
  projectId,
  side,
  variantCount,
  generating,
}: {
  projectId: string;
  /** いま見ている側。追加もこの側に対して行う */
  side: Side;
  variantCount: number;
  /** このプロジェクトで生成が動いているか */
  generating: boolean;
}) {
  const online = useOnline();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addVariant,
    {},
  );

  // 生成は背後で進むので、様子を見に行く
  useEffect(() => {
    if (!state.ok) return;
    setOpen(false);
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [state.ok, router]);

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [generating, router]);

  const sideLabel = side === "affirmative" ? "肯定側" : "否定側";

  return (
    <section className="mt-6 border-t border-[var(--line)] pt-5">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="font-bold">
          {sideLabel}の立論パターン（{variantCount}件）
        </h2>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            disabled={!online || generating}
            title={
              generating
                ? "いま生成中です"
                : online
                  ? undefined
                  : "追加には電波が必要です"
            }
            className="min-h-11 rounded border-2 border-[var(--accent)] px-4 text-sm font-bold text-[var(--accent)] disabled:opacity-40"
          >
            ＋ 別の切り口で作る
          </button>
        )}
      </div>

      <p className="mb-3 text-sm text-[var(--muted)]">
        相手の想定パターンを増やすと、模擬戦で当たる立論の幅が広がります。
        同じ相手とばかり練習しても、そのうち効果が薄れます。
      </p>

      {generating && (
        <p className="mb-3 rounded border border-[var(--accent)] p-3 text-sm">
          立論を作っています（2〜3分）。この画面は自動で更新されます。
          閉じても生成は続きます。
        </p>
      )}

      {state.error && (
        <p role="alert" className="mb-3 rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}

      {open && (
        <form action={action} className="rounded border-2 border-[var(--accent)] p-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="side" value={side} />

          <p className="mb-3 text-sm">
            <b>{sideLabel}</b>の立論を、いまと違う切り口で作ります。
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold">評価の枠組み</span>
            <input
              name="framework"
              list="framework-hints"
              disabled={pending}
              placeholder="空欄なら分析結果の枠組みを使います"
              className="w-full rounded border border-[var(--line)] p-2"
            />
            <datalist id="framework-hints">
              {FRAMEWORK_HINTS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              何を物差しにして是非を論じるか。既存パターンと変えると、別の立論になります。
            </span>
          </label>

          <fieldset className="mb-3">
            <legend className="mb-1 text-sm font-bold">2つめの理由の型</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {[
                { v: "environment", l: "環境変化型（今こそ変えるべき）" },
                { v: "comparison", l: "比較衡量型（利点と利益を比べる）" },
              ].map((o, i) => (
                <label key={o.v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="secondBlock"
                    value={o.v}
                    defaultChecked={i === 0}
                    disabled={pending}
                  />
                  {o.l}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-bold">切り口のメモ（任意）</span>
            <input
              name="approachHint"
              list="approach-hints"
              disabled={pending}
              placeholder="例: 実務コスト重視"
              className="w-full rounded border border-[var(--line)] p-2"
            />
            <datalist id="approach-hints">
              {APPROACH_HINTS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>

          <p className="mb-3 text-xs text-[var(--muted)]">
            ※生成に2〜3分かかります。押したあとは閉じても大丈夫です。
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="min-h-11 rounded border border-[var(--line)] px-4 text-sm"
            >
              やめる
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded bg-[var(--accent)] px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? "開始しています…" : "この条件で作る"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** 作りかけや不要になったパターンを消す */
export function DeleteVariantButton({
  variantId,
  label,
}: {
  variantId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    deleteVariant,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded border border-[var(--line)] px-3 text-sm text-[var(--muted)]"
      >
        このパターンを削除
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      <span className="text-sm">「{label}」を削除しますか？</span>
      {state.error && (
        <span className="text-sm text-[var(--neg)]">{state.error}</span>
      )}
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-11 rounded border border-[var(--line)] px-3 text-sm"
      >
        やめる
      </button>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded border-2 border-[var(--neg)] px-3 text-sm font-bold text-[var(--neg)] disabled:opacity-40"
      >
        {pending ? "削除中…" : "削除する"}
      </button>
    </form>
  );
}


/**
 * 作りかけのまま失敗したパターンの受け皿。
 * 「作っています」と出したまま放置すると、いつまでも待たせることになる。
 */
export function VariantFailure({
  variantId,
  label,
  message,
}: {
  variantId: string;
  label: string;
  message: string;
}) {
  const online = useOnline();
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    retryVariant,
    {},
  );

  useEffect(() => {
    if (!state.ok) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [state.ok, router]);

  return (
    <div className="rounded border-2 border-[var(--neg)] p-5">
      <p className="mb-2 font-bold">このパターンを作れませんでした</p>
      <p className="mb-1 text-sm">{message}</p>
      <p className="mb-4 text-sm text-[var(--muted)]">{label}</p>

      {state.error && (
        <p role="alert" className="mb-3 text-sm text-[var(--neg)]">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="variantId" value={variantId} />
          <button
            type="submit"
            disabled={pending || !online}
            className="min-h-11 rounded bg-[var(--accent)] px-5 text-sm font-bold text-white disabled:opacity-40"
          >
            {pending ? "やり直しています…" : "もう一度作る"}
          </button>
        </form>
        <DeleteVariantButton variantId={variantId} label={label} />
      </div>
    </div>
  );
}
