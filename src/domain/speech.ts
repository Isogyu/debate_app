/**
 * 読み上げ時間の管理
 *
 * 立論は読み上げ5分。**超過すると減点される**ため、分量は品質そのもの。
 * 長く詳しい立論は、それだけで悪い立論になる。
 *
 * 基準は実物から取った（`docs/samples/`）。実際の試合で使われた立論は
 * 本文1,528字と1,577字で、これが5分に収まる長さにあたる。
 * ここから逆算して既定の読み上げ速度を 320字/分 としている。
 */

/** 立論の持ち時間（秒） */
export const SPEECH_LIMIT_SECONDS = 300;

/**
 * 既定の読み上げ速度（字/分）。
 * 速さは人によってかなり違うので、実際に測って設定で変えられるようにする。
 */
export const DEFAULT_CHARS_PER_MINUTE = 320;

/** 超過が見えていなくても、ここを超えたら注意を促す割合 */
const WARN_RATIO = 0.9;

/**
 * 読み上げる文字数を数える。
 *
 * `【資料1参照】`のような参照記法は原稿上の注記であって発話しないため除く。
 * 空白と改行も数えない。
 */
export function countSpeechChars(text: string): number {
  return text
    .replace(/【[^】]*】/g, "")
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

export type SpeechVerdict = "ok" | "near" | "over";

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
  const seconds = estimateSeconds(chars, charsPerMinute);
  const ratio = seconds / SPEECH_LIMIT_SECONDS;

  const verdict: SpeechVerdict =
    ratio > 1 ? "over" : ratio >= WARN_RATIO ? "near" : "ok";

  const over = seconds - SPEECH_LIMIT_SECONDS;
  const label =
    verdict === "over"
      ? `${formatDuration(seconds)}（${formatDuration(over)}超過）`
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

  return [
    `【厳守】分量`,
    `立論は読み上げ5分です。**超過すると減点されます。**`,
    `全体で${total}字以内に必ず収めてください（実際の試合で使われた立論は約1,550字でした）。`,
    `小見出しは${subsectionCount}個の想定なので、1つあたり${per}字程度が目安です。`,
    `字数を超えそうなときは、説明を足すのではなく**論点を削って**ください。`,
    `長く詳しい立論は、時間を超過する時点で悪い立論です。`,
  ].join("\n");
}
