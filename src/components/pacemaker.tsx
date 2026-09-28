"use client";

/**
 * ペースメーカー（読み上げ練習）
 *
 * 原稿を出し、経過時間に応じて「ここまで来ているべき」段落を光らせる。
 * 読み手は自分の位置と光っている位置のズレを見るだけでよい。
 *
 * 音声認識は使わない。日本語の専門語は誤認識が集中し、位置がずれたまま
 * 「巻いてください」と誤指示を出しかねない。早口は要項11で別途減点される
 * ので、誤指示は実害になる。読み手は自分がどこを読んでいるか分かっている
 * のだから、目安さえ見えれば足りる。
 *
 * v7 で「ここまで読んだ」（押した位置から着地見込みを出すボタン）は廃止した。
 * 読みながら押すのは手間で、光る位置との比較だけで足りるため。
 */

import { useEffect, useRef, useState } from "react";
import { buildPacingPlan, evaluatePace } from "@/domain/pacing";
import type { DebateCase } from "@/domain/types";
import {
  formatDuration,
  MIN_ACCEPTABLE_SECONDS,
  SPEECH_LIMIT_SECONDS,
} from "@/domain/speech";

/**
 * 光らせる予定の長さ。適正（4分50秒〜5分00秒）のまん中で読み終えるように配分する。
 * 5分ちょうどで配分すると、予定どおり読んでも境目ぎりぎりになる
 */
const PLAN_SECONDS = Math.round((MIN_ACCEPTABLE_SECONDS + SPEECH_LIMIT_SECONDS) / 2);

export function Pacemaker({ debateCase }: { debateCase: DebateCase }) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const baseElapsed = useRef(0);
  const currentRef = useRef<HTMLLIElement | null>(null);

  const plan = buildPacingPlan(debateCase, PLAN_SECONDS);
  const pace = evaluatePace(plan, elapsed, null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const started = startedAt.current;
      if (started === null) return;
      setElapsed(baseElapsed.current + (Date.now() - started) / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [running]);

  // 目安の位置が動いたら、そこが見えるところまで送る
  useEffect(() => {
    if (!running) return;
    currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pace.targetIndex, running]);

  const start = () => {
    startedAt.current = Date.now();
    setRunning(true);
  };
  const stop = () => {
    baseElapsed.current = elapsed;
    startedAt.current = null;
    setRunning(false);
  };
  const reset = () => {
    baseElapsed.current = 0;
    startedAt.current = null;
    setElapsed(0);
    setRunning(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 rounded border-2 border-[var(--accent)] px-4 text-sm font-bold text-[var(--accent)]"
      >
        原稿を見ながら練習する（ペースメーカー）
      </button>
    );
  }

  const remaining = SPEECH_LIMIT_SECONDS - elapsed;
  const over = remaining < 0;

  return (
    <section className="rounded border-2 border-[var(--accent)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span
          className="font-mono text-3xl font-bold tabular-nums"
          style={{ color: over ? "var(--neg)" : "var(--foreground)" }}
        >
          {over ? "+" : ""}
          {formatDuration(Math.floor(Math.abs(remaining)))}
        </span>
        <span className="text-sm text-[var(--muted)]">
          {over ? "超過" : "残り"} / 適正{" "}
          {formatDuration(MIN_ACCEPTABLE_SECONDS)}〜
          {formatDuration(SPEECH_LIMIT_SECONDS)}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto min-h-11 rounded border border-[var(--line)] px-3 text-sm"
        >
          閉じる
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {!running ? (
          <button
            onClick={start}
            className="min-h-12 flex-1 rounded bg-[var(--accent)] px-5 font-bold text-white"
          >
            {elapsed > 0 ? "再開" : "読み始める"}
          </button>
        ) : (
          <button
            onClick={stop}
            className="min-h-12 flex-1 rounded border-2 border-[var(--line)] px-5 font-bold"
          >
            止める
          </button>
        )}
        <button
          onClick={reset}
          disabled={elapsed === 0}
          className="min-h-12 rounded border-2 border-[var(--line)] px-4 disabled:opacity-40"
        >
          リセット
        </button>
      </div>

      <p className="mb-2 text-sm text-[var(--muted)]">
        光っている段落が「いまここまで来ているべき」位置です。
        自分が読んでいる位置が光より後ろなら少し詰め、前なら落ち着いて読んでください。
        予定どおりに読むと、{formatDuration(PLAN_SECONDS)}前後で読み終わります。
      </p>

      <ol className="max-h-96 overflow-y-auto rounded border border-[var(--line)] p-3">
        {plan.chunks.map((chunk, i) => {
          const isTarget = i === pace.targetIndex;
          return (
            <li
              key={chunk.id}
              ref={isTarget ? currentRef : undefined}
              className={`mb-2 rounded p-2 ${
                chunk.kind === "heading" ? "text-sm font-bold" : "leading-8"
              }`}
              style={{
                background: isTarget
                  ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                  : undefined,
              }}
            >
              <span>{chunk.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
