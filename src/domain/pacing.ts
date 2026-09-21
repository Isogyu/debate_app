/**
 * 読み上げのペース配分（ペースメーカー）
 *
 * 立論は4分30秒超〜5分00秒に収める必要があり、超過も余りすぎも減点される。
 * 原稿を読みながら「いまどこまで来ているべきか」を示すための計算。
 *
 * 音声認識は使わない。日本語の専門語（租税公平主義・担税力など）は誤認識が
 * 集中し、位置がずれたまま「巻いてください」と誤指示を出す危険がある。
 * 早口は要項11で別途減点されるので、誤指示は実害になる。
 * 読み手は自分がどこを読んでいるか分かっているので、目安さえ見えれば足りる。
 */

import { countSpeechChars } from "./speech.ts";
import type { DebateCase } from "./types";

/** 読み上げの単位。画面ではこの塊ごとに光らせる */
export interface PacingChunk {
  id: string;
  /** 画面に出す文字列（【資料N参照】も見せる。読み飛ばす目印になる） */
  text: string;
  /** 見出しは読み上げるが、本文とは区別して小さく出す */
  kind: "heading" | "body";
  /** 原稿の先頭からこの塊の末尾までの累積文字数（読み上げる文字だけ） */
  cumulativeChars: number;
  /** この塊を読み終えているべき時刻（秒） */
  dueAtSeconds: number;
}

export interface PacingPlan {
  chunks: PacingChunk[];
  totalChars: number;
  /** 割り当てた持ち時間（秒） */
  limitSeconds: number;
}

/**
 * 立論を読み上げの塊に分ける。
 *
 * 文単位まで細かくすると視線が飛んで読みにくいので、段落を単位にする。
 * 実物の立論は1段落が100〜300字程度で、5分なら20〜40秒に相当する。
 */
export function buildPacingPlan(
  debateCase: DebateCase,
  limitSeconds: number,
): PacingPlan {
  const raw: { id: string; text: string; kind: "heading" | "body" }[] = [];

  raw.push({ id: "h-claim", text: "Ⅰ. 主張", kind: "heading" });
  raw.push({ id: "claim", text: debateCase.claim, kind: "body" });
  raw.push({ id: "h-reason", text: "Ⅱ. 理由", kind: "heading" });

  debateCase.sections.forEach((section, i) => {
    raw.push({
      id: `${section.id}-h`,
      text: `${i + 1}. ${section.title}`,
      kind: "heading",
    });
    section.subsections.forEach((sub, j) => {
      raw.push({
        id: `${sub.id}-h`,
        text: `（${j + 1}）${sub.title}`,
        kind: "heading",
      });
      for (const [key, text] of [
        ["claim", sub.claim],
        ["warrant", sub.warrant],
        ["impact", sub.impact],
      ] as const) {
        if (text.trim()) {
          raw.push({ id: `${sub.id}-${key}`, text, kind: "body" });
        }
      }
    });
  });

  raw.push({ id: "h-conclusion", text: "Ⅲ. 結論", kind: "heading" });
  raw.push({ id: "conclusion", text: debateCase.conclusion, kind: "body" });

  const totalChars = raw.reduce((n, c) => n + countSpeechChars(c.text), 0);

  let cumulative = 0;
  const chunks: PacingChunk[] = raw.map((c) => {
    cumulative += countSpeechChars(c.text);
    return {
      ...c,
      cumulativeChars: cumulative,
      // 文字数に比例して時間を割り当てる。
      // 実際は段落ごとに速さが違うが、目安としてはこれで足りる
      dueAtSeconds:
        totalChars === 0 ? 0 : (cumulative / totalChars) * limitSeconds,
    };
  });

  return { chunks, totalChars, limitSeconds };
}

export type PaceState = "ahead" | "onTrack" | "behind";

export interface PaceStatus {
  /** 経過時間から見て、ここまで読み終えているべき塊の番号 */
  targetIndex: number;
  /** 読み手が申告した位置との差（秒）。正なら進んでいる、負なら遅れている */
  driftSeconds: number;
  state: PaceState;
  /** このまま進んだ場合の着地見込み（秒）。位置の申告がないとnull */
  projectedSeconds: number | null;
  message: string;
}

/** これ以上ずれたら知らせる（秒）。本番の5分に対して1割弱 */
const DRIFT_TOLERANCE_SECONDS = 15;

/**
 * いまの経過時間と、読み手が申告した位置から、ペースの状態を出す。
 *
 * @param currentIndex 読み手がいま読んでいる塊の番号。未申告なら null
 */
export function evaluatePace(
  plan: PacingPlan,
  elapsedSeconds: number,
  currentIndex: number | null,
): PaceStatus {
  // 経過時間に対して「ここまで終えているべき」塊
  let targetIndex = plan.chunks.findIndex(
    (c) => c.dueAtSeconds > elapsedSeconds,
  );
  if (targetIndex === -1) targetIndex = plan.chunks.length - 1;

  if (currentIndex === null) {
    return {
      targetIndex,
      driftSeconds: 0,
      state: "onTrack",
      projectedSeconds: null,
      message: "光っている段落まで進んでいれば、ちょうどのペースです。",
    };
  }

  const index = Math.min(Math.max(currentIndex, 0), plan.chunks.length - 1);
  // いま読んでいる段落は「まだ読み終えていない」ので、手前までを済んだ分とみなす
  const doneChars = index === 0 ? 0 : plan.chunks[index - 1].cumulativeChars;
  const dueForDone =
    plan.totalChars === 0
      ? 0
      : (doneChars / plan.totalChars) * plan.limitSeconds;

  // 予定より早く着いていれば正（進んでいる）
  const driftSeconds = dueForDone - elapsedSeconds;

  const projectedSeconds =
    doneChars > 0 && elapsedSeconds > 0
      ? (elapsedSeconds / doneChars) * plan.totalChars
      : null;

  const state: PaceState =
    driftSeconds > DRIFT_TOLERANCE_SECONDS
      ? "ahead"
      : driftSeconds < -DRIFT_TOLERANCE_SECONDS
        ? "behind"
        : "onTrack";

  const message =
    state === "behind"
      ? `${Math.round(-driftSeconds)}秒 遅れています。ここから少し詰めてください。`
      : state === "ahead"
        ? `${Math.round(driftSeconds)}秒 早いです。落ち着いて読んで構いません。`
        : "ちょうどのペースです。";

  return { targetIndex, driftSeconds, state, projectedSeconds, message };
}
