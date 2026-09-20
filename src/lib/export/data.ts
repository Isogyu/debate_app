/**
 * エクスポート用データの組み立て（REQUIREMENTS.md §12）
 *
 * Word生成と印刷ビューで同じデータを使う。
 * 片方だけ直して食い違う、という事故を防ぐため1箇所にまとめる。
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  blocks,
  caseVariants,
  issueCategories,
  projects,
  rebuttals,
  sourceMaterials,
} from "@/db/schema";
import type { DebateCase, LawRef, Side } from "@/domain/types";
import { assertRefNumbersConsistent, InvariantError } from "@/domain/invariants";
import type { CaseVariant } from "@/domain/types";

export interface ExportSourceEntry {
  number: number;
  provesWhat: string;
  citation?: string;
  quote?: string;
  modificationNote?: string;
  status: "needed" | "found" | "verified";
  sourceType: string;
}

export interface ExportBlockEntry {
  categoryNames: string[];
  opponentArgument: string;
  summary: string;
  rebuttalArguments: string[];
  materialNumbers: number[];
}

export interface ExportData {
  projectId: string;
  teamName: string;
  members: string[];
  side: Side;
  resolution: string;
  debateCase: DebateCase;
  relatedLaws: LawRef[];
  sources: ExportSourceEntry[];
  blocks: ExportBlockEntry[];
  /** 全資料が人の確認済みか。未確認があればエクスポートにも明記する */
  allVerified: boolean;
  /** 番号の不整合。空でなければ画面で警告する */
  warnings: string[];
}

export const SIDE_LABELS: Record<Side, string> = {
  affirmative: "肯定",
  negative: "否定",
};

export async function buildExportData(
  projectId: string,
  variantId?: string,
): Promise<ExportData | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const [variants, materials, categories, blockRows, rebuttalRows] =
    await Promise.all([
      db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
      db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
      db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
      db.select().from(blocks).where(eq(blocks.projectId, projectId)),
      db.select().from(rebuttals).where(eq(rebuttals.projectId, projectId)),
    ]);

  // 既定は採用パターン。資料番号はパターン内スコープなので、
  // どのパターンを出すかで参考資料の番号体系が変わる
  const variant =
    variants.find((v) => v.id === variantId) ??
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide) ??
    variants[0];
  if (!variant) return null;

  const warnings: string[] = [];
  try {
    assertRefNumbersConsistent(variant as unknown as CaseVariant);
  } catch (err) {
    if (err instanceof InvariantError) warnings.push(err.message);
    else throw err;
  }

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const rebuttalById = new Map(rebuttalRows.map((r) => [r.id, r]));
  const numberByMaterialId = new Map(
    variant.sourceRefs.map((r) => [r.materialId, r.number]),
  );

  const sources: ExportSourceEntry[] = variant.sourceRefs
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((ref) => {
      const m = materialById.get(ref.materialId);
      return {
        number: ref.number,
        provesWhat: m?.provesWhat ?? "",
        citation: m?.citation ?? undefined,
        quote: m?.quote ?? undefined,
        modificationNote: m?.modificationNote ?? undefined,
        status: (m?.status ?? "needed") as ExportSourceEntry["status"],
        sourceType: m?.sourceType ?? "book",
      };
    });

  return {
    projectId,
    teamName: project.teamName ?? "",
    members: project.members ?? [],
    side: variant.side,
    resolution: project.resolution,
    debateCase: variant.debateCase,
    relatedLaws: project.analysis?.relatedLaws ?? [],
    sources,
    blocks: blockRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => ({
        categoryNames: b.categoryIds
          .map((id) => categoryNameById.get(id))
          .filter((n): n is string => !!n),
        opponentArgument: b.opponentArgument,
        summary: b.summary,
        rebuttalArguments: b.myRebuttalIds
          .map((id) => rebuttalById.get(id)?.argument)
          .filter((a): a is string => !!a),
        materialNumbers: b.myMaterialIds
          .map((id) => numberByMaterialId.get(id))
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b),
      })),
    allVerified:
      sources.length > 0 && sources.every((s) => s.status === "verified"),
    warnings,
  };
}

/** 未登録の資料は出典欄を空欄で出す（§12）。空欄が残っていることを隠さない */
export const EMPTY_CITATION = "出典：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿";

/**
 * AI生成物であることをエクスポートにも残す（§6.2 信頼性 / DESIGN §14）。
 * 確認前の内容を確認済みに見せない。
 */
export function verificationNotice(allVerified: boolean): string {
  return allVerified
    ? "※この資料の出典はすべて人が実物を確認済みです。"
    : "※この文書はAIの生成を含み、出典の実在確認が未完了の資料があります。提出前に必ず確認してください。";
}
