/**
 * 生成ステップ: 資料の計画・取得（v6 要件 §3.4）
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants, sourceMaterials } from "@/db/schema";
import {
  getSuggestedSource,
  sanitizeSuggestedSourceIds,
  searchUrlFor,
} from "@/domain/source-whitelist";
import type { SourceProcedure, SourceRequirement, SourceType } from "@/domain/types";
import { sourcePlanSchema } from "@/domain/schemas";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { SYSTEM_BASE } from "@/lib/llm/prompts";
import * as PS from "@/lib/llm/prompts-sources";
import { acquireMaterial, FetchBudget } from "@/lib/sources/acquire";
import {
  categoryIdsByName,
  loadCategories,
  loadMaterialsFor,
  loadProject,
  loadVariant,
  UsageMeter,
  type StepContext,
} from "./common";
import { todayJst } from "@/domain/jst";

export async function stepSourcePlan(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  if (variant.sourceRefs.length === 0) return meter.total;
  const materials = new Map((await loadMaterialsFor(variant)).map((m) => [m.id, m]));
  const categories = (await loadCategories(ctx.projectId)).map((c) => c.name);

  // 計画を立てるのは AI が取得する資料だけ（コピー・手入力の資料には触れない）
  const planned = variant.sourceRefs.filter(
    (r) => materials.get(r.materialId)?.origin === "ai_fetched",
  );
  if (planned.length === 0) return meter.total;
  const slotsJson = JSON.stringify(
    planned.map((r) => ({
      slot: String(r.number),
      provesWhat: materials.get(r.materialId)?.provesWhat ?? "",
      kind: materials.get(r.materialId)?.sourceType,
    })),
    null,
    2,
  );

  const data = meter.add(
    await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PS.sourcePlanPrompt(project.resolution, variant.debateCase.fullText, slotsJson, categories),
      schema: sourcePlanSchema,
      maxTokens: 12000,
    }),
  );

  // LLMが slot の形を変えることがある。数字で突き合わせ、駄目なら並び順で対応づける
  const digitsOf = (v: string) => v.replace(/\D/g, "");
  const bySlot = new Map(data.requirements.map((r) => [digitsOf(r.slot) || r.slot, r]));
  const updated: SourceRequirement[] = [];
  for (const ref of variant.sourceRefs) {
    const index = planned.indexOf(ref);
    const info =
      index < 0 ? undefined : (bySlot.get(String(ref.number)) ?? data.requirements[index]);
    if (!info) {
      updated.push(ref);
      continue;
    }
    await db
      .update(sourceMaterials)
      .set({ provesWhat: info.provesWhat, sourceType: info.sourceType })
      .where(eq(sourceMaterials.id, ref.materialId));
    updated.push({
      ...ref,
      description: info.description,
      searchKeywords: info.searchKeywords,
      suggestedSourceIds: sanitizeSuggestedSourceIds(info.suggestedSourceIds),
      formatHint: info.formatHint,
      categoryIds: await categoryIdsByName(ctx.projectId, info.categoryNames),
      plan: {
        lawName: info.lawName,
        article: info.article,
        statKeywords: info.statKeywords,
        statisticSteps: info.statisticSteps,
        webQuery: info.webQuery,
        whatToExtract: info.whatToExtract,
      },
    });
  }
  await db.update(caseVariants).set({ sourceRefs: updated }).where(eq(caseVariants.id, variant.id));
  return meter.total;
}

/** 取得できなかった資料の作成手順（§3.4） */
export function buildProcedure(
  provesWhat: string,
  sourceType: SourceType,
  ref: SourceRequirement,
  reasons: string[],
): SourceProcedure {
  const ids = ref.suggestedSourceIds.length
    ? ref.suggestedSourceIds
    : DEFAULT_SOURCES[sourceType] ?? [];
  const keywords =
    sourceType === "statistic" && ref.plan?.statKeywords?.length
      ? ref.plan.statKeywords
      : ref.searchKeywords;
  return {
    provesWhat,
    searchKeywords: keywords,
    whereToLook: ids
      .map((id) => {
        const s = getSuggestedSource(id);
        return s && s.url ? { label: s.label, url: searchUrlFor(id, keywords) } : null;
      })
      .filter((w): w is { label: string; url: string } => !!w),
    whatToExtract:
      ref.plan?.whatToExtract ||
      (sourceType === "law"
        ? `${ref.plan?.lawName ?? "該当法令"} ${ref.plan?.article ?? ""} の条文全文`
        : "命題を直接述べている一節（前後の文脈がわかる長さ）と、出典の情報"),
    statisticSteps: sourceType === "statistic" ? ref.plan?.statisticSteps : undefined,
    reason: reasons.join(" ／ "),
  };
}

const DEFAULT_SOURCES: Partial<Record<SourceType, string[]>> = {
  law: ["egov"],
  statistic: ["estat", "nta_toukei"],
  paper: ["cinii", "jstage"],
  diet_record: ["kokkai_giji"],
  precedent: ["courts", "cinii"],
  govt_doc: ["mof", "nta_toukei"],
  book: ["ndl"],
};

/** 1本の立論で取りに行く回数の上限 */
const FETCH_BUDGET_PER_CASE = 40;

export async function stepSourceFetch(ctx: StepContext) {
  const meter = new UsageMeter();
  const variant = await loadVariant(ctx.variantId);
  const materials = new Map((await loadMaterialsFor(variant)).map((m) => [m.id, m]));
  const budget = new FetchBudget(FETCH_BUDGET_PER_CASE);
  const today = todayJst();

  for (const ref of variant.sourceRefs) {
    const m = materials.get(ref.materialId);
    if (!m) continue;
    // 人が確認済みにした資料・過去テーマからコピーした資料・人が入れた資料は取り直さない
    // （再実行で「作成手順」に上書きしてしまわないように）
    if (m.status === "verified" || m.origin !== "ai_fetched") continue;
    const sourceType = m.sourceType as SourceType;
    const result = await acquireMaterial({ provesWhat: m.provesWhat, sourceType, ref }, meter, budget);

    if (result.kind === "acquired") {
      await db
        .update(sourceMaterials)
        .set({
          status: "unverified",
          citation: result.citation,
          quote: result.quote,
          url: result.url,
          sourceDomain: result.domain,
          lastCheckedAt: today,
          withinAllowedSources: true,
          statistic: result.statistic ?? null,
          procedure: null,
        })
        .where(eq(sourceMaterials.id, m.id));
    } else {
      await db
        .update(sourceMaterials)
        .set({
          status: "procedure",
          procedure: buildProcedure(m.provesWhat, sourceType, ref, result.reasons),
          citation: null,
          quote: null,
          url: null,
          statistic: null,
        })
        .where(eq(sourceMaterials.id, m.id));
    }
  }
  return meter.total;
}
