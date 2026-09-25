/**
 * エクスポート用データの組み立て（v6 要件 F12・§1 制約2・5）
 *
 * Word と印刷画面で同じデータを使う。片方だけ直して食い違う事故を防ぐため1箇所にまとめる。
 * 単位は「立論1本」。資料番号は立論ごとに 1..N なので、立論を決めないと参考資料が作れない。
 */

import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseStrategies,
  caseVariants,
  closingTemplates,
  crossExamNodes,
  projects,
  sourceMaterials,
} from "@/db/schema";
import { matchRefMarkers, renderFullText } from "@/domain/case-format";
import { estimateSpeech, type SpeechEstimate } from "@/domain/speech";
import {
  CASE_ORIGIN_LABELS,
  SIDE_LABELS,
  SOURCE_TYPE_LABELS,
  type CaseOrigin,
  type CaseStrategy,
  type ClosingPerspective,
  type DebateCase,
  type MaterialOrigin,
  type MaterialStatus,
  type Side,
  type SourceProcedure,
  type SourceType,
  type StatisticData,
} from "@/domain/types";
// 型だけ使う（印刷画面の FlowchartPrint にそのまま渡せる形にそろえる）
import type { FlowNode } from "@/components/flowchart/flowchart-view";

export type ExportKind = "case" | "sources" | "flowchart" | "closing";

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  case: "立論",
  sources: "参考資料",
  flowchart: "質疑フローチャート",
  closing: "最終弁論の雛形",
};

// ── AI表示（§1 制約5） ──────────────────────────────────
/**
 * 画面・Word・印刷のどこでも同じ文言を出すための表示ラベル。
 * needsCheck = 人の確認がまだ（紙面で目立たせる）
 */
export interface AiLabel {
  text: string;
  needsCheck: boolean;
}

const VERIFIED: AiLabel = { text: "確認済", needsCheck: false };
const AI_UNVERIFIED: AiLabel = { text: "AI生成（未確認）", needsCheck: true };

/** 立論本文。登録（自作）の本文はAIが書いていないので表示しない */
export function caseAiLabel(origin: CaseOrigin, verified: boolean): AiLabel | null {
  if (origin === "uploaded") return null;
  return verified ? VERIFIED : AI_UNVERIFIED;
}

/** 質疑・最終弁論の雛形・特徴と戦い方。登録立論でも中身はAIが作る */
export function generatedAiLabel(verified: boolean): AiLabel {
  return verified ? VERIFIED : AI_UNVERIFIED;
}

/** 資料。取得・コピー・作成手順で文言を分ける。登録した資料はAIの表示を出さない */
export function materialAiLabel(
  status: MaterialStatus,
  origin: MaterialOrigin,
): AiLabel | null {
  if (status === "procedure") return { text: "作成手順（未完成）", needsCheck: true };
  if (origin === "uploaded") return null;
  if (status === "verified") return VERIFIED;
  if (origin === "copied") return { text: "コピー（未確認）", needsCheck: true };
  return { text: "AI取得（未確認）", needsCheck: true };
}

/** "2025-10-24" → "2025年10月24日"。実物の（最終確認日：…）の書式 */
export function formatCheckedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

// ── データ ───────────────────────────────────────────────
export interface ExportSource {
  number: number;
  /** 参照先の資料が見つからないとき null（不整合として警告する） */
  materialId: string | null;
  provesWhat: string;
  sourceType: SourceType;
  sourceTypeLabel: string;
  status: MaterialStatus;
  origin: MaterialOrigin;
  aiLabel: AiLabel | null;
  citation: string | null;
  url: string | null;
  lastCheckedAt: string | null;
  /** 表示用の（最終確認日：YYYY年M月D日）の中身 */
  lastCheckedLabel: string | null;
  quote: string | null;
  modificationNote: string | null;
  procedure: SourceProcedure | null;
  statistic: StatisticData | null;
  withinAllowedSources: boolean;
}

export interface ExportClosing {
  own: ClosingPerspective;
  opponent: ClosingPerspective;
  aiLabel: AiLabel;
}

export type ExportStrategy = Omit<CaseStrategy, "variantId" | "verified"> & {
  aiLabel: AiLabel;
};

export interface ExportData {
  projectId: string;
  themeTitle: string;
  resolution: string;
  themeArchived: boolean;
  variantId: string;
  side: Side;
  sideLabel: string;
  origin: CaseOrigin;
  originLabel: string;
  label: string;
  debateCase: DebateCase;
  /** 本文の表示ラベル。登録立論は null */
  caseAiLabel: AiLabel | null;
  speech: SpeechEstimate;
  sources: ExportSource[];
  closing: ExportClosing | null;
  strategy: ExportStrategy | null;
  questions: FlowNode[];
  questionsAiLabel: AiLabel;
  /** 出力前に知らせること。画面で一覧にする */
  warnings: string[];
}

/**
 * 立論1本分のエクスポート用データ。
 * projectId を渡すと、別テーマの立論を指定された場合に null を返す（URLの取り違え対策）。
 */
export async function buildExportData(
  variantId: string,
  opts: { projectId?: string } = {},
): Promise<ExportData | null> {
  const [variant] = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.id, variantId));
  if (!variant) return null;
  if (opts.projectId && variant.projectId !== opts.projectId) return null;

  const [[project], materials, [closing], [strategy], nodes] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, variant.projectId)),
    db
      .select()
      .from(sourceMaterials)
      .where(eq(sourceMaterials.projectId, variant.projectId)),
    db
      .select()
      .from(closingTemplates)
      .where(eq(closingTemplates.variantId, variant.id)),
    db
      .select()
      .from(caseStrategies)
      .where(eq(caseStrategies.variantId, variant.id)),
    db
      .select()
      .from(crossExamNodes)
      .where(eq(crossExamNodes.targetVariantId, variant.id))
      .orderBy(asc(crossExamNodes.chainId), asc(crossExamNodes.chainOrder)),
  ]);
  if (!project) return null;

  const warnings: string[] = [];
  const materialById = new Map(materials.map((m) => [m.id, m]));

  const sources: ExportSource[] = variant.sourceRefs
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((ref) => {
      const m = materialById.get(ref.materialId);
      if (!m) {
        warnings.push(`資料${ref.number}の中身が見つかりません。資料の画面で確認してください。`);
      }
      const sourceType = (m?.sourceType ?? "govt_doc") as SourceType;
      const status: MaterialStatus = m?.status ?? "procedure";
      const origin: MaterialOrigin = m?.origin ?? "ai_fetched";
      return {
        number: ref.number,
        materialId: m?.id ?? null,
        provesWhat: m?.provesWhat || ref.description,
        sourceType,
        sourceTypeLabel: SOURCE_TYPE_LABELS[sourceType] ?? sourceType,
        status,
        origin,
        aiLabel: materialAiLabel(status, origin),
        citation: m?.citation ?? null,
        url: m?.url ?? null,
        lastCheckedAt: m?.lastCheckedAt ?? null,
        lastCheckedLabel: formatCheckedDate(m?.lastCheckedAt),
        quote: m?.quote ?? null,
        modificationNote: m?.modificationNote ?? null,
        procedure: m?.procedure ?? null,
        statistic: m?.statistic ?? null,
        withinAllowedSources: m?.withinAllowedSources ?? true,
      };
    });

  // 資料番号の対応。登録立論は（資料N）の書き方もあるので両方の形を拾う
  const fullText = variant.debateCase.fullText || renderFullText(variant.debateCase);
  const cited = new Set<number>();
  for (const m of matchRefMarkers(fullText)) cited.add(m.number);
  const declared = new Set(sources.map((s) => s.number));
  const noMaterial = [...cited].filter((n) => !declared.has(n)).sort((a, b) => a - b);
  const notCited = [...declared].filter((n) => !cited.has(n)).sort((a, b) => a - b);
  if (noMaterial.length > 0) {
    warnings.push(
      `立論の本文で参照している資料${noMaterial.join("・")}が、参考資料にありません。`,
    );
  }
  if (notCited.length > 0) {
    warnings.push(`資料${notCited.join("・")}は、立論の本文で一度も参照されていません。`);
  }

  // 読み上げ時間（§1 制約1）。超過は減点、30秒以上余るのも損
  const speech = estimateSpeech(fullText);
  if (speech.verdict === "over") {
    warnings.push(`読み上げが${speech.label}です。5分を超えると減点されます。`);
  } else if (speech.verdict === "short") {
    warnings.push(`読み上げが${speech.label}です。30秒以上余っています。`);
  }
  if (variant.lengthWarning) warnings.push(variant.lengthWarning);

  const unfinished = sources.filter((s) => s.status === "procedure");
  if (unfinished.length > 0) {
    warnings.push(
      `資料${unfinished.map((s) => s.number).join("・")}は未完成です（作成手順のまま）。参考資料には手順として出力されます。`,
    );
  }
  const unchecked = sources.filter((s) => s.aiLabel?.needsCheck && s.status !== "procedure");
  if (unchecked.length > 0) {
    warnings.push(
      `資料${unchecked.map((s) => s.number).join("・")}は、まだ人が確認していません（出力にも「未確認」と表示されます）。`,
    );
  }
  const outside = sources.filter((s) => !s.withinAllowedSources);
  if (outside.length > 0) {
    warnings.push(
      `資料${outside.map((s) => s.number).join("・")}は新聞・民間調査などの資料です。信頼性を突かれやすいので注意してください。`,
    );
  }
  for (const s of sources) {
    const ng = s.statistic?.comparability.filter((c) => c.ok === false) ?? [];
    if (ng.length > 0) {
      warnings.push(
        `資料${s.number}の数字は、比べる前提（${ng.map((c) => c.aspect).join("・")}）がそろっていません。`,
      );
    }
  }
  const caseLabel = caseAiLabel(variant.origin, variant.verified);
  if (caseLabel?.needsCheck) {
    warnings.push("立論の本文はAIが作ったもので、まだ人が確認していません。");
  }

  const questions: FlowNode[] = nodes.map((n) => ({
    id: n.id,
    chainId: n.chainId,
    chainOrder: n.chainOrder,
    targetParagraph: n.targetParagraph,
    attackPoint: n.attackPoint,
    question: n.question,
    purpose: n.purpose,
    modelAnswer: n.modelAnswer,
    goal: n.goal ?? undefined,
    priority: n.priority,
    origin: n.origin,
    stuckCount: n.stuckCount,
    branches: n.branches,
    setOrder: n.setOrder,
  }));

  return {
    projectId: project.id,
    themeTitle: project.title,
    resolution: project.resolution,
    themeArchived: project.status === "archived",
    variantId: variant.id,
    side: variant.side,
    sideLabel: SIDE_LABELS[variant.side],
    origin: variant.origin,
    originLabel: CASE_ORIGIN_LABELS[variant.origin],
    label: variant.label,
    debateCase: variant.debateCase,
    caseAiLabel: caseLabel,
    speech,
    sources,
    closing: closing
      ? {
          own: closing.own,
          opponent: closing.opponent,
          aiLabel: generatedAiLabel(closing.verified),
        }
      : null,
    strategy: strategy
      ? { ...strategy.data, aiLabel: generatedAiLabel(strategy.verified) }
      : null,
    questions,
    questionsAiLabel: generatedAiLabel(variant.questionsVerified),
    warnings,
  };
}
