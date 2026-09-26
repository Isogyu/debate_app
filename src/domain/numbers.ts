/**
 * 立論本文から数字を拾う（v6 要件 §1-9「出典の明記」）
 *
 * 見出し番号（（1）・1.）や資料番号（【資料3参照】）・条番号（56条）は数字の主張ではないので除く。
 * 残った数字が、同じ文の中の【資料N参照】で出典に結びついているかを調べる。
 */

import { matchRefMarkers } from "./case-format.ts";
import type { DebateCase } from "./types";

export interface NumberMention {
  /** 原文の表記（"約3割" "1,494件" "12.5％"） */
  text: string;
  /** 数値（割合・倍は単位込みで扱わず、数値部分のみ） */
  value: number | null;
  unit: string;
  /** その数字を含む一文 */
  sentence: string;
  /** 同じ文にある資料番号 */
  refNumbers: number[];
  claimId?: string;
  /** "（1）担税力" のような段落名 */
  location: string;
}

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/**
 * 数字の主張として拾う表記。
 *  - 算用数字（全角・カンマ・小数）＋単位
 *  - 「約3割」「2倍」のような割・倍
 *  - 漢数字の割合（「三割」「半数」は拾わない。数字として検証できないため）
 */
const NUMBER_PATTERN =
  /(約|およそ|実に|わずか|過半数の)?([0-9０-９][0-9０-９,，.．]*)\s*(兆|億|万|千)?\s*(％|%|パーセント|ポイント|割|倍|円|人|件|世帯|社|戸|年間|か月|ヶ月|カ月|時間|歳|位|団体|事業所|名)?|([一二三四五六七八九])割/g;

/** 数字の主張ではない表記 */
function isExcluded(sentence: string, index: number, raw: string): boolean {
  const before = sentence.slice(Math.max(0, index - 6), index);
  const after = sentence.slice(index + raw.length, index + raw.length + 4);
  // 条・項・号（法令の条番号）、第N回、昭和・平成・令和N年、西暦年
  if (/^\s*(条|項|号)/.test(after)) return true;
  if (/第\s*$/.test(before)) return true;
  if (/(昭和|平成|令和|大正|明治)\s*$/.test(before)) return true;
  if (/^\s*(年度?|月|日)/.test(after)) return true;
  if (/^[0-9０-９]{4}$/.test(raw.trim()) && /^\s*年/.test(after)) return true;
  return false;
}

function toHalfWidthNumber(text: string): number | null {
  const t = text.normalize("NFKC").replace(/,/g, "");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** 文に分ける。句点で区切り、句点も残す */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 漢数字の数量表現。算用数字の表記に加えて拾う（「二倍」「三分の一」「数百万人」）。
 * 「一つ」「一方」「第一に」のような数量でない漢数字は、単位が続かないので拾わない。
 */
const KANJI_NUMBER_PATTERN =
  /(約|およそ|実に|わずか)?([〇一二三四五六七八九十百千]+|数|十数|数十|数百|数千)(分の[〇一二三四五六七八九十百千]+|(万|億|兆)?\s*(倍|割|パーセント|％|%|人|件|世帯|社|円|万人|億円|兆円|団体|事業所))/g;

function kanjiValue(digits: string, rest: string): number | null {
  if (/数/.test(digits)) return null; // 「数百万人」は数値として検証できない
  const base = kanjiToNumberLocal(digits);
  if (base === null) return null;
  // 「三分の一」は 1/3（分の前が分母、後ろが分子）
  const frac = rest.match(/^分の([〇一二三四五六七八九十百千]+)/);
  if (frac) {
    const num = kanjiToNumberLocal(frac[1]);
    return num !== null && base ? (num / base) * 100 : null; // 分数は％に直して比べる
  }
  const mult = rest.match(/^(万|億|兆)/)?.[1];
  return mult ? base * { 万: 1e4, 億: 1e8, 兆: 1e12 }[mult]! : base;
}

function kanjiToNumberLocal(text: string): number | null {
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (ch in KANJI_DIGITS) current = current * 10 + KANJI_DIGITS[ch];
    else if (ch === "十" || ch === "百" || ch === "千") {
      total += (current || 1) * (ch === "十" ? 10 : ch === "百" ? 100 : 1000);
      current = 0;
    } else return null;
  }
  return total + current;
}

export function extractNumbers(
  text: string,
  location: string,
  claimId?: string,
): NumberMention[] {
  const out: NumberMention[] = [];
  for (const sentence of splitSentences(text)) {
    // 資料番号・見出し番号を消した文で数字を探す（位置は原文とずれてよい）
    const cleaned = sentence
      .replace(/【[^】]*】/g, (m) => "　".repeat(m.length))
      .replace(/[（(]\s*[0-9０-９]+\s*[）)]/g, (m) => "　".repeat(m.length));
    const refNumbers = [...matchRefMarkers(sentence)].map((m) => m.number);
    const taken: [number, number][] = [];

    for (const m of cleaned.matchAll(NUMBER_PATTERN)) {
      const raw = m[0];
      if (!raw.trim()) continue;
      const index = m.index ?? 0;
      if (m[5]) {
        // 漢数字の割合（三割）。下の漢数字の検出と重ならないよう位置を控える
        taken.push([index, index + raw.length]);
        out.push({
          text: raw,
          value: KANJI_DIGITS[m[5]] ?? null,
          unit: "割",
          sentence,
          refNumbers,
          claimId,
          location,
        });
        continue;
      }
      const digits = m[2];
      const unit = m[4] ?? "";
      if (isExcluded(cleaned, index + (m[1]?.length ?? 0), digits)) continue;
      // 単位のない1桁の数字（「2つの観点」など）は数字の主張として扱わない
      if (!unit && !m[3] && toHalfWidthNumber(digits) !== null && digits.replace(/\D/g, "").length < 2) {
        continue;
      }
      let value = toHalfWidthNumber(digits);
      if (value !== null && m[3]) {
        value *= { 兆: 1e12, 億: 1e8, 万: 1e4, 千: 1e3 }[m[3]] ?? 1;
      }
      taken.push([index, index + raw.length]);
      out.push({
        text: raw.trim(),
        value,
        unit,
        sentence,
        refNumbers,
        claimId,
        location,
      });
    }

    for (const m of cleaned.matchAll(KANJI_NUMBER_PATTERN)) {
      const index = m.index ?? 0;
      if (taken.some(([a, b]) => index < b && index + m[0].length > a)) continue;
      const before = cleaned.slice(Math.max(0, index - 1), index);
      if (before === "第") continue; // 第一に・第二条
      const digits = m[2];
      const rest = m[3];
      const unit = rest.startsWith("分の")
        ? "％"
        : (m[5] ?? "").replace(/^(万|億|兆)/, "");
      out.push({
        text: m[0].trim(),
        value: kanjiValue(digits, rest),
        unit: unit === "割" ? "割" : unit,
        sentence,
        refNumbers,
        claimId,
        location,
      });
    }
  }
  return out;
}

/** 立論全体から数字を拾う。段落名を付けて返す */
export function extractCaseNumbers(c: DebateCase): NumberMention[] {
  const out: NumberMention[] = [];
  out.push(...extractNumbers(c.claim, "Ⅰ. 主張"));
  c.sections.forEach((s) => {
    s.subsections.forEach((sub, j) => {
      const location = `（${j + 1}）${sub.title}`;
      for (const text of [sub.claim, sub.warrant, sub.impact]) {
        out.push(...extractNumbers(text, location, sub.id));
      }
    });
  });
  out.push(...extractNumbers(c.conclusion, "Ⅲ. 結論"));
  return out;
}
