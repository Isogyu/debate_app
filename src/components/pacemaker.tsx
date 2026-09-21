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
 * より正確に測りたいときのために、段落を読み終えるたびに押す
 * 「ここまで読んだ」を用意した。押した位置から着地見込みを出す。
 */

import { useEffect, useRef, useState } from "react";
import { buildPacingPlan, evaluatePace } from "@/domain/pacing";
import type { DebateCase } from "@/domain/types";
import {
  formatDuration,
  MIN_ACCEPTABLE_SECONDS,
  SPEECH_LIMIT_SECONDS,
} from "@/domain/speech";

const STATE_COLORS = {
  onTrack: "var(--aff)",
  behind: "var(--neg)",
  ahead: "#b45309",
} as const;

export function Pacemaker({ debateCase }: { debateCase: DebateCase }) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const baseElapsed = useRef(0);
  const currentRef = useRef<HTMLLIElement | null>(null);

  const plan = buildPacingPlan(debateCase, SPEECH_LIMIT_SECONDS);
  const pace = evaluatePace(plan, elapsed, position);

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
    setPosition(null);
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
  const projected = pace.projectedSeconds;

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

      {/* 遅れ・進みは、位置を申告したときだけ言う。
          分からないのに指示を出すと早口を招く */}
      <p
        className="mb-3 rounded p-3 text-sm font-bold"
        style={{
          color: STATE_COLORS[pace.state],
          background: `color-mix(in srgb, ${STATE_COLORS[pace.state]} 10%, transparent)`,
        }}
      >
        {pace.message}
        {projected !== null && (
          <span className="mt-1 block font-normal">
            このペースだと {formatDuration(Math.round(projected))} で読み終わります。
          </span>
        )}
      </p>

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
        段落を読み終えるたびに<b>「ここまで読んだ」</b>を押すと、
        着地の見込みが出ます。
      </p>

      <ol className="max-h-96 overflow-y-auto rounded border border-[var(--line)] p-3">
        {plan.chunks.map((chunk, i) => {
          const isTarget = i === pace.targetIndex;
          const isPosition = i === position;
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
                borderLeft: isPosition
                  ? "4px solid var(--aff)"
                  : "4px solid transparent",
              }}
            >
              <span>{chunk.text}</span>
              {chunk.kind === "body" && (
                <button
                  onClick={() => setPosition(i + 1)}
                  className="ml-2 align-middle text-xs text-[var(--accent)] underline"
                >
                  ここまで読んだ
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
