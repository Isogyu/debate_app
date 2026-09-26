/**
 * 公的APIの呼び出し（e-Gov 法令・国会会議録・e-Stat・CiNii Research）
 * 応答の読み取りは domain/source-parsers.ts（テスト可能な純粋関数）に置く。
 */

import "server-only";
import {
  articleToNum,
  findPdfLinks,
  parseCiniiOpenSearch,
  parseEgovArticle,
  parseEgovLaws,
  parseEstatStatsData,
  parseEstatStatsList,
  parseKokkaiSpeeches,
  type CiniiItem,
  type EgovArticle,
  type EstatData,
  type EstatTable,
  type KokkaiSpeech,
} from "@/domain/source-parsers";
import { fetchJson, safeFetch } from "./fetcher";

// ── e-Gov 法令 API v2 ───────────────────────────────────
const EGOV = "https://laws.e-gov.go.jp/api/2";

export interface LawArticleResult extends EgovArticle {
  lawId: string;
  url: string;
}

export async function fetchLawArticle(
  lawName: string,
  article: string,
): Promise<LawArticleResult | null> {
  const num = articleToNum(article);
  if (!num) return null;
  const list = parseEgovLaws(
    await fetchJson(`${EGOV}/laws?law_title=${encodeURIComponent(lawName)}&limit=20`),
  );
  // 「所得税法施行令」などを誤って拾わないよう、題名の完全一致を優先する
  // 法令名は完全一致を優先する。前方一致は1件に絞れるときだけ使い、
  // 「所得税法施行令」「所得税法施行規則」のような別の法令を取り違えない
  const norm = (t: string) => t.normalize("NFKC").replace(/\s/g, "");
  const exact = list.find((l) => norm(l.title) === norm(lawName));
  const prefixed = list.filter(
    (l) => norm(l.title).startsWith(norm(lawName)) && !/(施行令|施行規則|規則|省令)$/.test(l.title),
  );
  const law = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
  if (!law) return null;
  const parsed = parseEgovArticle(
    await fetchJson(
      `${EGOV}/law_data/${encodeURIComponent(law.lawId)}?response_format=json&elm=${encodeURIComponent(`MainProvision-Article_${num}`)}`,
    ),
  );
  if (!parsed || !parsed.text) return null;
  return { ...parsed, lawId: law.lawId, url: `https://laws.e-gov.go.jp/law/${law.lawId}` };
}

// ── 国会会議録検索 API ─────────────────────────────────
export async function searchSpeeches(keywords: string[], max = 10): Promise<KokkaiSpeech[]> {
  const any = keywords.slice(0, 3).join(" ");
  if (!any.trim()) return [];
  const url = `https://kokkai.ndl.go.jp/api/speech?any=${encodeURIComponent(any)}&maximumRecords=${max}&recordPacking=json`;
  return parseKokkaiSpeeches(await fetchJson(url));
}

// ── e-Stat API v3.0 ────────────────────────────────────
const ESTAT = "https://api.e-stat.go.jp/rest/3.0/app/json";

export function estatAppId(): string | null {
  return process.env.ESTAT_APP_ID?.trim() || null;
}

/**
 * e-Stat で統計表を探す。語をすべて AND にすると0件になりやすいので、
 * 語の数を減らしながら探し、見つかった表を合わせて返す。
 */
export async function searchStatTables(keywords: string[], limit = 15): Promise<EstatTable[]> {
  const appId = estatAppId();
  if (!appId) return [];
  const words = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4);
  const tries: string[][] = [];
  for (let n = Math.min(words.length, 3); n >= 1; n--) tries.push(words.slice(0, n));
  if (words.length >= 2) tries.push([words[1]]);
  const found = new Map<string, EstatTable>();
  for (const t of tries) {
    if (found.size >= limit) break;
    const word = t.join(" AND ");
    const url = `${ESTAT}/getStatsList?appId=${encodeURIComponent(appId)}&lang=J&searchWord=${encodeURIComponent(word)}&limit=${limit}`;
    try {
      for (const table of parseEstatStatsList(await fetchJson(url))) {
        if (!found.has(table.id)) found.set(table.id, table);
      }
    } catch (err) {
      console.error(`[sources] e-Stat の検索に失敗しました（${word}）:`, err instanceof Error ? err.message : err);
    }
  }
  return [...found.values()].slice(0, limit);
}

export async function fetchStatTable(tableId: string, limit = 3000): Promise<EstatData> {
  const appId = estatAppId();
  if (!appId) throw new Error("e-Stat のアプリケーションIDが設定されていません。");
  const url = `${ESTAT}/getStatsData?appId=${encodeURIComponent(appId)}&lang=J&statsDataId=${encodeURIComponent(tableId)}&metaGetFlg=Y&cntGetFlg=N&limit=${limit}`;
  return parseEstatStatsData(await fetchJson(url));
}

// ── CiNii Research ─────────────────────────────────────
export async function searchPapers(keywords: string[], count = 8): Promise<CiniiItem[]> {
  const q = keywords.slice(0, 4).join(" ");
  if (!q.trim()) return [];
  const url = `https://cir.nii.ac.jp/opensearch/articles?q=${encodeURIComponent(q)}&count=${count}&format=json`;
  return parseCiniiOpenSearch(await fetchJson(url));
}

/** 論文ページから本文PDFの候補を探す（J-STAGE・機関リポジトリ） */
export async function paperPdfCandidates(pageUrl: string): Promise<string[]> {
  try {
    const { body, finalUrl } = await safeFetch(pageUrl, "general", "text/html");
    const html = new TextDecoder("utf-8").decode(body);
    return findPdfLinks(html, finalUrl).slice(0, 3);
  } catch {
    return [];
  }
}
