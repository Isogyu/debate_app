"use client";

/**
 * 立論の本文タブ（v6）
 *
 *  - 実フォーマット（Ⅰ主張／Ⅱ理由／Ⅲ結論）をそのまま画面構造にする
 *  - 【資料N参照】は資料タブの該当箇所へのリンクにする
 *  - 編集はカード単位。再生成は生成立論だけ（自作の立論はAIで書き換えない）
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { splitRefs, SECTION_TYPE_LABELS } from "@/domain/case-format";
import { SpeechMeter } from "@/components/speech-meter";
import type { Claim, DebateCase } from "@/domain/types";
import {
  regenerateClaim,
  saveCaseFrame,
  saveClaim,
  type ActionState,
} from "../actions";

export interface BodyVariant {
  id: string;
  origin: "uploaded" | "generated";
  debateCase: DebateCase;
  refTitles: Record<number, string>;
}

export function BodyTab({
  projectId,
  variant,
  categoryNames,
  readOnly,
}: {
  projectId: string;
  variant: BodyVariant;
  categoryNames: Record<string, string>;
  readOnly: boolean;
}) {
  const [wordPreview, setWordPreview] = useState(false);
  return (
    <div>
      {/* 時間は超過も余りすぎも減点なので、見ているあいだ常に出す */}
      <SpeechMeter
        text={variant.debateCase.fullText}
        debateCase={variant.debateCase}
        adviseFixes={variant.origin === "generated"}
      />
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setWordPreview(!wordPreview)}
          className="min-h-11 rounded border border-[var(--line)] px-3 text-sm"
        >
          {wordPreview ? "構造表示にする" : "原稿の形で見る"}
        </button>
      </div>
      {wordPreview ? (
        <div className="rounded border border-[var(--line)] bg-white p-6 text-black sm:p-8">
          <pre className="whitespace-pre-wrap font-[inherit] leading-8">{variant.debateCase.fullText}</pre>
        </div>
      ) : (
        <div className="space-y-6">
          <FrameEditor variant={variant} part="claim" readOnly={readOnly} />
          <section>
            <h2 className="mb-3 text-lg font-bold">Ⅱ. 理由</h2>
            {variant.debateCase.sections.map((section, i) => (
              <div key={section.id} className="mb-5">
                <div className="mb-2 rounded bg-[var(--line)]/40 p-3">
                  <b>
                    {i + 1}. {section.title}
                  </b>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {SECTION_TYPE_LABELS[section.type] ?? section.type}
                  </span>
                </div>
                <div className="space-y-3 pl-2">
                  {section.subsections.map((claim, j) => (
                    <ClaimCard
                      key={claim.id}
                      projectId={projectId}
                      variant={variant}
                      claim={claim}
                      index={j + 1}
                      categoryNames={categoryNames}
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
          <FrameEditor variant={variant} part="conclusion" readOnly={readOnly} />
        </div>
      )}
    </div>
  );
}

function FrameEditor({
  variant,
  part,
  readOnly,
}: {
  variant: BodyVariant;
  part: "claim" | "conclusion";
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCaseFrame, {});
  const [editing, setEditing] = useState(false);
  const [handled, setHandled] = useState<ActionState | null>(null);
  // 保存できたら編集フォームを閉じる（状態が変わった1回だけ）
  if (state.ok && handled !== state) {
    setHandled(state);
    setEditing(false);
  }

  if (!editing) {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">{part === "claim" ? "Ⅰ. 主張" : "Ⅲ. 結論"}</h2>
          {!readOnly && (
            <button onClick={() => setEditing(true)} className="min-h-11 rounded border border-[var(--line)] px-4 text-sm">
              編集
            </button>
          )}
        </div>
        <p className="rounded border border-[var(--line)] p-4">
          {part === "claim" ? variant.debateCase.claim : variant.debateCase.conclusion}
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="rounded border-2 border-[var(--accent)] p-4">
      <input type="hidden" name="variantId" value={variant.id} />
      {state.error && (
        <p role="alert" className="mb-2 text-sm text-[var(--neg)]">
          {state.error}
        </p>
      )}
      <label className="mb-3 block">
        <span className="mb-1 block font-bold">Ⅰ. 主張</span>
        <textarea name="claim" rows={2} defaultValue={variant.debateCase.claim} className="w-full rounded border border-[var(--line)] p-2" />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block font-bold">Ⅲ. 結論</span>
        <textarea name="conclusion" rows={2} defaultValue={variant.debateCase.conclusion} className="w-full rounded border border-[var(--line)] p-2" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} className="rounded border border-[var(--line)] px-4 py-2 text-sm">
          やめる
        </button>
        <button type="submit" disabled={pending} className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {pending ? "保存中…" : "保存する"}
        </button>
      </div>
    </form>
  );
}

function ClaimCard({
  projectId,
  variant,
  claim,
  index,
  categoryNames,
  readOnly,
}: {
  projectId: string;
  variant: BodyVariant;
  claim: Claim;
  index: number;
  categoryNames: Record<string, string>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(saveClaim, {});
  const [regenState, regenAction, regenerating] = useActionState<ActionState, FormData>(regenerateClaim, {});
  const [handled, setHandled] = useState<ActionState | null>(null);
  if (saveState.ok && handled !== saveState) {
    setHandled(saveState);
    setEditing(false);
  }
  const error = saveState.error ?? regenState.error;

  if (editing) {
    return (
      <form action={saveAction} className="rounded border-2 border-[var(--accent)] p-4">
        <input type="hidden" name="variantId" value={variant.id} />
        <input type="hidden" name="claimId" value={claim.id} />
        {error && (
          <p role="alert" className="mb-2 text-sm text-[var(--neg)]">
            {error}
          </p>
        )}
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-bold">見出し</span>
          <input name="title" defaultValue={claim.title} className="w-full rounded border border-[var(--line)] p-2" />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-bold">本文</span>
          <textarea name="claim" rows={6} defaultValue={claim.claim} className="w-full rounded border border-[var(--line)] p-2" />
        </label>
        {variant.origin === "generated" && (
          <>
            <label className="mb-2 block">
              <span className="mb-1 block text-sm font-bold">理由づけ</span>
              <textarea name="warrant" rows={3} defaultValue={claim.warrant} className="w-full rounded border border-[var(--line)] p-2" />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-bold">効果</span>
              <textarea name="impact" rows={2} defaultValue={claim.impact} className="w-full rounded border border-[var(--line)] p-2" />
            </label>
          </>
        )}
        {variant.origin === "uploaded" && (
          <>
            <input type="hidden" name="warrant" value={claim.warrant} />
            <input type="hidden" name="impact" value={claim.impact} />
          </>
        )}
        <p className="mb-3 text-xs text-[var(--muted)]">
          ※ 本文中の【資料N参照】はそのまま残してください。消すと資料との対応が切れます。
          数字を書き足した場合は、その数字の資料があるかを確かめてください。
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded border border-[var(--line)] px-4 py-2 text-sm">
            やめる
          </button>
          <button type="submit" disabled={saving} className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "保存中…" : "保存する"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <article id={`claim-${claim.id}`} className="rounded border border-[var(--line)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b>
          （{index}）{claim.title}
        </b>
        {claim.categoryIds.map((id) => (
          <span key={id} className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs">
            {categoryNames[id] ?? "?"}
          </span>
        ))}
      </div>
      <p className="leading-7">
        <RefText text={claim.claim} projectId={projectId} variantId={variant.id} refTitles={variant.refTitles} />
      </p>
      {claim.warrant && (
        <p className="mt-2 leading-7">
          <RefText text={claim.warrant} projectId={projectId} variantId={variant.id} refTitles={variant.refTitles} />
        </p>
      )}
      {claim.impact && (
        <p className="mt-2 leading-7">
          <RefText text={claim.impact} projectId={projectId} variantId={variant.id} refTitles={variant.refTitles} />
        </p>
      )}
      {claim.causalChain.length > 0 && (
        <details className="mt-3 text-sm text-[var(--muted)]">
          <summary className="cursor-pointer">因果のメモ（読み上げない）</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {claim.causalChain.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}
      {!readOnly && (
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setEditing(true)} className="min-h-9 rounded border border-[var(--line)] px-3 text-sm">
            編集
          </button>
          {variant.origin === "generated" && (
            <form action={regenAction}>
              <input type="hidden" name="variantId" value={variant.id} />
              <input type="hidden" name="claimId" value={claim.id} />
              <button type="submit" disabled={regenerating} className="min-h-9 rounded border border-[var(--line)] px-3 text-sm disabled:opacity-40">
                {regenerating ? "再生成中…" : "この部分を再生成"}
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

/** 【資料N参照】（資料N）を資料タブへのリンクにする */
function RefText({
  text,
  projectId,
  variantId,
  refTitles,
}: {
  text: string;
  projectId: string;
  variantId: string;
  refTitles: Record<number, string>;
}) {
  return (
    <>
      {splitRefs(text).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.value}</span>
        ) : (
          <Link
            key={i}
            href={`/projects/${projectId}/cases/${variantId}?tab=sources#ref-${part.number}`}
            title={refTitles[part.number] ?? "この資料を見る"}
            aria-label={`${part.value} ${refTitles[part.number] ?? ""}`.trim()}
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {part.value}
          </Link>
        ),
      )}
    </>
  );
}
