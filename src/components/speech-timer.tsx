"use client";

/**
 * スピーチタイマー（U13）
 *
 * 5分超過で減点されるため、推定値だけでは足りない。実際に読んで測る。
 * 測った結果から読み上げ速度を割り出し、以後の推定に反映できるようにする。
 * 推定と実測は必ずずれるので、そのずれを埋める導線がないと数字を信用できない。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CHARS_PER_MINUTE,
  formatDuration,
  SPEECH_LIMIT_SECONDS,
} from "@/domain/speech";

/** 残りこの秒数を切ったら色と文言で知らせる */
const CAUTION_SECONDS = 60;
const DANGER_SECONDS = 20;

export function SpeechTimer({
  chars,
  onMeasured,
}: {
  /** 読み上げる文字数。実測から速度を割り出すのに使う */
  chars: number;
  /** 測り終わったときに、割り出した速度を親へ返す */
  onMeasured?: (charsPerMinute: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const baseElapsed = useRef(0);

  useEffect(() => {
    if (!running) return;
    // setInterval の積み重ねでは狂うので、開始時刻からの差で出す
    const tick = () => {
      const started = startedAt.current;
      if (started === null) return;
      setElapsed(baseElapsed.current + (Date.now() - started) / 1000);
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [running]);

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
    setElapsed(0);
    setRunning(false);
    setMeasured(null);
  };

  const remaining = SPEECH_LIMIT_SECONDS - elapsed;
  const over = remaining < 0;
  const color = over
    ? "var(--neg)"
    : remaining <= DANGER_SECONDS
      ? "var(--neg)"
      : remaining <= CAUTION_SECONDS
        ? "#b45309"
        : "var(--aff)";

  return (
    <section className="rounded border-2 p-4" style={{ borderColor: color }}>
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
            width: `${Math.min((elapsed / SPEECH_LIMIT_SECONDS) * 100, 100)}%`,
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

      <p className="mt-3 text-sm text-[var(--muted)]">
        経過 {formatDuration(Math.floor(elapsed))} / 持ち時間{" "}
        {formatDuration(SPEECH_LIMIT_SECONDS)}
      </p>

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
          <b>5分を超えました。</b>このままだと減点されます。論点を1つ落としてください。
        </p>
      )}
    </section>
  );
}
