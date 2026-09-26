/**
 * Word 出力（v6 要件 F12・§1 制約2 実フォーマット・§3.4 資料の完成度）
 *
 * 実物（docs/samples）の書式に合わせる:
 *  - 立論: Ⅰ. 主張 / Ⅱ. 理由（1. 見出し →（1）小見出し）/ Ⅲ. 結論。本文中の【資料N参照】は残す
 *  - 参考資料: 【資料N】→ 題名 → 出典 → URL →（最終確認日：YYYY年M月D日）→ 引用文
 *  - 統計資料は Word の表＋グラフ画像＋計算過程＋比較の前提の検査結果まで載せる
 * AIが作ったもので人が確認していないものは、紙面にも「未確認」と必ず出す（§1 制約5）。
 */

import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { formatNumber } from "@/domain/statistics";
import type { ComparabilityCheck, SourceProcedure, StatisticData } from "@/domain/types";
import { svgToPng } from "./chart-png";
import { statisticChartSvg } from "./chart-svg";
import type { AiLabel, ExportData, ExportSource } from "./data";

/** ゼミ生の Word に確実にある書体 */
const FONT = "游明朝";
const GOTHIC = "游ゴシック";
const BODY = 21; // half-point = 10.5pt
const SMALL = 18;

type Block = Paragraph | Table;

function run(text: string, o: { bold?: boolean; size?: number; font?: string; underline?: boolean } = {}) {
  return new TextRun({
    text,
    bold: o.bold,
    size: o.size ?? BODY,
    font: o.font ?? FONT,
    underline: o.underline ? {} : undefined,
  });
}

/** 実物は全角スペースで字下げしている。コピーしても崩れないよう文字で入れる */
function body(text: string, indent = 1, after = 120): Paragraph {
  return new Paragraph({
    children: [run("　".repeat(indent) + text)],
    spacing: { after },
  });
}

function line(text: string, o: { bold?: boolean; size?: number; before?: number; after?: number; font?: string } = {}) {
  return new Paragraph({
    children: [run(text, o)],
    spacing: { before: o.before ?? 0, after: o.after ?? 60 },
  });
}

function heading(text: string): Paragraph {
  return line(text, { bold: true, before: 240, after: 120 });
}

/** 未確認の表示。目立つよう枠で囲む */
function noticeBox(text: string): Paragraph {
  const border = { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 4 };
  return new Paragraph({
    children: [run(text, { bold: true, size: SMALL, font: GOTHIC })],
    border: { top: border, bottom: border, left: border, right: border },
    spacing: { before: 120, after: 200 },
  });
}

function labelText(label: AiLabel | null): string {
  return label ? `［${label.text}］` : "";
}

function titleBlock(data: ExportData, kind: "立論" | "参考資料"): Paragraph[] {
  return [
    new Paragraph({
      children: [run(`${data.themeTitle}　${data.sideLabel}${kind}`, { bold: true, size: 26 })],
      spacing: { after: 60 },
    }),
    line(`論題：${data.resolution}`, { size: SMALL }),
    line(`立論：${data.label}（${data.originLabel}）`, { size: SMALL, after: 240 }),
  ];
}

// ── 立論 ─────────────────────────────────────────────────
export async function buildCaseDocx(data: ExportData): Promise<Buffer> {
  const c = data.debateCase;
  const children: Block[] = [...titleBlock(data, "立論")];

  if (data.caseAiLabel?.needsCheck) {
    children.push(
      noticeBox(
        "【AI生成（未確認）】この立論はAIが作成し、まだ人が確認していません。資料の中身と照らして確認してから使ってください。",
      ),
    );
  }

  if (c.sections.length === 0) {
    // 登録立論で構造化できなかった場合は、原文をそのまま出す（書き換えない）
    for (const l of c.fullText.split(/\r?\n/)) children.push(body(l, 0, 60));
  } else {
    children.push(heading("Ⅰ. 主張"), body(c.claim));
    children.push(heading("Ⅱ. 理由"));
    c.sections.forEach((section, i) => {
      children.push(line(`${i + 1}. ${section.title}`, { bold: true, before: 200, after: 100 }));
      section.subsections.forEach((sub, j) => {
        if (section.subsections.length > 1 || sub.title !== section.title) {
          children.push(line(`　（${j + 1}）${sub.title}`, { bold: true, before: 120, after: 80 }));
        }
        children.push(body(sub.claim, 2));
        if (sub.warrant) children.push(body(sub.warrant, 2));
        if (sub.impact) children.push(body(sub.impact, 2));
      });
    });
    children.push(heading("Ⅲ. 結論"), body(c.conclusion));
  }

  children.push(
    new Paragraph({ children: [] }),
    new Paragraph({
      children: [
        run(
          `読み上げ時間の目安：${data.speech.label}（${data.speech.chars}字）${
            data.caseAiLabel ? `　${labelText(data.caseAiLabel)}` : ""
          }`,
          { size: SMALL },
        ),
      ],
      alignment: AlignmentType.RIGHT,
    }),
  );

  return pack(children);
}

// ── 参考資料 ─────────────────────────────────────────────
export async function buildSourcesDocx(data: ExportData): Promise<Buffer> {
  const children: Block[] = [...titleBlock(data, "参考資料")];

  const needs = data.sources.filter((s) => s.aiLabel?.needsCheck);
  if (needs.length > 0) {
    children.push(
      noticeBox(
        `【要確認】資料${needs.map((s) => s.number).join("・")}は、未確認または未完成です。` +
          "各資料の見出しの［ ］内の表示を確認し、出典の実物と照らしてから使ってください。",
      ),
    );
  }
  if (data.sources.length === 0) children.push(body("（資料がありません）"));

  for (const s of data.sources) {
    children.push(...sourceBlocks(s));
  }
  return pack(children);
}

function sourceBlocks(s: ExportSource): Block[] {
  const out: Block[] = [
    new Paragraph({
      children: [
        run(`【資料${s.number}】`, { bold: true }),
        ...(s.aiLabel ? [run(`　${labelText(s.aiLabel)}`, { size: SMALL, font: GOTHIC, bold: true })] : []),
      ],
      spacing: { before: 360, after: 120 },
    }),
  ];

  if (s.status === "procedure") {
    out.push(...procedureBlocks(s));
    return out;
  }

  out.push(line(s.provesWhat, { bold: true, after: 80 }));
  if (s.citation) out.push(line(s.citation));
  if (s.url) out.push(line(s.url, { size: SMALL }));
  if (s.lastCheckedLabel) out.push(line(`（最終確認日：${s.lastCheckedLabel}）`, { after: 120 }));
  if (s.quote) {
    out.push(body(`「${s.quote}」${s.modificationNote ?? ""}`, 0));
  }
  if (s.statistic) out.push(...statisticBlocks(s.statistic));
  if (!s.withinAllowedSources) {
    out.push(
      line("※新聞・民間調査などの資料です。信頼性を突かれやすい点に注意してください。", {
        size: SMALL,
      }),
    );
  }
  return out;
}

/** 取得できなかった資料は、埋め方が分かる手順として出す（§3.4） */
function procedureBlocks(s: ExportSource): Block[] {
  const p: SourceProcedure | null = s.procedure;
  const out: Block[] = [noticeBox("この資料は未完成です（作成手順）。以下の手順で資料を探して完成させてください。")];
  out.push(line("何を証明する資料か", { bold: true }), body(p?.provesWhat || s.provesWhat));
  if (p?.reason) out.push(line("自動で完成できなかった理由", { bold: true }), body(p.reason));
  if (p?.searchKeywords.length) {
    out.push(line("検索に使う言葉", { bold: true }), body(p.searchKeywords.join("　／　")));
  }
  if (p?.whereToLook.length) {
    out.push(line("探す場所", { bold: true }));
    for (const w of p.whereToLook) out.push(body(`・${w.label}　${w.url}`));
  }
  if (p?.whatToExtract) out.push(line("見つけたら抜き出すもの", { bold: true }), body(p.whatToExtract));
  if (p?.statisticSteps?.length) {
    out.push(line("統計の作り方", { bold: true }));
    p.statisticSteps.forEach((step, i) => out.push(body(`${i + 1}. ${step}`)));
  }
  return out;
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };

function cell(text: string, header = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [run(text, { bold: header, size: SMALL, font: header ? GOTHIC : FONT })],
      }),
    ],
    shading: header ? { fill: "EEEEEE", type: "clear", color: "auto" } : undefined,
    borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
}

function simpleTable(columns: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: columns.map((c) => cell(c, true)), tableHeader: true }),
      ...rows.map(
        (r) => new TableRow({ children: columns.map((_, i) => cell(r[i] ?? "")) }),
      ),
    ],
  });
}

export function comparabilityMark(c: ComparabilityCheck): string {
  return c.ok === true ? "○" : c.ok === false ? "NG" : "要確認";
}

/** 統計資料: 表 → グラフ → 元の数値 → 計算過程 → 比較の前提（§1-9） */
function statisticBlocks(stat: StatisticData): Block[] {
  const out: Block[] = [];
  if (stat.table.columns.length > 0) {
    out.push(line("表", { bold: true, before: 160 }), simpleTable(stat.table.columns, stat.table.rows));
  }

  if (stat.chart && stat.chart.points.length > 0) {
    out.push(line("グラフ", { bold: true, before: 160 }));
    const png = svgToPng(statisticChartSvg(stat.chart), 1200);
    if (png) {
      out.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: png,
              transformation: { width: 480, height: 300 },
              altText: { name: stat.chart.title, title: stat.chart.title, description: stat.chart.title },
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      );
    } else {
      out.push(
        line("（グラフ画像を作れませんでした。上の表の数値を使ってください）", { size: SMALL }),
      );
    }
  }

  if (stat.inputs.length > 0) {
    out.push(line("元の数値と出典", { bold: true, before: 160 }));
    for (const i of stat.inputs) {
      out.push(
        body(
          `・${i.label}：${formatNumber(i.value, i.unit)}（${i.statName}「${i.tableTitle}」${i.year}${
            i.tableId ? `、表番号 ${i.tableId}` : ""
          }）${i.url ? `　${i.url}` : ""}`,
        ),
      );
    }
  }

  if (stat.results.length > 0) {
    out.push(line("計算過程", { bold: true, before: 160 }));
    for (const r of stat.results) out.push(body(`・${r.label}：${r.expression}`));
  }

  if (stat.comparability.length > 0) {
    out.push(
      line("比較の前提の検査", { bold: true, before: 160 }),
      simpleTable(
        ["観点", "判定", "内容"],
        stat.comparability.map((c) => [c.aspect, comparabilityMark(c), c.note]),
      ),
    );
  }
  return out;
}

async function pack(children: Block[]): Promise<Buffer> {
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

/** ファイル名。Word で開いたとき・一覧で見たときに何か分かるようにする */
export function exportFileName(data: ExportData, kind: "case" | "sources"): string {
  const kindLabel = kind === "case" ? "立論" : "参考資料";
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 40);
  return `${safe(data.themeTitle)}_${data.sideLabel}_${safe(data.label)}_${kindLabel}.docx`;
}
