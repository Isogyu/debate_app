/**
 * 読み上げ時間の管理
 *
 * 立論は読み上げ5分。分量は品質そのもの。
 *
 * 審査要項より（大学対抗 税法ゼミディベート大会）:
 *  - 「時間オーバーや30秒以上時間が余った場合は審査員の判断で減点」
 *    → **短すぎても減点される**。適正は 4分30秒超〜5分00秒 の30秒幅
 *  - 「終了時とは、立論に記載された最後の文字を読み上げた時点」
 *  - 「時間調整のため早口だったり、遅すぎる口調だったりする場合は、
 *    立論のボリュームに関するアイデアが足りないものとして減点」
 *    → 速度で帳尻を合わせるのは不可。**文字数そのものを適正にする**
 *
 * 基準は実物から取った（`docs/samples/`）。実際の試合で使われた立論4件は
 * 本文1,494〜1,577字で、これが5分に収まる長さにあたる。
 * ここから逆算して既定の読み上げ速度を 320字/分 としている。
 */

import { REF_MARKER_GLOBAL } from "./case-format.ts";

/** 立論の持ち時間（秒） */
export const SPEECH_LIMIT_SECONDS = 300;

/**
 * 既定の読み上げ速度（字/分）。
 * 速さは人によってかなり違うので、実際に測って設定で変えられるようにする。
 */
export const DEFAULT_CHARS_PER_MINUTE = 320;

/**
 * これ以上余らせると減点される（残り30秒）。
 * つまり適正な読み上げ時間は 270秒超〜300秒 の30秒幅しかない。
 */
export const MIN_ACCEPTABLE_SECONDS = SPEECH_LIMIT_SECONDS - 30;

/**
 * 読み上げる文字数を数える。
 *
 * `【資料1参照】`のような参照記法は原稿上の注記であって発話しないため除く。
 * 空白と改行も数えない。
 */
export function countSpeechChars(text: string): number {
  return text
    // 資料の参照は書き方が何であれ読み上げない（【資料N参照】/ (資料N)）
    .replace(REF_MARKER_GLOBAL, "")
    .replace(/【[^】]*】/g, "")
    // 論点の区切りに引く罫線。実物の原稿に入っていたが読み上げない
    .replace(/[＿_ー−―—=＝-]{3,}/g, "")
    .replace(/\s/g, "")
    .replace(/[（(][^）)]*[）)]/g, (m) =>
      // 「（1）」のような見出し番号は読まないが、文中の補足は読む
      /^[（(]\s*\d+\s*[）)]$/.test(m) ? "" : m,
    ).length;
}

export function estimateSeconds(
  chars: number,
  charsPerMinute: number = DEFAULT_CHARS_PER_MINUTE,
): number {
  return Math.round((chars / charsPerMinute) * 60);
}

/** 5分に収まる文字数の上限 */
export function speechBudgetChars(
  charsPerMinute: number = DEFAULT_CHARS_PER_MINUTE,
): number {
  return Math.round((SPEECH_LIMIT_SECONDS / 60) * charsPerMinute);
}

/** 減点されない文字数の下限（これ以下だと30秒以上余る） */
export function minAcceptableChars(
  charsPerMinute: number = DEFAULT_CHARS_PER_MINUTE,
): number {
  return Math.round((MIN_ACCEPTABLE_SECONDS / 60) * charsPerMinute);
}

/**
 * short = 余りすぎ（30秒以上余ると減点）
 * ok    = 適正（4分30秒超〜5分00秒）
 * over  = 超過（減点）
 */
export type SpeechVerdict = "short" | "ok" | "over";

export interface SpeechEstimate {
  chars: number;
  seconds: number;
  /** 持ち時間に対する割合（1.0で丁度5分） */
  ratio: number;
  verdict: SpeechVerdict;
  /** 画面にそのまま出せる文言 */
  label: string;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

export function estimateSpeech(
  text: string,
  charsPerMinute: number = DEFAULT_CHARS_PER_MINUTE,
): SpeechEstimate {
  const chars = countSpeechChars(text);
  // 判定は丸める前の秒数で行う。丸めた値で判定すると、1,601字（300.19秒）が
  // 「5分ちょうど＝適正」、1,441字（270.19秒）が「余りすぎ」と逆に出る
  const exactSeconds = (chars / charsPerMinute) * 60;
  const ratio = exactSeconds / SPEECH_LIMIT_SECONDS;

  const verdict: SpeechVerdict =
    exactSeconds > SPEECH_LIMIT_SECONDS
      ? "over"
      : exactSeconds <= MIN_ACCEPTABLE_SECONDS
        ? "short"
        : "ok";
  // 表示用の秒数は判定と食い違わないように丸める（超過なら切り上げ、余りなら切り捨て）
  const seconds =
    verdict === "over"
      ? Math.ceil(exactSeconds)
      : verdict === "short"
        ? Math.floor(exactSeconds)
        : Math.min(SPEECH_LIMIT_SECONDS, Math.max(MIN_ACCEPTABLE_SECONDS + 1, estimateSeconds(chars, charsPerMinute)));

  const label =
    verdict === "over"
      ? `${formatDuration(seconds)}（${formatDuration(seconds - SPEECH_LIMIT_SECONDS)}超過）`
      : verdict === "short"
        ? `${formatDuration(seconds)}（${formatDuration(SPEECH_LIMIT_SECONDS - seconds)}余る）`
        : formatDuration(seconds);

  return { chars, seconds, ratio, verdict, label };
}

/**
 * 生成時に渡す分量の指示。
 * 小見出しの数で割って1つあたりの目安も出す。長さを守らせるには
 * 全体の字数だけでなく、1段落あたりの目安を示す方が効く。
 */
export function speechBudgetGuide(
  subsectionCount: number,
  charsPerMinute: number = DEFAULT_CHARS_PER_MINUTE,
): string {
  const total = speechBudgetChars(charsPerMinute);
  // 見出し・主張・結論に使うぶんを差し引いて本文へ配分する
  const forBody = Math.round(total * 0.85);
  const per = Math.max(120, Math.round(forBody / Math.max(subsectionCount, 1)));

  const min = minAcceptableChars(charsPerMinute);
  const minPer = Math.max(100, Math.round((min * 0.85) / Math.max(subsectionCount, 1)));

  return [
    `【厳守】分量`,
    `立論は読み上げ5分です。**超過しても、30秒以上余らせても減点されます。**`,
    `全体で **${min}〜${total}字** に収めてください。上限だけでなく下限も守ること。`,
    `（実際の試合で使われた立論4件は1,494〜1,577字でした）`,
    `小見出しは${subsectionCount}個の想定なので、1つあたり${minPer}〜${per}字が目安です。`,
    `多すぎるときは説明を足すのではなく**論点を削り**、`,
    `少なすぎるときは論証を**一段深める**（因果を一段ずつ書く）ことで足してください。`,
    `読む速さで帳尻を合わせるのは不可です（早口・遅すぎも減点対象）。`,
  ].join("\n");
}
