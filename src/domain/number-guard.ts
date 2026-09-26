/**
 * AI が書いた文章（模範回答・最終弁論の雛形・戦い方・練習から足す質問）に
 * 出典のない数字を入れさせない（v6 要件 §1-9）。
 *
 * 使ってよい数字は「立論本文・資料の引用文・統計資料の値と計算結果」に既にあるものだけ。
 * それ以外の数字を含む文は落とす。数字を作らせないための最後の関所。
 */

import { extractNumbers, splitSentences, type NumberMention } from "./numbers.ts";
import { roughlyEqual } from "./statistics.ts";
import type { StatisticData } from "./types";

export function allowedValuesFrom(
  texts: (string | null | undefined)[],
  statistics: (StatisticData | null | undefined)[],
): number[] {
  const values: number[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of extractNumbers(t, "")) {
      if (m.value === null) continue;
      values.push(m.value);
      if (m.unit === "割") values.push(m.value * 10);
    }
  }
  for (const s of statistics) {
    if (!s) continue;
    for (const i of s.inputs) values.push(i.value);
    for (const r of s.results) values.push(r.value);
  }
  return values;
}

export function isAllowedMention(m: NumberMention, allowed: number[]): boolean {
  if (m.value === null) return false;
  const candidates = [m.value];
  if (m.unit === "割") candidates.push(m.value * 10);
  return allowed.some((a) => candidates.some((v) => roughlyEqual(v, a)));
}

/** 使ってよい数字以外を含むか */
export function hasDisallowedNumber(text: string, allowed: number[]): boolean {
  return extractNumbers(text, "").some((m) => !isAllowedMention(m, allowed));
}

/** 使ってよい数字以外を含む文を落とす */
export function guardText(
  text: string,
  allowed: number[],
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = splitSentences(text).filter((s) => {
    const bad = hasDisallowedNumber(s, allowed);
    if (bad) removed.push(s);
    return !bad;
  });
  // 句点のない文章（見出し・短い語句）は splitSentences で1文になる。落とすと空になる
  return { text: removed.length === 0 ? text : kept.join(""), removed };
}
