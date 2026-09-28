"use client";

/**
 * 立論を生成する（v7）
 *
 * 各側の評価基準の枠組みを確認・修正して、生成を始める。
 * 以前は「論題の分析」画面にあった「この内容で生成開始」をここへ移した。
 * 各側3本まで。上限に達した側のボタンは押せない。
 */

import { useActionState } from "react";
import { keepInputs } from "@/components/keep-inputs";
import { SideBadge } from "@/components/chrome";
import { generateFromSettings, type FormState } from "../../actions";
import { MAX_GENERATED_PER_SIDE, SIDE_LABELS, type Side } from "@/domain/types";

export interface FrameworkData {
  name: string;
  basisLaw?: string;
  criteria: string[];
}

export function GenerateForm({
  projectId,
  frameworks,
  generated,
}: {
  projectId: string;
  frameworks: Record<Side, FrameworkData>;
  generated: Record<Side, number>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(generateFromSettings, {});
  const noneYet = generated.affirmative === 0 && generated.negative === 0;

  return (
    <form onSubmit={keepInputs((fd) => action(fd))} className="space-y-6">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}
      {!state.error && state.ok && !pending && (
        <p role="status" className="rounded border-2 border-[var(--aff)] p-3 text-sm">
          保存しました。
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(["affirmative", "negative"] as Side[]).map((side) => {
          const key = side === "affirmative" ? "aff" : "neg";
          const fw = frameworks[side];
          const done = generated[side];
          const remaining = Math.max(0, MAX_GENERATED_PER_SIDE - done);
          const color = side === "affirmative" ? "var(--aff)" : "var(--neg)";
          return (
            <section key={side} className="rounded border-2 p-4" style={{ borderColor: color }}>
              <h2 className="mb-1 flex items-center gap-2 font-bold">
                <SideBadge side={side} /> {SIDE_LABELS[side]}
              </h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                生成済み {done}本 / {MAX_GENERATED_PER_SIDE}本
              </p>
              <label className="mb-2 block">
                <span className="mb-1 block text-sm font-bold">評価基準の枠組み</span>
                <input
                  name={`${key}Framework`}
                  defaultValue={fw.name}
                  disabled={pending}
                  placeholder="例: 租税公平主義"
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-sm font-bold">根拠となる法令・原則（任意）</span>
                <input
                  name={`${key}BasisLaw`}
                  defaultValue={fw.basisLaw ?? ""}
                  disabled={pending}
                  placeholder="例: 日本国憲法14条1項"
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-bold">評価基準（読点区切り）</span>
                <input
                  name={`${key}Criteria`}
                  defaultValue={fw.criteria.join("、")}
                  disabled={pending}
                  placeholder="例: 担税力、公平、中立"
                  className="w-full rounded border border-[var(--line)] p-2"
                />
              </label>
              {!noneYet && (
                <button
                  type="submit"
                  name="side"
                  value={side}
                  disabled={pending || remaining === 0}
                  className="min-h-11 w-full rounded bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-40"
                >
                  {remaining === 0
                    ? `生成は各側${MAX_GENERATED_PER_SIDE}本までです`
                    : done === 0
                      ? `この内容で${SIDE_LABELS[side]}を生成（残り${remaining}本）`
                      : `この内容で別の切り口をもう1本（残り${remaining}本）`}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] pt-5">
        <button
          type="submit"
          name="side"
          value="save"
          disabled={pending}
          className="min-h-11 rounded border-2 border-[var(--line)] px-5 text-sm disabled:opacity-60"
        >
          枠組みの修正だけ保存する
        </button>
        {noneYet && (
          <button
            type="submit"
            name="side"
            value="both"
            disabled={pending}
            className="min-h-12 rounded bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-60"
          >
            {pending ? "開始しています…" : "この内容で生成開始（賛成側・反対側を1本ずつ）→"}
          </button>
        )}
      </div>
      <p className="text-right text-sm text-[var(--muted)]">
        生成には数分〜十数分かかります。この画面やテーマの画面を開いたままにすると止まらずに進みます。
        閉じると数分後にサーバーが休止して生成も一時停止し、次にアプリを開いたときに続きから再開します。
      </p>
    </form>
  );
}
