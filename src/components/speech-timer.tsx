"use client";

/**
 * スピーチタイマー（v6 要件 F9）
 *
 * 審査要項5より:
 *  - 立論5分、質問8分、最終弁論1分で時間厳守
 *  - 時間オーバーも、30秒以上余るのも減点
 *  - タイムキーパーは1分前と30秒前に合図し、終了時に時間を読み上げる
 * 合図は**画面の色と大きな表示**で出す。話しながら小さな文字を読む余裕はないので、
 * 目の端に入っただけで分かるよう画面全体の色を変える。音は出さない（会場で鳴らせない）。
 *
 * 測った結果から読み上げ速度を割り出し、以後の推定に反映する。
 * 推定と実測は必ずずれるので、そのずれを埋める導線がないと数字を信用できない。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHARS_PER_MINUTE, formatDuration } from "@/domain/speech";

/** タイムキーパーが合図する残り秒数（審査要項5） */
const SIGNALS = [60, 30] as const;
/** 合図の大きな表示を出しておく時間 */
const SIGNAL_MS = 3000;

/** 種目ごとの持ち時間（審査要項5） */
export const SPEECH_KINDS = [
  { key: "case", label: "立論", seconds: 300, hasMinimum: true },
  { key: "question", label: "質疑", seconds: 480, hasMinimum: false },
  { key: "closing", label: "最終弁論", seconds: 60, hasMinimum: true },
] as const;

export type SpeechKind = (typeof SPEECH_KINDS)[number]["key"];

/** 合図の種類。0 = 時間終了 */
type Signal = (typeof SIGNALS)[number] | 0;

const SIGNAL_STYLE: Record<Signal, { bg: string; text: string }> = {
  60: { bg: "#b45309", text: "残り1分" },
  30: { bg: "#c2410c", text: "残り30秒" },
  0: { bg: "#7f1d1d", text: "時間です" },
};

/** 残り時間に応じた色（通常表示・全画面の背景の両方に使う） */
function phaseColor(remaining: number, tooShort: boolean): string {
  if (remaining < 0) return "var(--neg)";
  if (tooShort) return "#b45309";
  if (remaining <= 30) return "#c2410c";
  if (remaining <= 60) return "#b45309";
  return "var(--muted)";
}

/** 全画面の背景。遠目でも段階が分かるよう、はっきり塗り分ける */
function phaseBackground(remaining: number, started: boolean): string {
  if (!started) return "#111827";
  if (remaining < 0) return "#7f1d1d";
  if (remaining <= 30) return "#c2410c";
  if (remaining <= 60) return "#b45309";
  return "#14532d";
}

export function SpeechTimer({
  chars,
  onMeasured,
  initialKind = "case",
  adviseFixes = false,
}: {
  /** 読み上げる文字数。渡したときだけ、実測から速度を割り出す */
  chars?: number;
  /** 測り終わったときに、割り出した速度を親へ返す */
  onMeasured?: (charsPerMinute: number) => void;
  /** 最初に選んでおく種目 */
  initialKind?: SpeechKind;
  /** 超過・余りのときに直し方まで示すか（生成立論を測るときだけ。v6 要件 F10） */
  adviseFixes?: boolean;
}) {
  const [kindKey, setKindKey] = useState<SpeechKind>(initialKind);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const startedAt = useRef<number | null>(null);
  const baseElapsed = useRef(0);
  const firedSignals = useRef<Set<Signal>>(new Set());
  const signalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullRef = useRef<HTMLDivElement>(null);

  const kind = SPEECH_KINDS.find((k) => k.key === kindKey)!;
  const limit = kind.seconds;
  const hasText = typeof chars === "number" && chars > 0;

  const fire = useCallback((s: Signal) => {
    setSignal(s);
    if (signalTimer.current) clearTimeout(signalTimer.current);
    signalTimer.current = setTimeout(() => setSignal(null), SIGNAL_MS);
  }, []);

  useEffect(() => {
    if (!running) return;
    // setInterval の積み重ねでは狂うので、開始時刻からの差で出す
    const tick = () => {
      const started = startedAt.current;
      if (started === null) return;
      const next = baseElapsed.current + (Date.now() - started) / 1000;
      setElapsed(next);

      // 本番と同じタイミングで合図を出す。一時停止をまたいでも二重に出さない
      const left = limit - next;
      for (const at of [...SIGNALS, 0 as const]) {
        // 最終弁論（1分）では「1分前」が開始と同時になるので出さない
        if (at >= limit) continue;
        if (left <= at && !firedSignals.current.has(at)) {
          firedSignals.current.add(at);
          // 途中から再開して複数を一度に越えたときは、いちばん近いものだけ見せる
          if (left > at - 1) fire(at);
        }
      }
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [running, limit, fire]);

  useEffect(
    () => () => {
      if (signalTimer.current) clearTimeout(signalTimer.current);
    },
    [],
  );

  // 試合中に画面が消えると困るので、全画面で動かしている間はスリープを止める（対応端末のみ）
  useEffect(() => {
    if (!fullscreen || !running) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => {
        if (cancelled) void l.release();
        else lock = l;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void lock?.release().catch(() => {});
    };
  }, [fullscreen, running]);

  // Esc やブラウザ操作で全画面が解けたら、こちらの表示も戻す
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const openFullscreen = () => {
    setFullscreen(true);
    // ブラウザの全画面は対応していない端末（iPhone の Safari など）もある。その場合は画面いっぱいの表示だけにする
    requestAnimationFrame(() => {
      fullRef.current?.requestFullscreen?.().catch(() => {});
    });
  };
  const closeFullscreen = () => {
    setFullscreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

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
    if (elapsed > 5 && typeof chars === "number" && chars > 0) {
      const rate = Math.round(chars / (elapsed / 60));
      setMeasured(rate);
      onMeasured?.(rate);
    }
  }, [elapsed, chars, onMeasured]);

  const reset = () => {
    baseElapsed.current = 0;
    startedAt.current = null;
    firedSignals.current = new Set();
    if (signalTimer.current) clearTimeout(signalTimer.current);
    setElapsed(0);
    setRunning(false);
    setMeasured(null);
    setSignal(null);
  };

  const remaining = limit - elapsed;
  const over = remaining < 0;
  // 30秒以上余らせるのも減点なので、そこも色を変える（立論・最終弁論のみ）
  const tooShort = kind.hasMinimum && elapsed > 0 && !running && remaining >= 30;
  const color = phaseColor(remaining, tooShort);
  const timeText = `${over ? "+" : ""}${formatDuration(Math.floor(Math.abs(remaining)))}`;

  // 合図。画面全体の色を変え、大きく出す。操作の邪魔をしないよう押しても下へ通す
  const signalOverlay = signal !== null && (
    <div
      role="status"
      aria-live="assertive"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: `${SIGNAL_STYLE[signal].bg}e6` }}
    >
      <span className="px-4 text-center text-[18vw] leading-none font-black text-white sm:text-[14vw]">
        {SIGNAL_STYLE[signal].text}
      </span>
    </div>
  );

  const kindButtons = (dark: boolean) =>
    SPEECH_KINDS.map((k) => (
      <button
        key={k.key}
        onClick={() => {
          setKindKey(k.key);
          reset();
        }}
        disabled={running}
        className={`min-h-11 rounded px-4 text-sm font-bold disabled:opacity-40 ${
          kindKey === k.key
            ? dark
              ? "bg-white text-black"
              : "bg-[var(--accent)] text-white"
            : dark
              ? "border border-white/60"
              : "border border-[var(--line)]"
        }`}
      >
        {k.label} {Math.round(k.seconds / 60)}分
      </button>
    ));

  const controls = (dark: boolean) => (
    <div className="flex flex-wrap gap-2">
      {!running ? (
        <button
          onClick={start}
          className={`min-h-12 flex-1 rounded px-5 font-bold ${
            dark ? "bg-white text-black" : "bg-[var(--accent)] text-white"
          }`}
        >
          {elapsed > 0 ? "再開" : "開始"}
        </button>
      ) : (
        <button
          onClick={pause}
          className={`min-h-12 flex-1 rounded border-2 px-5 font-bold ${
            dark ? "border-white" : "border-[var(--line)]"
          }`}
        >
          一時停止
        </button>
      )}
      {hasText && (
        <button
          onClick={finish}
          disabled={elapsed === 0}
          className={`min-h-12 rounded border-2 px-5 font-bold disabled:opacity-40 ${
            dark ? "border-white" : "border-[var(--accent)] text-[var(--accent)]"
          }`}
        >
          読み終えた
        </button>
      )}
      <button
        onClick={reset}
        disabled={elapsed === 0}
        className={`min-h-12 rounded border-2 px-4 disabled:opacity-40 ${
          dark ? "border-white/60" : "border-[var(--line)]"
        }`}
      >
        リセット
      </button>
    </div>
  );

  return (
    <section className="rounded border-2 p-4" style={{ borderColor: color }}>
      <div className="mb-3 flex flex-wrap gap-2">
        {kindButtons(false)}
        <button
          onClick={openFullscreen}
          className="ml-auto min-h-11 rounded border-2 border-[var(--accent)] px-4 text-sm font-bold text-[var(--accent)]"
        >
          全画面で使う
        </button>
      </div>

      <div className="mb-1 text-sm text-[var(--muted)]">{over ? "超過時間" : "残り時間"}</div>
      <div
        className="mb-3 font-mono text-5xl font-bold tabular-nums"
        style={{ color }}
        // 1秒ごとに読み上げられると邪魔なので、通知はしない
        aria-live="off"
      >
        {timeText}
      </div>

      <div className="mb-3 h-3 w-full overflow-hidden rounded bg-[var(--line)]">
        <div
          className="h-full"
          style={{ width: `${Math.min((elapsed / limit) * 100, 100)}%`, background: color }}
        />
      </div>

      {controls(false)}

      <p className="mt-3 text-sm text-[var(--muted)]">
        経過 {formatDuration(Math.floor(elapsed))} / 持ち時間 {formatDuration(limit)}
        {kind.hasMinimum && (
          <span className="ml-2">（30秒以上余ると減点。適正は残り0〜30秒で終わること）</span>
        )}
        <span className="mt-1 block">
          1分前と30秒前に、画面の色が変わり大きく表示されます（音は出ません）。
        </span>
      </p>

      {tooShort && (
        <p className="mt-2 text-sm" style={{ color }}>
          <b>{formatDuration(Math.floor(remaining))}余りました。</b>
          30秒以上余ると減点されます。
          {adviseFixes && kind.key === "case" ? "早く読み終えたなら、分量を足してください。" : ""}
        </p>
      )}

      {measured !== null && (
        <div className="mt-3 rounded bg-[var(--line)]/30 p-3 text-sm">
          <p>
            あなたの読み上げ速度は <b>約{measured}字/分</b> でした
            {measured !== DEFAULT_CHARS_PER_MINUTE && <>（標準は{DEFAULT_CHARS_PER_MINUTE}字/分）</>}。
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
          減点されます。{adviseFixes && kind.key === "case" ? "論点を1つ落としてください。" : ""}
        </p>
      )}

      {/* 全画面表示。試合中にスマホやPCを置いて、遠目で見る */}
      {fullscreen && (
        <div
          ref={fullRef}
          className="fixed inset-0 z-40 flex flex-col p-4 text-white transition-colors duration-500"
          style={{ background: phaseBackground(remaining, elapsed > 0) }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {kindButtons(true)}
            <button
              onClick={closeFullscreen}
              className="ml-auto min-h-11 rounded border-2 border-white px-4 text-sm font-bold"
            >
              全画面を閉じる
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="text-2xl font-bold opacity-90">
              {kind.label}　{over ? "超過時間" : "残り時間"}
            </div>
            <div className="font-mono text-[22vw] leading-none font-bold tabular-nums sm:text-[18vw]">
              {timeText}
            </div>
            <div className="mt-2 text-lg opacity-80">
              経過 {formatDuration(Math.floor(elapsed))} / 持ち時間 {formatDuration(limit)}
            </div>
          </div>
          {controls(true)}
          {/* ブラウザの全画面中は、この要素の外は映らない。合図もこの中に出す */}
          {signalOverlay}
        </div>
      )}

      {!fullscreen && signalOverlay}
    </section>
  );
}
