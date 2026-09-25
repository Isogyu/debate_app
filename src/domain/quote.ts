/**
 * 引用文の照合（v6 要件 §1-3）
 *
 * AIが選んだ引用文は、取得したページ本文に**実在する文字列**でなければ採用しない。
 * 空白・改行・全角半角の違いは、HTML/PDF のテキスト化で必ず揺れるので吸収する。
 * それ以外（語の入れ替え・要約・「…」での省略）は一致とみなさない。
 */

/** 照合用の正規化。空白類を除き、NFKC で全角半角をそろえる */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s 　]/g, "")
    // 引用符の種類はテキスト化で揺れやすい
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'");
}

export interface QuoteMatch {
  found: boolean;
  /** 正規化前の本文での開始位置（見つかった場合） */
  start?: number;
  /** PDF の場合のページ番号（1始まり） */
  page?: number;
}

/**
 * 正規化後の位置 → 正規化前の位置 の対応表を作って、元の本文上の位置を返す。
 * ページ番号を出すのに元の位置が要る。
 */
function buildIndexMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = normalizeForMatch(text[i]);
    for (let k = 0; k < piece.length; k++) {
      normalized += piece[k];
      map.push(i);
    }
  }
  return { normalized, map };
}

/** 引用の最小長。短すぎると偶然一致してしまい、照合の意味がなくなる */
export const MIN_QUOTE_CHARS = 15;

export function findQuote(
  documentText: string,
  quote: string,
  pageOffsets?: number[] | null,
): QuoteMatch {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return { found: false };
  // 「…」「(略)」で間を飛ばした引用は、本文そのままではない
  if (/…|\.\.\.|（略）|\(略\)/.test(quote)) return { found: false };

  const { normalized, map } = buildIndexMap(documentText);
  const at = normalized.indexOf(q);
  if (at < 0) return { found: false };

  const start = map[at];
  return { found: true, start, page: pageOf(start, pageOffsets) };
}

/** 本文上の位置 → ページ番号（1始まり） */
export function pageOf(
  offset: number,
  pageOffsets?: number[] | null,
): number | undefined {
  if (!pageOffsets || pageOffsets.length === 0) return undefined;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i++) {
    if (pageOffsets[i] <= offset) page = i + 1;
    else break;
  }
  return page;
}

/**
 * 長い本文から、検索語に関係のありそうな部分だけを切り出す。
 * 本文を丸ごとAIに渡すと費用がかさみ、関係ない箇所から引用を選びやすい。
 */
export function relevantExcerpt(
  text: string,
  keywords: string[],
  maxChars = 12000,
): string {
  if (text.length <= maxChars) return text;
  const windowSize = 1500;
  const kws = keywords.map((k) => k.normalize("NFKC")).filter(Boolean);
  const scored: { start: number; score: number }[] = [];
  for (let start = 0; start < text.length; start += windowSize / 2) {
    const chunk = text.slice(start, start + windowSize).normalize("NFKC");
    let score = 0;
    for (const k of kws) {
      let idx = chunk.indexOf(k);
      while (idx >= 0) {
        score++;
        idx = chunk.indexOf(k, idx + k.length);
      }
    }
    scored.push({ start, score });
  }
  const picked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.floor(maxChars / windowSize))
    .sort((a, b) => a.start - b.start);
  return picked
    .map((p) => text.slice(p.start, p.start + windowSize))
    .join("\n……\n");
}
