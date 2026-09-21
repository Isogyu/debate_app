"use client";

/**
 * 立論画面（DESIGN.md §5 CASE）
 *
 *  - 実フォーマット（Ⅰ主張／Ⅱ理由／Ⅲ結論）をそのまま画面構造にする
 *  - 【資料N参照】は資料要件画面の該当箇所へのリンクにする（相互リンク）
 *  - 編集・再生成はカード単位。全体を巻き込まない（§14 壊さない編集）
 */

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { splitRefs, SECTION_TYPE_LABELS } from "@/domain/case-format";
import { useOnline } from "@/components/pwa";
import { SpeechMeter } from "@/components/speech-meter";
import {
  DeleteVariantButton,
  VariantFailure,
  VariantManager,
} from "./variant-manager";
import type { Claim, DebateCase, Side } from "@/domain/types";
import {
  adoptVariant,
  regenerateClaim,
  saveCaseFrame,
  saveClaim,
  type ActionState,
} from "./actions";

export interface VariantView {
  id: string;
  side: Side;
  framework: string;
  approach: string;
  role: string;
  debateCase: DebateCase;
  /** 生成に失敗したときの理由。作りかけのまま止まっている場合に入る */
  buildError?: string;
  /** 資料番号 → その資料が証明すること。リンクのホバーに出す */
  refTitles: Record<number, string>;
}

const ROLE_LABELS: Record<string, string> = {
  adopted: "採用",
  candidate: "候補",
  opponent_prediction: "相手の想定",
  practice: "練習用",
};

export function CaseView({
  projectId,
  variants,
  categoryNames,
  generating = false,
}: {
  projectId: string;
  variants: VariantView[];
  categoryNames: Record<string, string>;
  /** 立論パターンの生成が動いているか */
  generating?: boolean;
}) {
  const [side, setSide] = useState<Side>(
    variants.find((v) => v.role === "adopted")?.side ??
      variants[0]?.side ??
      "affirmative",
  );
  const sideVariants = variants.filter((v) => v.side === side);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [wordPreview, setWordPreview] = useState(false);

  const variant =
    sideVariants.find((v) => v.id === variantId) ?? sideVariants[0];

  if (!variant) {
    return (
      <div>
        <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
          この側の立論はまだ生成されていません。
        </p>
        <VariantManager
          projectId={projectId}
          side={side}
          variantCount={0}
          generating={generating}
        />
      </div>
    );
  }

  // 生成の途中は中身が空。編集画面を出しても操作できない
  const building = variant.debateCase.sections.length === 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--line)] pb-4">
        <div className="flex gap-1">
          {(["affirmative", "negative"] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSide(s);
                setVariantId(null);
              }}
              className={`rounded px-4 py-2 font-bold ${
                side === s
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)]"
              }`}
            >
              {s === "affirmative" ? "肯定側" : "否定側"}
            </button>
          ))}
        </div>

        {sideVariants.length > 1 && (
          <label className="text-sm">
            <span className="mr-2 text-[var(--muted)]">パターン:</span>
            <select
              value={variant.id}
              onChange={(e) => setVariantId(e.target.value)}
              className="rounded border border-[var(--line)] p-2"
            >
              {sideVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.framework} / {v.approach}（{ROLE_LABELS[v.role] ?? v.role}）
                </option>
              ))}
            </select>
          </label>
        )}

        {/* パターンが1つしかないうちは「採用」「候補」に意味がない。
            複数パターン生成を実装するまでは出さない（用語が通じない） */}
        {sideVariants.length > 1 && (
          <span className="rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)]">
            {ROLE_LABELS[variant.role] ?? variant.role}
          </span>
        )}

        <button
          onClick={() => setWordPreview(!wordPreview)}
          className="ml-auto rounded border border-[var(--line)] px-3 py-2 text-sm"
        >
          {wordPreview ? "構造表示にする" : "Wordプレビュー"}
        </button>
      </div>

      {building && variant.buildError ? (
        <VariantFailure
          variantId={variant.id}
          label={`${variant.framework} / ${variant.approach}`}
          message={variant.buildError}
        />
      ) : building ? (
        <p className="rounded border border-[var(--accent)] p-6 text-center">
          このパターンを作っています（2〜3分）。
          <span className="mt-1 block text-sm text-[var(--muted)]">
            {variant.framework} / {variant.approach}
          </span>
        </p>
      ) : (
        <>
          {/* 時間は超過も余りすぎも減点なので、見ているあいだ常に出す */}
          <SpeechMeter
            text={variant.debateCase.fullText}
            debateCase={variant.debateCase}
          />

          {wordPreview ? (
            <WordPreview text={variant.debateCase.fullText} />
          ) : (
            <StructuredView
              projectId={projectId}
              variant={variant}
              categoryNames={categoryNames}
            />
          )}
        </>
      )}

      {/* 中身が無いパターンは採用できない。
          削除の導線も、失敗カードの中に既にあるので二重に出さない */}
      {!building && sideVariants.length > 1 && (
        <>
          {variant.role !== "adopted" &&
            variant.role !== "opponent_prediction" && (
              <AdoptButton variantId={variant.id} />
            )}
          <div className="mt-4">
            <DeleteVariantButton
              variantId={variant.id}
              label={`${variant.framework} / ${variant.approach}`}
            />
          </div>
        </>
      )}

      <VariantManager
        projectId={projectId}
        side={side}
        variantCount={sideVariants.length}
        generating={generating}
      />
    </div>
  );
}

/** エクスポートしたときの見た目をそのまま確認する */
function WordPreview({ text }: { text: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-white p-8 text-black">
      <pre className="whitespace-pre-wrap font-[inherit] leading-8">{text}</pre>
    </div>
  );
}

function StructuredView({
  projectId,
  variant,
  categoryNames,
}: {
  projectId: string;
  variant: VariantView;
  categoryNames: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      {/* 実フォーマットの Ⅰ→Ⅱ→Ⅲ の順に出す。
          編集は主張と結論をまとめて扱うが、表示順は崩さない */}
      <FrameEditor projectId={projectId} variant={variant} part="claim" />

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
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <FrameEditor projectId={projectId} variant={variant} part="conclusion" />
    </div>
  );
}

/**
 * Ⅰ.主張 と Ⅲ.結論。
 * 編集はひとつのフォームで両方を扱うが、表示は実フォーマットの位置に分けて出す。
 */
function FrameEditor({
  projectId,
  variant,
  part,
}: {
  projectId: string;
  variant: VariantView;
  part: "claim" | "conclusion";
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveCaseFrame,
    {},
  );
  const [editing, setEditing] = useState(false);
  const online = useOnline();

  // 保存できたら編集フォームを閉じる。開いたままだと保存されたか分からない
  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state.ok]);

  if (!editing) {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {part === "claim" ? "Ⅰ. 主張" : "Ⅲ. 結論"}
          </h2>
          <button
            onClick={() => setEditing(true)}
            disabled={!online}
            title={online ? undefined : "オフラインでは編集できません"}
            className="min-h-11 rounded border border-[var(--line)] px-4 text-sm disabled:opacity-40"
          >
            編集
          </button>
        </div>
        <p className="rounded border border-[var(--line)] p-4">
          {part === "claim"
            ? variant.debateCase.claim
            : variant.debateCase.conclusion}
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
        <textarea
          name="claim"
          rows={2}
          defaultValue={variant.debateCase.claim}
          className="w-full rounded border border-[var(--line)] p-2"
        />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block font-bold">Ⅲ. 結論</span>
        <textarea
          name="conclusion"
          rows={2}
          defaultValue={variant.debateCase.conclusion}
          className="w-full rounded border border-[var(--line)] p-2"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded border border-[var(--line)] px-4 py-2 text-sm"
        >
          やめる
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
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
}: {
  projectId: string;
  variant: VariantView;
  claim: Claim;
  index: number;
  categoryNames: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    saveClaim,
    {},
  );
  const [regenState, regenAction, regenerating] = useActionState<
    ActionState,
    FormData
  >(regenerateClaim, {});

  const online = useOnline();

  useEffect(() => {
    if (saveState.ok) setEditing(false);
  }, [saveState.ok]);

  const error = saveState.error ?? regenState.error;

  if (editing) {
    return (
      <form
        action={saveAction}
        className="rounded border-2 border-[var(--accent)] p-4"
      >
        <input type="hidden" name="variantId" value={variant.id} />
        <input type="hidden" name="claimId" value={claim.id} />
        {error && (
          <p role="alert" className="mb-2 text-sm text-[var(--neg)]">
            {error}
          </p>
        )}
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-bold">見出し</span>
          <input
            name="title"
            defaultValue={claim.title}
            className="w-full rounded border border-[var(--line)] p-2"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-bold">本文</span>
          <textarea
            name="claim"
            rows={5}
            defaultValue={claim.claim}
            className="w-full rounded border border-[var(--line)] p-2"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-bold">理由づけ</span>
          <textarea
            name="warrant"
            rows={3}
            defaultValue={claim.warrant}
            className="w-full rounded border border-[var(--line)] p-2"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-bold">効果</span>
          <textarea
            name="impact"
            rows={2}
            defaultValue={claim.impact}
            className="w-full rounded border border-[var(--line)] p-2"
          />
        </label>
        <p className="mb-3 text-xs text-[var(--muted)]">
          ※ 本文中の【資料N参照】はそのまま残してください。消すと資料要件との対応が切れます。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border border-[var(--line)] px-4 py-2 text-sm"
          >
            やめる
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "保存中…" : "保存する"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="rounded border border-[var(--line)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b>
          （{index}）{claim.title}
        </b>
        {claim.categoryIds.map((id) => (
          <span
            key={id}
            className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs"
          >
            {categoryNames[id] ?? "?"}
          </span>
        ))}
      </div>

      <p className="leading-7">
        <RefText
          text={claim.claim}
          projectId={projectId}
          variantId={variant.id}
          refTitles={variant.refTitles}
        />
      </p>
      {claim.warrant && (
        <p className="mt-2 leading-7 text-[var(--muted)]">
          <RefText
            text={claim.warrant}
            projectId={projectId}
            variantId={variant.id}
            refTitles={variant.refTitles}
          />
        </p>
      )}
      {claim.causalChain.length > 0 && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
          {claim.causalChain.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => setEditing(true)}
          disabled={!online}
          title={online ? undefined : "オフラインでは編集できません"}
          className="rounded border border-[var(--line)] px-3 py-1 text-sm disabled:opacity-40"
        >
          編集
        </button>
        <form action={regenAction}>
          <input type="hidden" name="variantId" value={variant.id} />
          <input type="hidden" name="claimId" value={claim.id} />
          <button
            type="submit"
            disabled={regenerating || !online}
            title={online ? undefined : "再生成には電波が必要です"}
            className="rounded border border-[var(--line)] px-3 py-1 text-sm disabled:opacity-40"
          >
            {regenerating ? "再生成中…" : "この部分を再生成"}
          </button>
        </form>
      </div>
    </article>
  );
}

/** 【資料N参照】を資料要件画面へのリンクにする */
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
            href={`/projects/${projectId}/sources?variant=${variantId}#ref-${part.number}`}
            title={refTitles[part.number] ?? "この資料の要件を見る"}
            // 読み上げ名に表示文字そのものを含める。title だけだと
            // 画面に見えている「【資料N参照】」と読み上げが食い違う
            aria-label={`${part.value} ${refTitles[part.number] ?? ""}`.trim()}
            // スマホで押せる大きさにする。文中のリンクは行を崩さないよう
            // 縦の余白で高さを稼ぐ（指の当たり判定を広げる）
            className="inline-block min-h-11 py-2 align-middle text-[var(--accent)] underline underline-offset-2"
          >
            {part.value}
          </Link>
        ),
      )}
    </>
  );
}

function AdoptButton({ variantId }: { variantId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    adoptVariant,
    {},
  );
  return (
    <form action={action} className="mt-6 border-t border-[var(--line)] pt-4">
      <input type="hidden" name="variantId" value={variantId} />
      {state.error && (
        <p className="mb-2 text-sm text-[var(--neg)]">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded border-2 border-[var(--accent)] px-5 py-2 font-bold text-[var(--accent)] disabled:opacity-60"
      >
        {pending ? "変更中…" : "このパターンを採用する"}
      </button>
      <span className="ml-3 text-sm text-[var(--muted)]">
        採用したパターンの資料番号が、参考資料のエクスポートに使われます。
      </span>
    </form>
  );
}
