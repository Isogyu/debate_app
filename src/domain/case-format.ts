/**
 * 立論の整形とリンク解析（REQUIREMENTS.md §2.1 実フォーマット）
 *
 * サーバー・クライアント双方から使うため、副作用のない純粋関数だけを置く。
 */

import type { DebateCase } from "./types";

/**
 * 本文中の資料参照マーカー。
 *
 * 実物を4件確認したところ、チームによって書き方が違った:
 *  - 【資料3参照】 / 【法37条1項、資料2参照】
 *  - (資料2) / （資料2）   ← 半角・全角の括弧だけの形
 * どちらも読み上げず、資料へのリンクになる。両方を認識する。
 */
export const REF_MARKER_GLOBAL =
  /【([^】]*?)資料(\d+)参照】|[（(]\s*資料\s*(\d+)\s*[）)]/g;

/** マーカー1つ分の解析結果 */
export interface RefMarkerMatch {
  /** マーカー全体の文字列 */
  value: string;
  /** 【法37条1項、資料2参照】の「法37条1項、」の部分。括弧型では空 */
  prefix: string;
  number: number;
  index: number;
}

/** 表記ゆれを吸収してマーカーを取り出す */
export function* matchRefMarkers(text: string): Generator<RefMarkerMatch> {
  for (const m of text.matchAll(REF_MARKER_GLOBAL)) {
    // 【…参照】形なら2番目、括弧だけの形なら3番目に番号が入る
    const number = Number(m[2] ?? m[3]);
    if (!Number.isFinite(number)) continue;
    yield {
      value: m[0],
      prefix: m[1] ?? "",
      number,
      index: m.index ?? 0,
    };
  }
}

/**
 * 実フォーマットどおりの本文を組み立てる。
 * Wordプレビューとエクスポートはこの出力をそのまま使う。
 */
export function renderFullText(c: DebateCase): string {
  const lines: string[] = ["Ⅰ. 主張", "", `　${c.claim}`, "", "Ⅱ. 理由", ""];
  c.sections.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    if (s.intro) lines.push(`　${s.intro}`);
    s.subsections.forEach((sub, j) => {
      lines.push(`　（${j + 1}）${sub.title}`);
      lines.push(`　　${sub.claim}`);
      if (sub.warrant) lines.push(`　　${sub.warrant}`);
      if (sub.impact) lines.push(`　　${sub.impact}`);
      lines.push("");
    });
  });
  lines.push("Ⅲ. 結論", "", `　${c.conclusion}`);
  return lines.join("\n");
}

export type TextPart =
  | { kind: "text"; value: string }
  | { kind: "ref"; value: string; prefix: string; number: number };

/**
 * 本文を「素のテキスト」と「資料参照」に分解する。
 * 画面側はこれを使って【資料N参照】をリンクに変える（DESIGN §5）。
 */
export function splitRefs(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;

  for (const m of matchRefMarkers(text)) {
    if (m.index > last) {
      parts.push({ kind: "text", value: text.slice(last, m.index) });
    }
    parts.push({
      kind: "ref",
      value: m.value,
      prefix: m.prefix,
      number: m.number,
    });
    last = m.index + m.value.length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts;
}

/**
 * 見出しの先頭に付いた番号を落とす。
 * 「1.」「Ⅱ-1.」「（1）」などをLLMが書いてくることがあり、
 * 表示側の採番と合わさって「1. Ⅱ-1. …」のように二重になるため。
 */
export function stripLeadingNumber(title: string): string {
  return title
    .replace(/^[\s　]*[ⅠⅡⅢⅣ]+[-－.．]?\s*\d*[.．)）]?\s*/, "")
    .replace(/^[\s　]*[（(]?\d+[）).．]\s*/, "")
    .trim();
}

/**
 * refSlotsを宣言したのに本文にマーカーを書かなかった場合の救済。
 *
 * プロンプトで必須と伝えてはいるが、守られないことが実際にあった。
 * マーカーが1つもないと立論と参考資料の対応が完全に切れ、
 * 相互リンクもWord出力も成立しなくなるため、文末に補う。
 */
export function ensureRefMarkers(text: string, numbers: number[]): string {
  const missing = numbers.filter((n) => !text.includes(`資料${n}参照】`));
  if (missing.length === 0) return text;

  const markers = missing.map((n) => `【資料${n}参照】`).join("");
  // 実物の立論も文末に置いているので、句点の直前に差し込む
  return /。\s*$/.test(text)
    ? text.replace(/。\s*$/, `${markers}。`)
    : `${text}${markers}`;
}

/** 本文中の【資料{slot}参照】を、いったん仮番号の【資料N参照】に置き換える */
export function replaceSlotMarkers(
  text: string,
  slotToRefId: Map<string, string>,
  refs: { id: string; number: number }[],
): string {
  // slot は "s1" のように数字を含むことがある。
  // 数字を含まない前提で書くと【資料s2参照】が置換されず、
  // そのうえ救済処理が【資料2参照】を足して二重表示になる
  return text.replace(/【([^】]*?)資料([^】]+?)参照】/g, (whole, prefix, slot) => {
    const refId = slotToRefId.get(String(slot).trim());
    const ref = refs.find((r) => r.id === refId);
    return ref ? `【${prefix}資料${ref.number}参照】` : whole;
  });
}

export const SECTION_TYPE_LABELS: Record<string, string> = {
  criteria: "評価基準による論証",
  environment: "環境変化型",
  comparison: "比較衡量型",
  other: "その他の構成",
};
