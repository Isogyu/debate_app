/**
 * 生成ステップの共通部品。
 * 各ステップは「前のステップの成果をDBから読み、処理し、結果をDBに保存する」だけ。
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseVariants,
  issueCategories,
  projects,
  revisions,
  sourceMaterials,
} from "@/db/schema";
import type { CaseVariant, JobParams } from "@/domain/types";
import type { LlmUsage } from "@/lib/llm/provider";
import { newId } from "@/lib/ids";

export interface StepContext {
  jobId: string;
  projectId: string;
  variantId?: string;
  params: JobParams;
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

export function mergeUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    model: b.model || a.model,
  };
}

/** 呼び出しごとの使用量を足し込む小さな集計器 */
export class UsageMeter {
  total: LlmUsage = { ...ZERO_USAGE };
  add<T>(r: { data: T; usage: LlmUsage }): T {
    this.total = mergeUsage(this.total, r.usage);
    return r.data;
  }
}

export async function loadProject(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("テーマが見つかりませんでした。");
  return project;
}

export type VariantRow = typeof caseVariants.$inferSelect;

export async function loadVariant(variantId: string | undefined): Promise<VariantRow> {
  if (!variantId) throw new Error("対象の立論が指定されていません。");
  const [v] = await db.select().from(caseVariants).where(eq(caseVariants.id, variantId));
  if (!v) throw new Error("立論が見つかりませんでした。");
  return v;
}

export function asCaseVariant(v: VariantRow): CaseVariant {
  return {
    id: v.id,
    projectId: v.projectId,
    side: v.side,
    origin: v.origin,
    label: v.label,
    framework: v.framework,
    approach: v.approach,
    debateCase: v.debateCase,
    sourceRefs: v.sourceRefs,
    lengthWarning: v.lengthWarning ?? undefined,
    verified: v.verified,
    questionsVerified: v.questionsVerified,
  };
}

export async function loadCategories(projectId: string) {
  return db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId));
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/[\s・/／,、]/g, "").toLowerCase();
}

/** カテゴリ名 → ID。LLMは名前で返すのでここで解決する */
export async function categoryIdsByName(projectId: string, names: string[]): Promise<string[]> {
  const rows = await loadCategories(projectId);
  const byName = new Map(rows.map((r) => [normalizeName(r.name), r.id]));
  const ids = names.map((n) => byName.get(normalizeName(n))).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

export async function loadMaterialsFor(variant: VariantRow) {
  const ids = new Set(variant.sourceRefs.map((r) => r.materialId));
  if (ids.size === 0) return [];
  const rows = await db
    .select()
    .from(sourceMaterials)
    .where(eq(sourceMaterials.projectId, variant.projectId));
  return rows.filter((m) => ids.has(m.id));
}

export async function recordAiRevision(
  projectId: string,
  entityType: string,
  entityId: string,
  snapshot: unknown,
) {
  await db.insert(revisions).values({
    id: newId("rev"),
    projectId,
    entityType,
    entityId,
    snapshot,
    changedBy: "system",
    origin: "ai",
  });
}

/** 段落の一覧（質疑・数字の検査で使う）。表示名は "（1）担税力" の形 */
export function paragraphsOf(v: Pick<VariantRow, "debateCase">) {
  const out: { claimId: string; label: string; text: string; order: number }[] = [];
  let order = 0;
  v.debateCase.sections.forEach((s, i) => {
    s.subsections.forEach((c, j) => {
      out.push({
        claimId: c.id,
        label: `${i + 1}（${j + 1}）${c.title}`,
        text: [c.claim, c.warrant, c.impact].filter(Boolean).join("\n"),
        order: order++,
      });
    });
  });
  return out;
}
