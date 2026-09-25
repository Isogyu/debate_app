/**
 * 公的APIの応答を読む（副作用のない関数だけ。テストから直接呼ぶ）
 *
 *  - e-Gov 法令API v2      https://laws.e-gov.go.jp/api/2/
 *  - 国会会議録検索API      https://kokkai.ndl.go.jp/api/speech
 *  - e-Stat API v3.0        https://api.e-stat.go.jp/rest/3.0/app/json/
 *  - CiNii Research OpenSearch
 */

// ── e-Gov 法令 ──────────────────────────────────────────
const KANJI_NUM: Record<string, number> = {
  〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 「五十六」「百二十」「千」→ 数値 */
export function kanjiToNumber(text: string): number | null {
  if (/^[0-9０-９]+$/.test(text)) return Number(text.normalize("NFKC"));
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (ch in KANJI_NUM) {
      current = current * 10 + KANJI_NUM[ch];
    } else if (ch === "十" || ch === "百" || ch === "千") {
      const unit = ch === "十" ? 10 : ch === "百" ? 100 : 1000;
      total += (current || 1) * unit;
      current = 0;
    } else {
      return null;
    }
  }
  return total + current;
}

/**
 * 「第56条」「第五十六条の二」「56条」→ e-Gov の条番号 "56" / "56_2"。
 * 読めなければ null（その資料は作成手順に回す）。
 */
export function articleToNum(article: string): string | null {
  const t = article.normalize("NFKC").replace(/\s/g, "");
  const m = t.match(/第?([0-9〇一二三四五六七八九十百千]+)条(?:の([0-9〇一二三四五六七八九十百千]+))?/);
  if (!m) return null;
  const main = kanjiToNumber(m[1]);
  if (main === null) return null;
  if (!m[2]) return String(main);
  const sub = kanjiToNumber(m[2]);
  return sub === null ? null : `${main}_${sub}`;
}

export interface EgovLawSearchResult {
  lawId: string;
  lawNum: string;
  title: string;
}

interface EgovLawsResponse {
  laws?: {
    law_info?: { law_id?: string; law_num?: string };
    revision_info?: { law_title?: string; repeal_status?: string };
  }[];
}

export function parseEgovLaws(json: unknown): EgovLawSearchResult[] {
  const laws = (json as EgovLawsResponse)?.laws ?? [];
  return laws
    .filter((l) => l.law_info?.law_id && l.revision_info?.law_title)
    .filter((l) => (l.revision_info?.repeal_status ?? "None") === "None")
    .map((l) => ({
      lawId: l.law_info!.law_id!,
      lawNum: l.law_info!.law_num ?? "",
      title: l.revision_info!.law_title!,
    }));
}

interface EgovNode {
  tag?: string;
  attr?: Record<string, string>;
  children?: (EgovNode | string)[];
}

/** 法令XML（JSON化）を読み上げ用のテキストにする。項・号で改行する */
export function egovNodeToText(node: EgovNode | string): string {
  if (typeof node === "string") return node;
  const inner = (node.children ?? []).map(egovNodeToText).join("");
  switch (node.tag) {
    case "ArticleCaption":
      return `${inner}\n`;
    case "ArticleTitle":
      return `${inner}　`;
    case "Paragraph":
    case "Item":
    case "Subitem1":
    case "Subitem2":
      return `${inner}\n`;
    case "ParagraphNum":
    case "ItemTitle":
    case "Subitem1Title":
    case "Subitem2Title":
      return inner ? `${inner}　` : "";
    case "Ruby":
      // ルビの読み仮名（Rt）は本文に入れない
      return (node.children ?? [])
        .filter((c) => typeof c === "string" || c.tag !== "Rt")
        .map(egovNodeToText)
        .join("");
    case "Rt":
      return "";
    default:
      return inner;
  }
}

export interface EgovArticle {
  lawTitle: string;
  lawNum: string;
  articleTitle: string;
  text: string;
}

export function parseEgovArticle(json: unknown): EgovArticle | null {
  const j = json as {
    law_info?: { law_num?: string };
    revision_info?: { law_title?: string };
    law_full_text?: EgovNode;
  };
  const root = j?.law_full_text;
  if (!root) return null;
  // elm で条を指定すると Article が根になる
  const article = findTag(root, "Article");
  if (!article) return null;
  const titleNode = (article.children ?? []).find(
    (c): c is EgovNode => typeof c !== "string" && c.tag === "ArticleTitle",
  );
  return {
    lawTitle: j.revision_info?.law_title ?? "",
    lawNum: j.law_info?.law_num ?? "",
    articleTitle: titleNode ? egovNodeToText(titleNode).trim() : "",
    text: egovNodeToText(article).replace(/\n{2,}/g, "\n").trim(),
  };
}

function findTag(node: EgovNode, tag: string): EgovNode | null {
  if (node.tag === tag) return node;
  for (const c of node.children ?? []) {
    if (typeof c === "string") continue;
    const found = findTag(c, tag);
    if (found) return found;
  }
  return null;
}

// ── 国会会議録 ──────────────────────────────────────────
export interface KokkaiSpeech {
  speechId: string;
  session: number;
  house: string;
  meeting: string;
  issue: string;
  date: string;
  speaker: string;
  speakerPosition?: string;
  speech: string;
  speechUrl: string;
}

export function parseKokkaiSpeeches(json: unknown): KokkaiSpeech[] {
  const records =
    (json as { speechRecord?: Record<string, unknown>[] })?.speechRecord ?? [];
  return records
    .filter((r) => typeof r.speech === "string" && typeof r.speechURL === "string")
    .map((r) => ({
      speechId: String(r.speechID ?? ""),
      session: Number(r.session ?? 0),
      house: String(r.nameOfHouse ?? ""),
      meeting: String(r.nameOfMeeting ?? ""),
      issue: String(r.issue ?? ""),
      date: String(r.date ?? ""),
      speaker: String(r.speaker ?? ""),
      speakerPosition: r.speakerPosition ? String(r.speakerPosition) : undefined,
      speech: String(r.speech),
      speechUrl: String(r.speechURL),
    }));
}

/** 実物の参考資料と同じ書式: 第N回国会 院 委員会 第N号 年月日 発言者 */
export function kokkaiCitation(s: KokkaiSpeech): string {
  const [y, m, d] = s.date.split("-").map(Number);
  const date = y ? `${y}年${m}月${d}日` : s.date;
  const who = s.speakerPosition ? `${s.speaker}（${s.speakerPosition}）` : s.speaker;
  return `第${s.session}回国会 ${s.house} ${s.meeting} ${s.issue} ${date} ${who}発言`;
}

// ── e-Stat ──────────────────────────────────────────────
type Dollar = string | { $?: string; "@no"?: string } | undefined;
function dollar(v: Dollar): string {
  if (v === undefined) return "";
  return typeof v === "string" ? v : (v.$ ?? "");
}
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export interface EstatTable {
  id: string;
  statName: string;
  title: string;
  govOrg: string;
  surveyDate: string;
  openDate: string;
}

export function parseEstatStatsList(json: unknown): EstatTable[] {
  const root = (json as { GET_STATS_LIST?: Record<string, unknown> })?.GET_STATS_LIST;
  const result = root?.RESULT as { STATUS?: number; ERROR_MSG?: string } | undefined;
  if (result && result.STATUS !== undefined && result.STATUS > 1) {
    throw new Error(`e-Stat: ${result.ERROR_MSG ?? "検索に失敗しました"}`);
  }
  const list = (root?.DATALIST_INF as { TABLE_INF?: unknown })?.TABLE_INF;
  return asArray(list as Record<string, unknown> | Record<string, unknown>[]).map((t) => ({
    id: String(t["@id"] ?? ""),
    statName: dollar(t.STAT_NAME as Dollar),
    title: dollar(t.TITLE as Dollar) || dollar(t.STATISTICS_NAME as Dollar),
    govOrg: dollar(t.GOV_ORG as Dollar),
    surveyDate: String(t.SURVEY_DATE ?? ""),
    openDate: String(t.OPEN_DATE ?? ""),
  }));
}

export interface EstatRow {
  key: string;
  /** 分類ごとの名前（"時間軸: 2022年" など） */
  labels: { classId: string; className: string; code: string; name: string }[];
  value: number | null;
  rawValue: string;
  unit: string;
}

export interface EstatData {
  tableId: string;
  statName: string;
  title: string;
  rows: EstatRow[];
}

export function parseEstatStatsData(json: unknown): EstatData {
  const root = (json as { GET_STATS_DATA?: Record<string, unknown> })?.GET_STATS_DATA;
  const result = root?.RESULT as { STATUS?: number; ERROR_MSG?: string } | undefined;
  if (result && result.STATUS !== undefined && result.STATUS > 1) {
    throw new Error(`e-Stat: ${result.ERROR_MSG ?? "統計表を取得できませんでした"}`);
  }
  const sd = root?.STATISTICAL_DATA as Record<string, unknown> | undefined;
  const tableInf = sd?.TABLE_INF as Record<string, unknown> | undefined;
  const classObjs = asArray(
    (sd?.CLASS_INF as { CLASS_OBJ?: unknown })?.CLASS_OBJ as
      | Record<string, unknown>
      | Record<string, unknown>[],
  );
  const classes = new Map<
    string,
    { name: string; items: Map<string, { name: string; unit?: string }> }
  >();
  for (const obj of classObjs) {
    const items = new Map<string, { name: string; unit?: string }>();
    for (const c of asArray(obj.CLASS as Record<string, string> | Record<string, string>[])) {
      items.set(String(c["@code"]), { name: String(c["@name"] ?? ""), unit: c["@unit"] });
    }
    classes.set(String(obj["@id"]), { name: String(obj["@name"] ?? ""), items });
  }

  const values = asArray(
    (sd?.DATA_INF as { VALUE?: unknown })?.VALUE as
      | Record<string, string>
      | Record<string, string>[],
  );
  const rows: EstatRow[] = values.map((v, i) => {
    const labels: EstatRow["labels"] = [];
    let unit = v["@unit"] ?? "";
    for (const [k, code] of Object.entries(v)) {
      if (!k.startsWith("@") || k === "@unit") continue;
      const classId = k.slice(1);
      const cls = classes.get(classId);
      const item = cls?.items.get(String(code));
      if (!unit && item?.unit) unit = item.unit;
      labels.push({
        classId,
        className: cls?.name ?? classId,
        code: String(code),
        name: item?.name ?? String(code),
      });
    }
    const raw = String(v.$ ?? "");
    const num = Number(raw.replace(/,/g, ""));
    return {
      key: `r${i + 1}`,
      labels,
      value: raw !== "" && Number.isFinite(num) ? num : null,
      rawValue: raw,
      unit,
    };
  });

  return {
    tableId: String(tableInf?.["@id"] ?? ""),
    statName: dollar(tableInf?.STAT_NAME as Dollar),
    title: dollar(tableInf?.TITLE as Dollar),
    rows,
  };
}

export function estatRowLabel(row: EstatRow): string {
  return row.labels
    .filter((l) => l.classId !== "tab" || row.labels.length === 1)
    .map((l) => l.name)
    .join(" / ");
}

/** 時間軸の分類名から年次を取る（"2022年" "2022年度"） */
export function estatRowYear(row: EstatRow): string {
  const time = row.labels.find((l) => l.classId === "time");
  return time?.name ?? "";
}

export function estatTableUrl(tableId: string): string {
  return `https://www.e-stat.go.jp/dbview?sid=${encodeURIComponent(tableId)}`;
}

// ── CiNii Research ─────────────────────────────────────
export interface CiniiItem {
  title: string;
  url: string;
  creators: string[];
  publication: string;
  date: string;
}

export function parseCiniiOpenSearch(json: unknown): CiniiItem[] {
  const items = (json as { items?: Record<string, unknown>[] })?.items ?? [];
  return items
    .map((it) => {
      const link = it.link as { "@id"?: string } | string | undefined;
      const url = typeof link === "string" ? link : (link?.["@id"] ?? String(it["@id"] ?? ""));
      const creators = asArray(it["dc:creator"] as string | string[] | undefined).map(String);
      return {
        title: String(it.title ?? ""),
        url,
        creators,
        publication: String(it["prism:publicationName"] ?? ""),
        date: String(it["prism:publicationDate"] ?? ""),
      };
    })
    .filter((i) => i.title && i.url);
}

/** CiNii・J-STAGE のページHTMLから本文PDFへのリンクを探す */
export function findPdfLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = m[1];
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (/\.pdf(\?|#|$)/i.test(abs) || /jstage\.jst\.go\.jp\/article\/.+\/_pdf/.test(abs)) {
      out.add(abs);
    }
    // J-STAGE の記事ページ（_article）は PDF（_pdf）に置き換えられる
    const art = abs.match(/^(https:\/\/www\.jstage\.jst\.go\.jp\/article\/.+?)\/_article(\/.*)?$/);
    if (art) out.add(`${art[1]}/_pdf${art[2] ?? ""}`);
  }
  return [...out];
}
