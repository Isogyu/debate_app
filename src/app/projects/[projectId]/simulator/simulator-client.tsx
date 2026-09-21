"use client";

/**
 * 質疑シミュレーター（DESIGN.md §11 SIM）
 *
 * 本番の質疑は短いやり取りの積み重ねなので、1発言ずつ進める形にする。
 * 練習を続けてもらうことが目的なので、終了時のフィードバックは
 * よかった点から見せる。
 */

import { useActionState, useEffect, useRef, useState } from "react";
import type { PracticeFeedback, PracticeMode, PracticeTurn } from "@/domain/types";
import { useOnline } from "@/components/pwa";
import {
  finishPractice,
  sendTurn,
  startPractice,
  type SimulatorState,
} from "./actions";

const MODES = [
  {
    value: "attack" as const,
    label: "相手に質問する",
    description: "あなたが質問者。AIが相手側の立論を守ります",
  },
  {
    value: "defense" as const,
    label: "相手から質問される",
    description: "AIが質問者。あなたが自分の立論を守ります",
  },
];

/** 本番の質疑は短い。長引いたら区切るよう促す目安 */
const SUGGEST_FINISH_AFTER = 6;

export function SimulatorClient({
  projectId,
  initialSession,
}: {
  projectId: string;
  initialSession: {
    id: string;
    mode: PracticeMode;
    turns: PracticeTurn[];
    feedback?: PracticeFeedback;
    finished: boolean;
  } | null;
}) {
  const online = useOnline();

  if (!online) {
    return (
      <p className="rounded border-2 border-[var(--neg)] p-6 text-center">
        質疑練習にはサーバーへの接続が必要です。
        <span className="mt-2 block text-sm text-[var(--muted)]">
          電波がないときは「質疑フロー」の練習モードが使えます。
          こちらは一度開いておけばオフラインでも動きます。
        </span>
      </p>
    );
  }

  if (!initialSession) return <StartForm projectId={projectId} />;
  return <Chat session={initialSession} />;
}

function StartForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<SimulatorState, FormData>(
    startPractice,
    {},
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
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
                <span className="block text-sm text-[var(--muted)]">
                  {m.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">
        AIは生成済みの相手側立論に沿って答えます。簡単には折れないので、
        本番と同じように粘って詰めてください。
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white disabled:opacity-60"
      >
        {pending ? "準備しています…" : "練習を始める"}
      </button>
    </form>
  );
}

function Chat({
  session,
}: {
  session: {
    id: string;
    mode: PracticeMode;
    turns: PracticeTurn[];
    feedback?: PracticeFeedback;
    finished: boolean;
  };
}) {
  const [turns, setTurns] = useState(session.turns);
  const [sendState, sendAction, sending] = useActionState<
    SimulatorState,
    FormData
  >(sendTurn, {});
  const [finishState, finishAction, finishing] = useActionState<
    SimulatorState,
    FormData
  >(finishPractice, {});

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sendState.turns) {
      setTurns(sendState.turns);
      formRef.current?.reset();
    }
  }, [sendState.turns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, sending]);

  const userTurns = turns.filter((t) => t.speaker === "user").length;
  const error = sendState.error ?? finishState.error;
  const finished = session.finished;
  const feedback = session.feedback;

  return (
    <div>
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

      {!finished && (
        <>
          <form ref={formRef} action={sendAction} className="mb-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <textarea
              name="text"
              rows={3}
              required
              disabled={sending || finishing}
              placeholder={
                session.mode === "attack"
                  ? "質問を入力（本番と同じく、短く1つずつ）"
                  : "回答を入力"
              }
              className="w-full rounded border border-[var(--line)] p-3"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={sending || finishing}
                className="rounded bg-[var(--accent)] px-6 py-3 font-bold text-white disabled:opacity-60"
              >
                {sending ? "送信中…" : "送信"}
              </button>
            </div>
          </form>

          {userTurns >= SUGGEST_FINISH_AFTER && (
            <p className="mb-2 text-sm text-[var(--muted)]">
              本番の質疑はこれくらいの長さです。切り上げて講評をもらうのも手です。
            </p>
          )}

          <form action={finishAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              disabled={finishing || sending || userTurns === 0}
              className="w-full rounded border-2 border-[var(--line)] px-5 py-3 disabled:opacity-40"
            >
              {finishing
                ? "講評を作っています…"
                : "練習を終えて講評をもらう"}
            </button>
          </form>
        </>
      )}

      {feedback && <Feedback feedback={feedback} />}
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
      <p className="mb-4">{feedback.summary}</p>

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
    </section>
  );
}
