"use client";

/**
 * 読み上げ時間の表示（5分・超過で減点）
 *
 * 分量は品質そのものなので、立論を見ているあいだ常に見えている必要がある。
 * エクスポートしてから気づくのでは遅い。
 */

import { useState } from "react";
import {
  DEFAULT_CHARS_PER_MINUTE,
  estimateSpeech,
  formatDuration,
  SPEECH_LIMIT_SECONDS,
  speechBudgetChars,
} from "@/domain/speech";

const COLORS = {
  ok: "var(--aff)",
  near: "#b45309",
  over: "var(--neg)",
} as const;

const RATES = [260, 290, 320, 350, 380];

export function SpeechMeter({ text }: { text: string }) {
  // 読み上げ速度は人によってかなり違う。実際に測って選べるようにする
  const [rate, setRate] = useState(DEFAULT_CHARS_PER_MINUTE);
  const est = estimateSpeech(text, rate);
  const color = COLORS[est.verdict];
  const budget = speechBudgetChars(rate);

  return (
    <section
      className="mb-4 rounded border-2 p-3"
      style={{ borderColor: color }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold" style={{ color }}>
          読み上げ {est.label}
        </span>
        <span className="text-sm text-[var(--muted)]">
          {est.chars}字 / 目安 {budget}字（持ち時間{" "}
          {formatDuration(SPEECH_LIMIT_SECONDS)}）
        </span>
        <label className="ml-auto text-sm">
          <span className="mr-1 text-[var(--muted)]">読む速さ</span>
          <select
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="rounded border border-[var(--line)] p-1"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}字/分
                {r === DEFAULT_CHARS_PER_MINUTE ? "（標準）" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 残り時間を視覚化する。数字だけだと切迫感が伝わらない */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[var(--line)]">
        <div
          className="h-full transition-[width]"
          style={{
            width: `${Math.min(est.ratio * 100, 100)}%`,
            background: color,
          }}
        />
      </div>

      {est.verdict === "over" && (
        <p className="mt-2 text-sm" style={{ color }}>
          <b>5分を超えています。このままだと減点されます。</b>
          説明を削るのではなく、<b>論点そのものを1つ落とす</b>方が確実に縮みます。
        </p>
      )}
      {est.verdict === "near" && (
        <p className="mt-2 text-sm" style={{ color }}>
          持ち時間の9割を超えています。本番では緊張で遅くなるので、余裕を残してください。
        </p>
      )}
    </section>
  );
}
