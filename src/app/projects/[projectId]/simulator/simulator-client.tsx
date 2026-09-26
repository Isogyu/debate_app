"use client";

/**
 * 質疑シミュレーター（v6 要件 F11・§4.3・§4.4）
 *
 * 本番の質疑は短いやり取りの積み重ねなので、1発言ずつ進める形にする。
 * 練習を続けてもらうことが目的なので、講評はよかった点から見せる。
 */

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  CASE_ORIGIN_LABELS,
  SIDE_LABELS,
  type CaseOrigin,
  type PracticeFeedback,
  type PracticeMode,
  type PracticeReflection,
  type PracticeTurn,
  type Side,
} from "@/domain/types";
import { finishPractice, sendTurn, startPractice, type SimulatorState } from "./actions";

export interface VariantOption {
  id: string;
  side: Side;
  origin: CaseOrigin;
  label: string;
}

export interface SessionView {
  id: string;
  mode: PracticeMode;
  userVariantId: string;
  userCaseName: string;
  opponentCaseName: string;
  turns: PracticeTurn[];
  feedback?: PracticeFeedback;
  reflection?: PracticeReflection;
  finished: boolean;
  /** 自分の練習か。他の人の練習は見るだけ */
  mine: boolean;
}

const MODES = [
  {
    value: "attack" as const,
    label: "相手に質問する",
    description: "あなたが質問します。AIが相手の立論を守って答えます",
  },
  {
    value: "defense" as const,
    label: "相手から質問される",
    description: "AIが質問します。あなたが自分の立論を守って答えます。準備済みの質疑から優先して出ます",
  },
];

/** 本番の質疑は短い。長引いたら区切るよう促す目安 */
const SUGGEST_FINISH_AFTER = 8;

function optionLabel(v: VariantOption): string {
  return `${SIDE_LABELS[v.side]}・${CASE_ORIGIN_LABELS[v.origin]}｜${v.label}`;
}

export function SimulatorClient({
  projectId,
  variants,
  initialSession,
}: {
  projectId: string;
  variants: VariantOption[];
  initialSession: SessionView | null;
}) {
  if (!initialSession) return <StartForm projectId={projectId} variants={variants} />;
  return <Chat projectId={projectId} session={initialSession} />;
}

function StartForm({ projectId, variants }: { projectId: string; variants: VariantOption[] }) {
  const [state, action, pending] = useActionState<SimulatorState, FormData>(startPractice, {});
  const [userId, setUserId] = useState(variants[0]?.id ?? "");
  const user = variants.find((v) => v.id === userId);
  // 既定は反対側。本番は必ず反対側の立論と戦うため
  const defaultOpponent =
    variants.find((v) => user && v.side !== user.side) ?? variants.find((v) => v.id !== userId);
  const [opponentId, setOpponentId] = useState(defaultOpponent?.id ?? "");
  const opponent = variants.find((v) => v.id === opponentId);

  if (variants.length < 2) {
    return (
      <p className="rounded border-2 border-[var(--line)] p-6 text-center">
        練習には、本文ができている立論が2本以上（ふつうは賛成側と反対側を1本ずつ）必要です。
        <Link href={`/projects/${projectId}`} className="mt-2 block text-[var(--accent)] underline">
          テーマの画面で立論を登録・生成する
        </Link>
      </p>
    );
  }

  const sameSide = user && opponent && user.side === opponent.side;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-bold">自分が守る立論</span>
          <select
            name="userVariantId"
            value={userId}
            onChange={(e) => {
              const next = variants.find((v) => v.id === e.target.value);
              setUserId(e.target.value);
              // 自分の側を変えたら、相手も反対側へ付け替える
              const opp = variants.find((v) => v.id === opponentId);
              if (next && (!opp || opp.side === next.side || opp.id === next.id)) {
                const alt = variants.find((v) => v.side !== next.side);
                if (alt) setOpponentId(alt.id);
              }
            }}
            disabled={pending}
            className="min-h-11 w-full rounded border border-[var(--line)] px-2"
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {optionLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-bold">AIが演じる相手の立論</span>
          <select
            name="opponentVariantId"
            value={opponentId}
            onChange={(e) => setOpponentId(e.target.value)}
            disabled={pending}
            className="min-h-11 w-full rounded border border-[var(--line)] px-2"
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={v.id === userId}>
                {optionLabel(v)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sameSide && (
        <p className="rounded border-2 border-[#b45309] p-3 text-sm">
          2つとも{SIDE_LABELS[user.side]}の立論です。本番の相手は反対側なので、ふつうは反対側を選びます。
          （同じ側どうしでも練習はできます）
        </p>
      )}

      <div>
        <p className="mb-2 font-bold">どちらを練習しますか？</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m, i) => (
            <label
              key={m.value}
              className="flex cursor-pointer gap-3 rounded border-2 border-[var(--line)] p-4 has-checked:border-[var(--accent)]"
            >
              <input
                type="radio"
                name="mode"
                value={m.value}
                defaultChecked={i === 0}
                disabled={pending}
                className="mt-1"
              />
              <span>
                <span className="block font-bold">{m.label}</span>
                <span className="block text-sm text-[var(--muted)]">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">
        AIは選んだ相手の立論に沿って話します。簡単には折れないので、本番と同じように粘って詰めてください。
      </p>

      <button
        type="submit"
        disabled={pending || !userId || !opponentId || userId === opponentId}
        className="w-full rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white disabled:opacity-60"
      >
        {pending ? "準備しています…" : "練習を始める"}
      </button>
    </form>
  );
}

function Chat({ projectId, session }: { projectId: string; session: SessionView }) {
  const [sendState, sendAction, sending] = useActionState<SimulatorState, FormData>(sendTurn, {});
  const [finishState, finishAction, finishing] = useActionState<SimulatorState, FormData>(
    finishPractice,
    {},
  );

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 最新のやり取りは送信結果が持っている（失敗時も自分の発言は残して返る）
  const turns = sendState.turns ?? session.turns;

  useEffect(() => {
    if (sendState.turns && !sendState.error) formRef.current?.reset();
  }, [sendState.turns, sendState.error]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, sending]);

  const userTurns = turns.filter((t) => t.speaker === "user").length;
  const error = sendState.error ?? finishState.error;
  const { finished, feedback, reflection } = session;
  const canWrite = session.mine && !finished;

  return (
    <div>
      <dl className="mb-3 grid gap-1 rounded border border-[var(--line)] p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="text-[var(--muted)]">練習</dt>
        <dd className="font-bold">
          {session.mode === "attack" ? "相手に質問する" : "相手から質問される"}
        </dd>
        <dt className="text-[var(--muted)]">自分の立論</dt>
        <dd>{session.userCaseName}</dd>
        <dt className="text-[var(--muted)]">相手（AI）</dt>
        <dd>{session.opponentCaseName}</dd>
      </dl>

      <p className="mb-3 text-sm text-[var(--muted)]">
        {session.mode === "attack"
          ? "あなたが質問します。相手の答えを受けて追及してください。"
          : "相手が質問してきます。自分の立論を崩さずに答えてください。"}
        <span className="ml-2">やり取り {userTurns} 回</span>
      </p>

      <ul className="mb-4 space-y-3">
        {turns.map((t, i) => (
          <li
            key={i}
            className={
              t.speaker === "user"
                ? "ml-auto max-w-[85%] rounded border-2 border-[var(--accent)] p-3"
                : "mr-auto max-w-[85%] rounded border border-[var(--line)] bg-[var(--line)]/20 p-3"
            }
          >
            <span className="mb-1 block text-xs text-[var(--muted)]">
              {t.speaker === "user" ? "あなた" : "相手（AI）"}
              {t.nodeId && "・準備済みの質疑から"}
            </span>
            <span className="leading-7">{t.text}</span>
          </li>
        ))}
        {sending && (
          <li className="mr-auto rounded border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            相手が考えています…
          </li>
        )}
      </ul>
      <div ref={endRef} />

      {error && (
        <p role="alert" className="mb-3 rounded border-2 border-[var(--neg)] p-3 text-sm">
          {error}
        </p>
      )}

      {!session.mine && !finished && (
        <p className="mb-3 text-sm text-[var(--muted)]">他の人の練習です（途中）。見るだけです。</p>
      )}

      {canWrite && (
        <>
          <form ref={formRef} action={sendAction} className="mb-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <textarea
              name="text"
              rows={3}
              required
              disabled={sending || finishing}
              placeholder={
                session.mode === "attack" ? "質問を入力（本番と同じく、短く1つずつ）" : "回答を入力（短く、聞かれたことに答える）"
              }
              className="w-full rounded border border-[var(--line)] p-3"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={sending || finishing}
                className="min-h-12 rounded bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-60"
              >
                {sending ? "送信中…" : "送信"}
              </button>
            </div>
          </form>

          {userTurns >= SUGGEST_FINISH_AFTER && (
            <p className="mb-2 text-sm text-[var(--muted)]">
              本番の質疑（8分）はこれくらいの長さです。切り上げて講評をもらうのも手です。
            </p>
          )}

          <form action={finishAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              disabled={finishing || sending || userTurns === 0}
              className="min-h-12 w-full rounded border-2 border-[var(--line)] px-5 disabled:opacity-40"
            >
              {finishing ? "講評を作っています…（30秒ほどかかります）" : "練習を終えて講評をもらう"}
            </button>
          </form>
        </>
      )}

      {feedback && <Feedback feedback={feedback} />}
      {reflection && (
        <Reflection
          projectId={projectId}
          mode={session.mode}
          variantId={session.userVariantId}
          reflection={reflection}
        />
      )}
    </div>
  );
}

/** 練習を続けてもらうため、必ずよかった点から見せる */
function Feedback({ feedback }: { feedback: PracticeFeedback }) {
  const sections = [
    { title: "よかった点", items: feedback.strengths, color: "var(--aff)" },
    { title: "次に直すとよい点", items: feedback.weaknesses, color: "var(--neg)" },
    { title: "こう言い換えるとよい", items: feedback.suggestions, color: "var(--accent)" },
  ];

  return (
    <section className="mt-5 rounded border-2 border-[var(--accent)] p-4">
      <h2 className="mb-3 text-lg font-bold">講評</h2>

      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <div key={s.title} className="mb-4">
              <h3 className="mb-2 font-bold" style={{ color: s.color }}>
                {s.title}
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                {s.items.map((item, i) => (
                  <li key={i} className="leading-7">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      <div className="mb-4">
        <h3 className="mb-2 font-bold">総評</h3>
        <p className="leading-7">{feedback.summary}</p>
      </div>

      <div className="mb-4">
        <h3 className="mb-2 font-bold">準備済みの質疑（フローチャート）との照合</h3>
        {feedback.chains.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            準備済みの連鎖に沿ったやり取りはありませんでした。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left">
                  <th className="p-2">引き出したい結論</th>
                  <th className="p-2 whitespace-nowrap">結果</th>
                  <th className="p-2">メモ</th>
                </tr>
              </thead>
              <tbody>
                {feedback.chains.map((c) => (
                  <tr key={c.chainId} className="border-b border-[var(--line)] align-top">
                    <td className="p-2">{c.goal || "（結論の設定なし）"}</td>
                    <td
                      className="p-2 font-bold whitespace-nowrap"
                      style={{ color: c.reached ? "var(--aff)" : "var(--neg)" }}
                    >
                      {c.reached ? "到達した" : "到達しなかった"}
                    </td>
                    <td className="p-2">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-4">
        <h3 className="mb-2 font-bold">1回の発言の長さ</h3>
        {feedback.longTurns.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">長すぎる発言はありませんでした。</p>
        ) : (
          <>
            <p className="mb-1 text-sm text-[var(--muted)]">
              字数から読み上げ時間を推定しました。質疑は8分しかないので、短く区切ってください。
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {feedback.longTurns.map((t, i) => (
                <li key={i}>
                  約{t.seconds}秒: 「{t.excerpt}」
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 判定できない観点を黙って外すと「問題なし」と誤解されるので、明記する（§4.4） */}
      <div className="rounded border border-dashed border-[var(--muted)] p-3 text-sm">
        <h3 className="mb-1 font-bold">テキスト練習では判定しない観点</h3>
        <p className="mb-1 text-[var(--muted)]">
          次は講評に含めていません。本番やチームでの声出し練習で確かめてください。
        </p>
        <ul className="list-disc pl-5">
          {feedback.notJudged.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Reflection({
  projectId,
  mode,
  variantId,
  reflection,
}: {
  projectId: string;
  mode: PracticeMode;
  variantId: string;
  reflection: PracticeReflection;
}) {
  const questionsHref = `/projects/${projectId}/cases/${variantId}?tab=questions`;
  const changed = reflection.stuckNodeIds.length + reflection.addedNodeIds.length > 0;
  const closingParagraphs = useMemo(
    () => (reflection.closingExample ?? "").split(/\n+/).filter(Boolean),
    [reflection.closingExample],
  );

  return (
    <section className="mt-5 rounded border-2 border-[var(--line)] p-4">
      <h2 className="mb-3 text-lg font-bold">練習の結果を反映した内容</h2>
      {mode === "defense" ? (
        <ul className="mb-2 list-disc space-y-1 pl-5">
          <li>詰まった質問の優先度を上げた: {reflection.stuckNodeIds.length}件</li>
          <li>質疑に追加した（練習で出た新しい質問）: {reflection.addedNodeIds.length}件</li>
        </ul>
      ) : (
        <p className="mb-2 text-sm text-[var(--muted)]">
          「相手に質問する」練習では、質疑データへの反映はありません。
        </p>
      )}
      {mode === "defense" && (
        <p className="mb-4 text-sm">
          {changed ? "8分セットも選び直しました。" : ""}
          <Link href={questionsHref} className="text-[var(--accent)] underline">
            自分の立論の質疑を見る
          </Link>
        </p>
      )}

      {closingParagraphs.length > 0 && (
        <div>
          <h3 className="mb-1 font-bold">この練習から作った最終弁論の例（約1分）</h3>
          <p className="mb-2 text-xs text-[var(--muted)]">
            AI生成（未確認）。練習で出た答えを雛形に当てはめた例です。本番の質疑の結果に合わせて書き換えてください。
          </p>
          <div className="rounded bg-[var(--line)]/30 p-3 leading-8">
            {closingParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
