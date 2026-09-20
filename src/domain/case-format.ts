/**
 * 立論の整形とリンク解析（REQUIREMENTS.md §2.1 実フォーマット）
 *
 * サーバー・クライアント双方から使うため、副作用のない純粋関数だけを置く。
 */

import type { DebateCase } from "./types";

/** 本文中の資料参照マーカー。`【資料3参照】`『【法37条1項、資料2参照】』の両形 */
export const REF_MARKER_GLOBAL = /【([^】]*?)資料(\d+)参照】/g;

/**
 * 実フォーマットどおりの本文を組み立てる。
 * Wordプレビューとエクスポートはこの出力をそのまま使う。
 */
export function renderFullText(c: DebateCase): string {
  const lines: string[] = ["Ⅰ. 主張", "", `　${c.claim}`, "", "Ⅱ. 理由", ""];
  c.sections.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
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

  for (const m of text.matchAll(REF_MARKER_GLOBAL)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push({ kind: "text", value: text.slice(last, start) });
    }
    parts.push({
      kind: "ref",
      value: m[0],
      prefix: m[1],
      number: Number(m[2]),
    });
    last = start + m[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts;
}

export const SECTION_TYPE_LABELS: Record<string, string> = {
  criteria: "評価基準による論証",
  environment: "環境変化型",
  comparison: "比較衡量型",
  other: "その他の構成",
};
