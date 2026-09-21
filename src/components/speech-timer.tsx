"use client";

/**
 * スピーチタイマー（U13）
 *
 * 審査要項より:
 *  - 立論5分、質問8分、最終弁論1分で時間厳守
 *  - 時間オーバーも、30秒以上余るのも減点
 *  - タイムキーパーは1分前と30秒前に合図する
 * 本番と同じ合図を練習でも出す。本番で初めて聞くと動揺するため。
 *
 * 測った結果から読み上げ速度を割り出し、以後の推定に反映する。
 * 推定と実測は必ずずれるので、そのずれを埋める導線がないと数字を信用できない。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHARS_PER_MINUTE, formatDuration } from "@/domain/speech";

/** タイムキーパーが合図する残り秒数（審査要項5） */
const SIGNALS = [60, 30] as const;

/** 種目ごとの持ち時間（審査要項5） */
export const SPEECH_KINDS = [
  { key: "case", label: "立論", seconds: 300, hasMinimum: true },
  { key: "question", label: "質疑", seconds: 480, hasMinimum: false },
  { key: "closing", label: "最終弁論", seconds: 60, hasMinimum: true },
] as const;

export type SpeechKind = (typeof SPEECH_KINDS)[number]["key"];

export function SpeechTimer({
  chars,
  onMeasured,
}: {
  /** 読み上げる文字数。実測から速度を割り出すのに使う */
  chars: number;
  /** 測り終わったときに、割り出した速度を親へ返す */
  onMeasured?: (charsPerMinute: number) => void;
}) {
  const [kindKey, setKindKey] = useState<SpeechKind>("case");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const [signal, setSignal] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const baseElapsed = useRef(0);
  const firedSignals = useRef<Set<number>>(new Set());

  const kind = SPEECH_KINDS.find((k) => k.key === kindKey)!;
  const limit = kind.seconds;

  useEffect(() => {
    if (!running) return;
    // setInterval の積み重ねでは狂うので、開始時刻からの差で出す
    const tick = () => {
      const started = startedAt.current;
      if (started === null) return;
      const next = baseElapsed.current + (Date.now() - started) / 1000;
      setElapsed(next);

      // 本番と同じタイミングで合図を出す
      const left = limit - next;
      for (const at of SIGNALS) {
        if (left <= at && left > at - 1 && !firedSignals.current.has(at)) {
          firedSignals.current.add(at);
          setSignal(at);
          setTimeout(() => setSignal(null), 3000);
        }
      }
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [running, limit]);

  const start = () => {
    startedAt.current = Date.now();
    setRunning(true);
  };

  const pause = () => {
    baseElapsed.current = elapsed;
    startedAt.current = null;
    setRunning(false);
  };

  const finish = useCallback(() => {
    baseElapsed.current = elapsed;
    startedAt.current = null;
    setRunning(false);
    if (elapsed > 5 && chars > 0) {
      const rate = Math.round(chars / (elapsed / 60));
      setMeasured(rate);
      onMeasured?.(rate);
    }
  }, [elapsed, chars, onMeasured]);

  const reset = () => {
    baseElapsed.current = 0;
    startedAt.current = null;
    firedSignals.current = new Set();
    setElapsed(0);
    setRunning(false);
    setMeasured(null);
    setSignal(null);
  };

  const remaining = limit - elapsed;
  const over = remaining < 0;
  // 30秒以上余らせるのも減点なので、そこも赤にする（立論・最終弁論のみ）
  const tooShort = kind.hasMinimum && elapsed > 0 && !running && remaining >= 30;
  const color = over
    ? "var(--neg)"
    : tooShort
      ? "#b45309"
      : remaining <= 30
        ? "var(--aff)"
        : remaining <= 60
          ? "#b45309"
          : "var(--muted)";

  return (
    <section className="rounded border-2 p-4" style={{ borderColor: color }}>
      <div className="mb-3 flex flex-wrap gap-2">
        {SPEECH_KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => {
              setKindKey(k.key);
              reset();
            }}
            disabled={running}
            className={`min-h-11 rounded px-4 text-sm font-bold disabled:opacity-40 ${
              kindKey === k.key
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)]"
            }`}
          >
            {k.label} {Math.round(k.seconds / 60)}分
          </button>
        ))}
      </div>

      <div className="mb-1 text-sm text-[var(--muted)]">
        {over ? "超過時間" : "残り時間"}
      </div>
      <div
        className="mb-3 font-mono text-5xl font-bold tabular-nums"
        style={{ color }}
        // 1秒ごとに読み上げられると邪魔なので、通知はしない
        aria-live="off"
      >
        {over ? "+" : ""}
        {formatDuration(Math.floor(Math.abs(remaining)))}
      </div>

      <div className="mb-3 h-3 w-full overflow-hidden rounded bg-[var(--line)]">
        <div
          className="h-full"
          style={{
            width: `${Math.min((elapsed / limit) * 100, 100)}%`,
            background: color,
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {!running ? (
          <button
            onClick={start}
            className="min-h-12 flex-1 rounded bg-[var(--accent)] px-5 font-bold text-white"
          >
            {elapsed > 0 ? "再開" : "読み上げ開始"}
          </button>
        ) : (
          <button
            onClick={pause}
            className="min-h-12 flex-1 rounded border-2 border-[var(--line)] px-5 font-bold"
          >
            一時停止
          </button>
        )}
        <button
          onClick={finish}
          disabled={elapsed === 0}
          className="min-h-12 rounded border-2 border-[var(--accent)] px-5 font-bold text-[var(--accent)] disabled:opacity-40"
        >
          読み終えた
        </button>
        <button
          onClick={reset}
          disabled={elapsed === 0}
          className="min-h-12 rounded border-2 border-[var(--line)] px-4 disabled:opacity-40"
        >
          リセット
        </button>
      </div>

      {/* 本番のタイムキーパーと同じ合図。練習で慣れておく */}
      {signal !== null && (
        <p
          role="status"
          className="mt-3 rounded bg-[var(--neg)] px-3 py-2 text-center font-bold text-white"
        >
          残り{signal}秒
        </p>
      )}

      <p className="mt-3 text-sm text-[var(--muted)]">
        経過 {formatDuration(Math.floor(elapsed))} / 持ち時間{" "}
        {formatDuration(limit)}
        {kind.hasMinimum && (
          <span className="ml-2">
            （30秒以上余ると減点。適正は残り0〜30秒で読み終わり）
          </span>
        )}
      </p>

      {tooShort && (
        <p className="mt-2 text-sm" style={{ color }}>
          <b>{formatDuration(Math.floor(remaining))}余りました。</b>
          30秒以上余ると減点されます。分量を足してください。
        </p>
      )}

      {measured !== null && (
        <div className="mt-3 rounded bg-[var(--line)]/30 p-3 text-sm">
          <p>
            あなたの読み上げ速度は <b>約{measured}字/分</b> でした
            {measured !== DEFAULT_CHARS_PER_MINUTE && (
              <>（標準は{DEFAULT_CHARS_PER_MINUTE}字/分）</>
            )}
            。
          </p>
          <p className="mt-1 text-[var(--muted)]">
            上の「読む速さ」をこの値に近づけると、推定時間が自分の速さに合います。
            本番は緊張で遅くなるので、少し遅めに見ておくと安全です。
          </p>
        </div>
      )}

      {over && (
        <p className="mt-3 text-sm" style={{ color }}>
          <b>{kind.label}の持ち時間を超えました。</b>
          減点されます。{kind.key === "case" ? "論点を1つ落としてください。" : ""}
        </p>
      )}
    </section>
  );
}
