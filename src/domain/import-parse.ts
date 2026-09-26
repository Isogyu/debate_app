/**
 * 登録（アップロード）の取り込み（v6 要件 §3.2）
 *
 * 自作の立論は**本文を書き換えない**。AIには「どの行が見出しか」という区切りだけを
 * 返させ、本文そのものはここで元のテキストから切り出す。
 * 資料ファイルは【資料N】の見出しで区切り、立論の【資料N参照】と番号で対応付ける。
 */

import { matchRefMarkers } from "./case-format.ts";
import type {
  CaseSection,
  Claim,
  DebateCase,
  ImportIssue,
  SectionType,
  Side,
} from "./types";

// ── 資料ファイル ────────────────────────────────────────
export interface MaterialBlock {
  number: number;
  /** 見出し直後の最初の行（資料の題名として使う） */
  title: string;
  citation: string;
  url?: string;
  /** 最終確認日（YYYY-MM-DD に直せた場合） */
  lastCheckedAt?: string;
  /** 出典行を除いた本文（引用文・表など） */
  body: string;
  raw: string;
}

/** 【資料1】 【資料１】 資料1 などの見出し。行頭にあるものだけ */
const MATERIAL_HEADING = /^[\s　]*【\s*資料\s*([0-9０-９]+)\s*】/;

const URL_PATTERN = /https?:\/\/[^\s）)」』"'<>]+/;

/** 「最終確認日：2025年10月24日」→ "2025-10-24" */
export function parseCheckedDate(text: string): string | undefined {
  const t = text.normalize("NFKC");
  const m = t.match(/(?:最終)?(?:確認|閲覧|アクセス)日?\s*[:：]?\s*(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function parseMaterialsText(text: string): MaterialBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: { number: number; lines: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(MATERIAL_HEADING);
    if (m) {
      const number = Number(m[1].normalize("NFKC"));
      const rest = line.replace(MATERIAL_HEADING, "").trim();
      blocks.push({ number, lines: rest ? [rest] : [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  return blocks.map(({ number, lines: bl }) => {
    const nonEmpty = bl.map((l) => l.trim()).filter(Boolean);
    const raw = bl.join("\n").trim();
    const urlLineIndex = nonEmpty.findIndex((l) => URL_PATTERN.test(l));
    const url = urlLineIndex >= 0 ? nonEmpty[urlLineIndex].match(URL_PATTERN)?.[0] : undefined;
    const lastCheckedAt = parseCheckedDate(raw);

    // 出典の行: URLの行とその直前の行（書名・発行者）、確認日の行
    const citationIdx = new Set<number>();
    if (urlLineIndex >= 0) {
      citationIdx.add(urlLineIndex);
      if (urlLineIndex > 0) citationIdx.add(urlLineIndex - 1);
    }
    nonEmpty.forEach((l, i) => {
      if (parseCheckedDate(l)) citationIdx.add(i);
    });
    // 実物は「出典：…」の行で終わる形もある
    nonEmpty.forEach((l, i) => {
      if (/^(出典|出所|資料出所)\s*[:：]/.test(l.normalize("NFKC"))) citationIdx.add(i);
    });

    // URL と確認日は別の欄に持つので、出典の文からは取り除く（二重に表示しない）
    const citation = nonEmpty
      .filter((_, i) => citationIdx.has(i))
      .map((l) =>
        l
          .replace(new RegExp(URL_PATTERN.source, "g"), "")
          .replace(/[（(]?\s*(最終)?(確認|閲覧|アクセス)日?\s*[:：]?[^）)]*[）)]?/g, "")
          .trim(),
      )
      .filter(Boolean)
      .join("\n");
    const body = nonEmpty.filter((_, i) => !citationIdx.has(i)).join("\n");
    const title =
      (urlLineIndex > 0 ? nonEmpty[urlLineIndex - 1] : nonEmpty[0]) ?? `資料${number}`;

    return { number, title: title.slice(0, 120), citation, url, lastCheckedAt, body, raw };
  });
}

// ── 立論の構造化 ────────────────────────────────────────
/** AI が返す区切り（行番号はすべて 0 始まり・両端を含む） */
export interface CaseStructure {
  claim: [number, number];
  sections: {
    titleLine: number;
    type: SectionType;
    /** 節の見出しと最初の段落の間の導入文 */
    intro?: [number, number] | null;
    subsections: { titleLine: number; body: [number, number] }[];
  }[];
  conclusion: [number, number];
}

export class ImportStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportStructureError";
  }
}

function sliceLines(lines: string[], [a, b]: [number, number]): string {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= lines.length) {
    throw new ImportStructureError(`行の範囲が不正です（${a}〜${b}）`);
  }
  // 段落の中の改行は残す（元の原稿の段落分けを崩さない）
  return lines
    .slice(a, b + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** 見出し行から「Ⅱ」「1.」「（1）」などの番号と記号を落とす */
export function cleanHeading(line: string): string {
  return line
    .trim()
    .replace(/^[ⅠⅡⅢⅣⅤ]+\s*[.．、]?\s*/, "")
    .replace(/^[0-9０-９]+\s*[.．、)）]\s*/, "")
    .replace(/^[（(]\s*[0-9０-９]+\s*[）)]\s*/, "")
    .trim();
}

/** 見出しの Ⅰ／Ⅱ／Ⅲ 行そのものは本文に入れない */
function stripFrameHeading(text: string): string {
  return text
    .replace(/^[ⅠⅡⅢⅣ]\s*[.．、]?\s*(主張|理由|結論|再主張)\s*/, "")
    .trim();
}

export function applyCaseStructure(
  text: string,
  structure: CaseStructure,
  side: Side,
  newId: (prefix: string) => string,
): DebateCase {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: CaseSection[] = structure.sections.map((s) => ({
    id: newId("sec"),
    title: cleanHeading(lines[s.titleLine] ?? ""),
    type: s.type,
    ...(s.intro ? { intro: sliceLines(lines, s.intro) } : {}),
    subsections: s.subsections.map(
      (sub): Claim => ({
        id: newId("clm"),
        categoryIds: [],
        title: cleanHeading(lines[sub.titleLine] ?? ""),
        // 自作の本文はそのまま段落の本文に入れる。理由づけ・効果に分けない
        claim: sliceLines(lines, sub.body),
        warrant: "",
        sourceRefIds: [],
        causalChain: [],
        impact: "",
      }),
    ),
  }));
  if (sections.length === 0 || sections.every((s) => s.subsections.length === 0)) {
    throw new ImportStructureError("Ⅱ. 理由の段落が見つかりませんでした。");
  }
  return {
    side,
    valuePremise: "",
    claim: stripFrameHeading(sliceLines(lines, structure.claim)),
    sections,
    conclusion: stripFrameHeading(sliceLines(lines, structure.conclusion)),
    fullText: "",
  };
}

/** Ⅰ／Ⅱ／Ⅲ の枠の見出しだけの行（本文ではない） */
function isFrameHeadingLine(line: string): boolean {
  return /^[ⅠⅡⅢⅣ]\s*[.．、]?\s*(主張|理由|結論|再主張)?\s*$/.test(line.trim());
}

export interface StructureCoverage {
  /** 2つ以上の範囲に入った行（本文が重複する） */
  overlapping: number[];
  /** 主張〜結論の間にあるのに、どこにも入らなかった行（本文が欠ける） */
  missingInside: number[];
  /** 主張より前・結論より後で、どこにも入らなかった行（題名・チーム名など） */
  outside: string[];
}

/**
 * 区切りが原稿全体を漏れなく・重なりなく覆っているか（§3.2「本文を書き換えない」）。
 * AI の区切りが一部の行を飛ばすと、自作の本文が黙って欠けてしまう。
 */
export function checkStructureCoverage(text: string, structure: CaseStructure): StructureCoverage {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const count = new Array<number>(lines.length).fill(0);
  const mark = (i: number) => {
    if (i >= 0 && i < lines.length) count[i]++;
  };
  const markRange = ([a, b]: [number, number]) => {
    for (let i = a; i <= b; i++) mark(i);
  };
  markRange(structure.claim);
  // 見出しの行は1回だけ数える。小見出しのない節では、節の見出しと段落の見出しが
  // 同じ行になる（実物の原稿でよくある形）
  const titles = new Set<number>();
  for (const sec of structure.sections) {
    titles.add(sec.titleLine);
    if (sec.intro) markRange(sec.intro);
    for (const sub of sec.subsections) {
      // 見出しが本文の範囲の中を指すこともある（見出しと本文が1行の原稿）
      if (sub.titleLine < sub.body[0] || sub.titleLine > sub.body[1]) titles.add(sub.titleLine);
      markRange(sub.body);
    }
  }
  for (const t of titles) mark(t);
  markRange(structure.conclusion);

  const start = structure.claim[0];
  const end = structure.conclusion[1];
  const overlapping: number[] = [];
  const missingInside: number[] = [];
  const outside: string[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    if (count[i] > 1) overlapping.push(i);
    if (count[i] > 0 || isFrameHeadingLine(line)) return;
    if (i > start && i < end) missingInside.push(i);
    else outside.push(line.trim());
  });
  return { overlapping, missingInside, outside };
}

/**
 * AI の区切りの取りこぼしをコードで補う。本文の行が区切りから漏れても、
 * 位置から持ち主が一意に決まるものは、そこへ含める（本文は書き換えない）。
 *  - 節の見出しと最初の（1）の間の行 → 節の導入文
 *  - 段落の本文の後ろ〜次の見出しの前の行 → その段落の本文の続き
 * 実物の原稿（docs/samples）には、どちらの形もある。
 */
export function repairStructure(text: string, structure: CaseStructure): CaseStructure {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const isContent = (i: number) =>
    i >= 0 && i < lines.length && !!lines[i].trim() && !isFrameHeadingLine(lines[i]);

  // 境界になる行（見出し・本文の始まり）の一覧。次の境界の手前までを持ち主の範囲とする
  const boundaries = new Set<number>([structure.conclusion[0]]);
  for (const sec of structure.sections) {
    boundaries.add(sec.titleLine);
    for (const sub of sec.subsections) boundaries.add(Math.min(sub.titleLine, sub.body[0]));
  }
  for (let i = 0; i < lines.length; i++) {
    if (isFrameHeadingLine(lines[i]) && lines[i].trim()) boundaries.add(i);
  }
  const nextBoundaryAfter = (i: number) => {
    let next = lines.length;
    for (const b of boundaries) if (b > i && b < next) next = b;
    return next;
  };
  const lastContentBefore = (from: number, to: number) => {
    let last = -1;
    for (let i = from; i < to; i++) if (isContent(i)) last = i;
    return last;
  };

  return {
    ...structure,
    sections: structure.sections.map((sec) => {
      const first = sec.subsections[0];
      let intro = sec.intro ?? null;
      if (!intro && first) {
        const firstStart = Math.min(first.titleLine, first.body[0]);
        if (firstStart > sec.titleLine + 1) {
          const last = lastContentBefore(sec.titleLine + 1, firstStart);
          if (last >= 0) {
            let start = sec.titleLine + 1;
            while (start < last && !isContent(start)) start++;
            intro = [start, last];
          }
        }
      }
      return {
        ...sec,
        intro,
        subsections: sec.subsections.map((sub) => {
          const end = nextBoundaryAfter(sub.body[1]);
          const last = lastContentBefore(sub.body[1] + 1, end);
          return last > sub.body[1] ? { ...sub, body: [sub.body[0], last] as [number, number] } : sub;
        }),
      };
    }),
  };
}

/** 本文に出てくる資料番号（【資料N参照】と（資料N）の両方） */
export function caseRefNumbers(text: string): number[] {
  return [...new Set([...matchRefMarkers(text)].map((m) => m.number))].sort(
    (a, b) => a - b,
  );
}

/** 立論と資料の番号の対応を検査する（§3.2 手順4） */
export function numberingIssues(
  caseText: string,
  materials: MaterialBlock[] | null,
): ImportIssue[] {
  const used = caseRefNumbers(caseText);
  if (!materials) {
    return used.length > 0
      ? [
          {
            severity: "warning",
            message: `立論に資料番号（${used.join("・")}）がありますが、資料ファイルが登録されていません。`,
          },
        ]
      : [];
  }
  const declared = new Set(materials.map((m) => m.number));
  const issues: ImportIssue[] = [];
  const missing = used.filter((n) => !declared.has(n));
  if (missing.length > 0) {
    issues.push({
      severity: "error",
      message: `立論にある【資料${missing.join("】【資料")}参照】に対応する資料が、資料ファイルにありません。`,
    });
  }
  const unused = [...declared].filter((n) => !used.includes(n)).sort((a, b) => a - b);
  if (unused.length > 0) {
    issues.push({
      severity: "warning",
      message: `資料ファイルの【資料${unused.join("】【資料")}】は、立論のどこからも参照されていません。`,
    });
  }
  const dup = materials
    .map((m) => m.number)
    .filter((n, i, arr) => arr.indexOf(n) !== i);
  if (dup.length > 0) {
    issues.push({
      severity: "error",
      message: `資料ファイルに同じ番号の資料が複数あります（${[...new Set(dup)].join("・")}）。`,
    });
  }
  if (materials.length === 0) {
    issues.push({
      severity: "warning",
      message: "資料ファイルから【資料N】の見出しが見つかりませんでした。見出しの書き方を確認してください。",
    });
  }
  return issues;
}

/** AIに渡すための行番号付きテキスト */
export function numberedLines(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l, i) => `${i}: ${l}`)
    .join("\n");
}
