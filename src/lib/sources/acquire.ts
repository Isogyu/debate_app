/**
 * 資料の取得・作成（v6 要件 §3.4 / 計画 §6.1）
 *
 * 種類ごとに公的な情報源から実物を取り、引用は本文と照合してから採用する。
 * どこかで確かめられなかったら、その資料は完成させず「作成手順」に回す。
 */

import "server-only";
import { findQuote, relevantExcerpt } from "@/domain/quote";
import {
  estatRowLabel,
  estatRowYear,
  estatTableUrl,
  kokkaiCitation,
  type EstatRow,
} from "@/domain/source-parsers";
import {
  checkComparability,
  evaluateFormulas,
  formatNumber,
  StatisticError,
} from "@/domain/statistics";
import { WEB_SEARCH_DOMAINS, hostOf } from "@/domain/source-whitelist";
import type {
  SourceRequirement,
  SourceType,
  StatisticData,
  StatisticInput,
} from "@/domain/types";
import {
  buildStatisticSchema,
  pickQuoteSchema,
  pickSpeechSchema,
  pickStatTableSchema,
} from "@/domain/schemas";
import { getLlmProvider, LIGHT_MODEL } from "@/lib/llm/anthropic";
import * as PS from "@/lib/llm/prompts-sources";
import { SYSTEM_BASE } from "@/lib/llm/prompts";
import type { UsageMeter } from "@/lib/jobs/common";
import { FetchBlockedError, fetchDocument, saveApiDocument, type FetchedDocument } from "./fetcher";
import {
  estatAppId,
  fetchLawArticle,
  fetchStatTable,
  paperPdfCandidates,
  searchPapers,
  searchSpeeches,
  searchStatTables,
} from "./clients";

export interface AcquireInput {
  provesWhat: string;
  sourceType: SourceType;
  ref: SourceRequirement;
}

export type AcquireResult =
  | {
      kind: "acquired";
      citation: string;
      quote: string;
      url: string;
      domain: string;
      title: string;
      statistic?: StatisticData;
    }
  | { kind: "procedure"; reasons: string[] };

/** 1本の立論で取りに行く回数の上限。超えたら残りは作成手順にする */
export class FetchBudget {
  constructor(public remaining: number) {}
  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }
}

/** 出典の書式で使う発行元の名前 */
const ORG_BY_DOMAIN: [string, string][] = [
  ["nta.go.jp", "国税庁"],
  ["mof.go.jp", "財務省"],
  ["gender.go.jp", "内閣府男女共同参画局"],
  ["cao.go.jp", "内閣府"],
  ["mhlw.go.jp", "厚生労働省"],
  ["soumu.go.jp", "総務省"],
  ["stat.go.jp", "総務省統計局"],
  ["chusho.meti.go.jp", "中小企業庁"],
  ["meti.go.jp", "経済産業省"],
  ["moj.go.jp", "法務省"],
  ["courts.go.jp", "裁判所"],
  ["shugiin.go.jp", "衆議院"],
  ["sangiin.go.jp", "参議院"],
  ["kantei.go.jp", "首相官邸"],
  ["digital.go.jp", "デジタル庁"],
  ["jfc.go.jp", "日本政策金融公庫"],
];

export function orgNameForHost(host: string): string {
  for (const [domain, name] of ORG_BY_DOMAIN) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return "";
}

/** 引用文を本文から選ばせ、照合に通ったものだけを返す。外れたら1回だけ選び直させる */
async function quoteFrom(
  doc: FetchedDocument,
  input: AcquireInput,
  meter: UsageMeter,
): Promise<{ quote: string; page?: number } | null> {
  const plan = input.ref.plan;
  const keywords = [...input.ref.searchKeywords, ...(plan?.webQuery?.split(/\s+/) ?? [])];
  const excerpt = relevantExcerpt(doc.text, keywords);
  for (let attempt = 0; attempt < 2; attempt++) {
    const picked = meter.add(
      await getLlmProvider().generateStructured({
        system: SYSTEM_BASE,
        prompt:
          PS.pickQuotePrompt(input.provesWhat, plan?.whatToExtract ?? "", doc.title ?? doc.url, excerpt) +
          (attempt > 0
            ? "\n\n※前回の抜き出しは本文と一致しませんでした。本文の文字をそのまま写してください。"
            : ""),
        schema: pickQuoteSchema,
        model: LIGHT_MODEL,
        maxTokens: 4000,
      }),
    );
    if (!picked.found || !picked.quote) return null;
    const match = findQuote(doc.text, picked.quote, doc.pageOffsets);
    if (match.found) return { quote: picked.quote.trim(), page: match.page };
  }
  return null;
}

// ── 種類ごとの取得 ─────────────────────────────────────
async function acquireLaw(input: AcquireInput): Promise<AcquireResult> {
  const plan = input.ref.plan;
  if (!plan?.lawName || !plan.article) {
    return { kind: "procedure", reasons: ["法令名と条番号が特定できませんでした。"] };
  }
  const art = await fetchLawArticle(plan.lawName, plan.article);
  if (!art) {
    return {
      kind: "procedure",
      reasons: [`e-Gov で「${plan.lawName} ${plan.article}」が見つかりませんでした。`],
    };
  }
  // 条文はAPIから写したものなので照合元として保存しておく
  await saveApiDocument(`${art.url}#${art.articleTitle}`, `${art.lawTitle} ${art.articleTitle}`, art.text);
  return {
    kind: "acquired",
    citation: `${art.lawTitle}（${art.lawNum}）${art.articleTitle}`,
    quote: art.text,
    url: art.url,
    domain: "laws.e-gov.go.jp",
    title: `${art.lawTitle} ${art.articleTitle}`,
  };
}

async function acquireDiet(
  input: AcquireInput,
  meter: UsageMeter,
  budget: FetchBudget,
): Promise<AcquireResult> {
  if (!budget.take()) return { kind: "procedure", reasons: ["取得回数の上限に達しました。"] };
  const keywords = input.ref.searchKeywords.length
    ? input.ref.searchKeywords
    : (input.ref.plan?.webQuery?.split(/\s+/) ?? []);
  const speeches = await searchSpeeches(keywords, 10);
  if (speeches.length === 0) {
    return { kind: "procedure", reasons: ["国会会議録で該当する発言が見つかりませんでした。"] };
  }
  const listed = speeches.map((s, index) => ({
    index,
    header: kokkaiCitation(s),
    excerpt: relevantExcerpt(s.speech, keywords, 1500),
  }));
  const picked = meter.add(
    await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PS.pickSpeechPrompt(input.provesWhat, input.ref.plan?.whatToExtract ?? "", listed),
      schema: pickSpeechSchema,
      model: LIGHT_MODEL,
      maxTokens: 4000,
    }),
  );
  if (!picked.found || picked.index == null || !picked.quote) {
    return { kind: "procedure", reasons: ["命題を証明する発言を選べませんでした。"] };
  }
  const speech = speeches[picked.index];
  if (!speech || !findQuote(speech.speech, picked.quote).found) {
    return { kind: "procedure", reasons: ["発言の引用が会議録の本文と一致しませんでした。"] };
  }
  await saveApiDocument(speech.speechUrl, kokkaiCitation(speech), speech.speech);
  return {
    kind: "acquired",
    citation: kokkaiCitation(speech),
    quote: picked.quote.trim(),
    url: speech.speechUrl,
    domain: "kokkai.ndl.go.jp",
    title: `${speech.meeting} ${speech.speaker}`,
  };
}

const MAX_STAT_ROWS_FOR_AI = 350;

function selectRows(rows: EstatRow[], words: string[]): EstatRow[] {
  const numeric = rows.filter((r) => r.value !== null);
  if (numeric.length <= MAX_STAT_ROWS_FOR_AI) return numeric;
  const ws = words.map((w) => w.normalize("NFKC")).filter((w) => w.length >= 2);
  const scored = numeric.map((r) => {
    const label = estatRowLabel(r).normalize("NFKC");
    return { r, score: ws.filter((w) => label.includes(w)).length };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_STAT_ROWS_FOR_AI)
    .map((s) => s.r)
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
}

async function acquireStatistic(
  input: AcquireInput,
  meter: UsageMeter,
  budget: FetchBudget,
): Promise<AcquireResult> {
  if (!estatAppId()) {
    return {
      kind: "procedure",
      reasons: ["e-Stat のアプリケーションIDが未設定のため、統計を自動で取得できません（管理者が ESTAT_APP_ID を設定します）。"],
    };
  }
  const plan = input.ref.plan;
  const words = plan?.statKeywords?.length ? plan.statKeywords : input.ref.searchKeywords;
  if (!budget.take()) return { kind: "procedure", reasons: ["取得回数の上限に達しました。"] };
  const tables = await searchStatTables(words);
  if (tables.length === 0) {
    return { kind: "procedure", reasons: [`e-Stat で「${words.join(" ")}」に当たる統計表が見つかりませんでした。`] };
  }
  const choice = meter.add(
    await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PS.pickStatTablePrompt(input.provesWhat, plan?.statisticSteps ?? [], tables),
      schema: pickStatTableSchema,
      model: LIGHT_MODEL,
      maxTokens: 2000,
    }),
  );
  const table = tables.find((t) => t.id === choice.tableId);
  if (!choice.found || !table) {
    return { kind: "procedure", reasons: ["命題を示せる統計表を選べませんでした。"] };
  }
  if (!budget.take()) return { kind: "procedure", reasons: ["取得回数の上限に達しました。"] };
  const data = await fetchStatTable(table.id);
  const rows = selectRows(data.rows, [...words, ...input.provesWhat.split(/[\s、。]/)]);
  if (rows.length === 0) {
    return { kind: "procedure", reasons: ["統計表に数値の行がありませんでした。"] };
  }
  const built = meter.add(
    await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PS.buildStatisticPrompt(
        input.provesWhat,
        plan?.statisticSteps ?? [],
        `${table.statName} ${table.title}`,
        rows.map((r) => ({ key: r.key, label: estatRowLabel(r), value: r.rawValue, unit: r.unit })),
      ),
      schema: buildStatisticSchema,
      maxTokens: 6000,
    }),
  );
  if (!built.found || built.inputs.length === 0) {
    return { kind: "procedure", reasons: ["統計表から命題を示す値を選べませんでした。"] };
  }

  const rowByKey = new Map(data.rows.map((r) => [r.key, r]));
  const url = estatTableUrl(table.id);
  const inputs: StatisticInput[] = [];
  for (const i of built.inputs) {
    const row = rowByKey.get(i.row);
    if (!row || row.value === null) {
      return { kind: "procedure", reasons: [`統計表に存在しない行（${i.row}）が指定されました。`] };
    }
    inputs.push({
      key: i.key,
      // 値の名前は統計表の実際の行名を使う。AI が付けた名前は使わない
      // （行の取り違えや作った説明が資料に混ざらないように。§1-3）
      label: estatRowLabel(row),
      value: row.value,
      unit: row.unit,
      year: estatRowYear(row) || table.surveyDate,
      statName: table.statName,
      tableId: table.id,
      tableTitle: table.title,
      url,
      locator: row.labels.map((l) => `${l.className}=${l.name}`).join(" / "),
    });
  }

  let results;
  try {
    results = evaluateFormulas(inputs, built.formulas);
  } catch (err) {
    const msg = err instanceof StatisticError ? err.message : "計算に失敗しました。";
    return { kind: "procedure", reasons: [msg] };
  }

  const tableRows = built.tableRows
    .map((k) => rowByKey.get(k))
    .filter((r): r is EstatRow => !!r && r.value !== null);
  const statistic: StatisticData = {
    inputs,
    formulas: built.formulas,
    results,
    table: {
      columns: ["項目", "値", "年次"],
      rows: (tableRows.length > 0 ? tableRows : inputs.map((i) => rowByKey.get(built.inputs.find((b) => b.key === i.key)!.row)!))
        .map((r) => [estatRowLabel(r), formatNumber(r.value ?? 0, r.unit), estatRowYear(r)]),
    },
    comparability: checkComparability(inputs, built.formulas),
  };
  if (built.chart && built.chart.points.length > 0) {
    const valueOf = new Map<string, { label: string; value: number; unit: string }>();
    for (const i of inputs) valueOf.set(i.key, i);
    for (const r of results) valueOf.set(r.key, r);
    const points = built.chart.points
      .map((k) => valueOf.get(k))
      .filter((p): p is { label: string; value: number; unit: string } => !!p);
    if (points.length > 0) {
      statistic.chart = {
        type: built.chart.type,
        title: built.chart.title || input.provesWhat,
        unit: points[0].unit,
        points: points.map((p) => ({ label: p.label, value: p.value })),
      };
    }
  }

  // グラフの指定がなければ、取った値からコードで作る（資料には必ず表とグラフを付ける）
  if (!statistic.chart) {
    const points = [
      ...inputs.map((i) => ({ label: i.year ? `${i.label}（${i.year}）` : i.label, value: i.value, unit: i.unit })),
    ];
    const unit = points[0]?.unit ?? "";
    const same = points.filter((p) => p.unit === unit);
    if (same.length >= 2) {
      const years = new Set(inputs.map((i) => i.year));
      statistic.chart = {
        type: years.size === same.length && years.size > 2 ? "line" : "bar",
        title: input.provesWhat,
        unit,
        points: same.map((p) => ({ label: p.label, value: p.value })),
      };
    } else if (results.length > 0 && inputs.length >= 1) {
      // 値が1つずつでも、計算結果（割合など）を並べて見せる
      statistic.chart = {
        type: "bar",
        title: input.provesWhat,
        unit: results[0].unit,
        points: results.filter((r) => r.unit === results[0].unit).map((r) => ({ label: r.label, value: r.value })),
      };
    }
  }

  // 統計資料の本文は、表から取った値と計算過程をコードで書き起こしたもの
  const quote = [
    ...inputs.map((i) => `・${i.label}：${formatNumber(i.value, i.unit)}（${i.year}）`),
    ...results.map((r) => `・${r.label}：${r.expression}`),
  ].join("\n");

  return {
    kind: "acquired",
    citation: `${table.govOrg}「${table.statName}」${table.title}${table.surveyDate ? `（調査年月 ${table.surveyDate}）` : ""}`,
    quote,
    url,
    domain: "e-stat.go.jp",
    title: `${table.statName} ${table.title}`,
    statistic,
  };
}

async function acquirePaper(
  input: AcquireInput,
  meter: UsageMeter,
  budget: FetchBudget,
): Promise<AcquireResult> {
  const reasons: string[] = [];
  const keywords = input.ref.plan?.webQuery
    ? input.ref.plan.webQuery.split(/\s+/)
    : input.ref.searchKeywords;
  if (!budget.take()) return { kind: "procedure", reasons: ["取得回数の上限に達しました。"] };
  const papers = await searchPapers(keywords);
  if (papers.length === 0) {
    return { kind: "procedure", reasons: ["CiNii Research で該当する論文が見つかりませんでした。"] };
  }
  for (const paper of papers.slice(0, 4)) {
    if (!budget.take()) break;
    const pdfs = await paperPdfCandidates(paper.url);
    for (const pdf of pdfs) {
      if (!budget.take()) break;
      try {
        const doc = await fetchDocument(pdf, "paper_pdf");
        const q = await quoteFrom(doc, input, meter);
        if (!q) {
          reasons.push(`「${paper.title}」に命題を証明する箇所が見つかりませんでした。`);
          continue;
        }
        const authors = paper.creators.slice(0, 3).join("・");
        return {
          kind: "acquired",
          citation: `${authors ? `${authors}「` : "「"}${paper.title}」${paper.publication}${paper.date ? `（${paper.date}）` : ""}${q.page ? ` ${q.page}頁` : ""}`,
          quote: q.quote,
          url: pdf,
          domain: hostOf(pdf) ?? "",
          title: paper.title,
        };
      } catch (err) {
        reasons.push(errMessage(err));
      }
    }
    if (pdfs.length === 0) reasons.push(`「${paper.title}」は本文PDFが公開されていません。`);
  }
  return { kind: "procedure", reasons: reasons.length ? reasons.slice(0, 4) : ["公開されている本文が見つかりませんでした。"] };
}

async function acquireByWebSearch(
  input: AcquireInput,
  meter: UsageMeter,
  budget: FetchBudget,
): Promise<AcquireResult> {
  const domains =
    input.sourceType === "precedent" ? WEB_SEARCH_DOMAINS.precedent : WEB_SEARCH_DOMAINS.govt;
  const query =
    input.ref.plan?.webQuery ?? [input.provesWhat, ...input.ref.searchKeywords].join(" ");
  if (!budget.take()) return { kind: "procedure", reasons: ["取得回数の上限に達しました。"] };
  const hits = meter.add(
    await getLlmProvider().searchWeb({ query, allowedDomains: domains, maxUses: 2 }),
  );
  if (hits.length === 0) {
    return { kind: "procedure", reasons: ["公的な情報源で該当するページが見つかりませんでした。"] };
  }
  const reasons: string[] = [];
  for (const hit of hits.slice(0, 4)) {
    if (!budget.take()) break;
    try {
      const doc = await fetchDocument(hit.url);
      const q = await quoteFrom(doc, input, meter);
      if (!q) {
        reasons.push(`「${hit.title}」に命題を証明する箇所が見つかりませんでした。`);
        continue;
      }
      const host = hostOf(doc.url) ?? "";
      const org = orgNameForHost(host);
      const title = doc.title || hit.title;
      return {
        kind: "acquired",
        citation: `${org ? `${org}「${title}」` : `「${title}」`}${q.page ? ` ${q.page}頁` : ""}`,
        quote: q.quote,
        url: doc.url,
        domain: host,
        title,
      };
    } catch (err) {
      reasons.push(errMessage(err));
    }
  }
  return { kind: "procedure", reasons: reasons.slice(0, 4) };
}

function errMessage(err: unknown): string {
  if (err instanceof FetchBlockedError) return err.message;
  return err instanceof Error ? err.message : "取得に失敗しました。";
}

/** 1つの資料を取りに行く。例外は投げず、失敗は作成手順の理由として返す */
export async function acquireMaterial(
  input: AcquireInput,
  meter: UsageMeter,
  budget: FetchBudget,
): Promise<AcquireResult> {
  try {
    switch (input.sourceType) {
      case "law":
        return await acquireLaw(input);
      case "diet_record":
        return await acquireDiet(input, meter, budget);
      case "statistic":
        return await acquireStatistic(input, meter, budget);
      case "paper":
        return await acquirePaper(input, meter, budget);
      case "govt_doc":
      case "precedent":
        return await acquireByWebSearch(input, meter, budget);
      default:
        // 書籍・新聞・団体資料・自作資料は取得対象外（§1-3a）
        return {
          kind: "procedure",
          reasons: ["この種類の資料は自動取得の対象外です（書籍・新聞・民間資料・自作資料）。"],
        };
    }
  } catch (err) {
    console.warn("[sources] 取得できませんでした:", input.provesWhat, "—", errMessage(err));
    return { kind: "procedure", reasons: [errMessage(err)] };
  }
}
