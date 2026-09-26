/**
 * 読み上げ字数の警告文（§3.3）。字数の自動調整のあとに収まらなかった場合に付ける。
 */

import { countSpeechChars, estimateSpeech, minAcceptableChars, speechBudgetChars } from "@/domain/speech";
import type { DebateCase } from "@/domain/types";

export function adjustLengthWarning(debateCase: DebateCase): string | undefined {
  const est = estimateSpeech(debateCase.fullText);
  if (est.verdict === "ok") return undefined;
  const chars = countSpeechChars(debateCase.fullText);
  return est.verdict === "over"
    ? `自動調整でも収まりませんでした。推定 ${est.label}。${chars - speechBudgetChars()}字ほど削ってください。`
    : `自動調整でも足りませんでした。推定 ${est.label}。${minAcceptableChars() + 1 - chars}字以上足してください。`;
}
