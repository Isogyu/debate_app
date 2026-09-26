/**
 * 生成ステップ: 論題分析・立論の骨子・本文（字数の自動調整を含む）
 */

import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants, issueCategories, projects, sourceMaterials } from "@/db/schema";
import type {
  CaseSection,
  CaseVariant,
  Claim,
  DebateCase,
  SourceRequirement,
  SourceType,
} from "@/domain/types";
import { validateVariant } from "@/domain/invariants";
import {
  ensureRefMarkers,
  renderFullText,
  replaceSlotMarkers,
  stripLeadingNumber,
} from "@/domain/case-format";
import { countSpeechChars, estimateSpeech } from "@/domain/speech";
import { adjustLengthWarning } from "./length";
import {
  analysisOutputSchema,
  caseBodyOutputSchema,
  caseOutlineOutputSchema,
  lengthAdjustSchema,
} from "@/domain/schemas";
import { getLlmProvider } from "@/lib/llm/anthropic";
import * as P from "@/lib/llm/prompts";
import { newId, nowIso } from "@/lib/ids";
import {
  asCaseVariant,
  categoryIdsByName,
  loadCategories,
  loadProject,
  loadVariant,
  recordAiRevision,
  UsageMeter,
  type StepContext,
} from "./common";

// ── 論題分析（テーマで1回） ─────────────────────────────
export async function stepAnalysis(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const data = meter.add(
    await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.analysisPrompt(project.resolution),
      schema: analysisOutputSchema,
    }),
  );

  await db.delete(issueCategories).where(eq(issueCategories.projectId, ctx.projectId));
  // AI が同じ名前のカテゴリを2度返すと一意制約で失敗するので、名前でまとめる
  const uniqueCategories = data.categories.filter(
    (c, i, arr) => arr.findIndex((x) => x.name.trim() === c.name.trim()) === i,
  );
  await db.insert(issueCategories).values(
    uniqueCategories.map((c, i) => ({
      id: newId("cat"),
      projectId: ctx.projectId,
      name: c.name,
      description: c.description,
      sortOrder: i,
    })),
  );

  await db
    .update(projects)
    .set({
      analysis: {
        policyChange: data.policyChange,
        statusQuo: data.statusQuo,
        relatedLaws: data.relatedLaws.map((l) => ({
          id: newId("law"),
          name: l.name,
          article: l.article,
          verified: false,
        })),
        stakeholders: data.stakeholders,
        coreIssues: data.coreIssues,
        frameworks: data.frameworks,
      },
      updatedAt: nowIso(),
    })
    .where(eq(projects.id, ctx.projectId));

  await recordAiRevision(ctx.projectId, "analysis", ctx.projectId, data);
  return meter.total;
}

// ── 立論の骨子 ─────────────────────────────────────────
function emptyClaim(title: string): Claim {
  return {
    id: newId("clm"),
    categoryIds: [],
    title,
    claim: "",
    warrant: "",
    sourceRefIds: [],
    causalChain: [],
    impact: "",
  };
}

export async function stepCaseOutline(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const analysis = project.analysis;
  if (!analysis) throw new Error("先に論題の分析を終えてください。");
  const target = await loadVariant(ctx.variantId);

  // 同じ側の、既にできている立論（登録も含む）とは切り口を変える
  const siblings = await db
    .select()
    .from(caseVariants)
    .where(
      and(
        eq(caseVariants.projectId, ctx.projectId),
        eq(caseVariants.side, target.side),
        ne(caseVariants.id, target.id),
      ),
    );
  const existing = siblings
    .filter((s) => s.debateCase.sections.length > 0)
    .map((s) => ({
      framework: s.framework,
      approach: s.approach,
      claim: s.debateCase.claim,
      headings: s.debateCase.sections.flatMap((sec) => sec.subsections.map((c) => c.title)),
    }));

  const base = analysis.frameworks[target.side];
  const data = meter.add(
    await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.caseOutlinePrompt({
        resolution: project.resolution,
        side: target.side,
        frameworkName: base.name,
        criteria: base.criteria,
        secondBlockType: target.side === "affirmative" ? "environment" : "comparison",
        existing,
      }),
      schema: caseOutlineOutputSchema,
    }),
  );

  await db
    .update(caseVariants)
    .set({
      framework: data.framework,
      approach: data.approach,
      label: `${data.framework}／${data.approach}`,
      debateCase: {
        side: target.side,
        valuePremise: data.valuePremise,
        claim: data.claim,
        conclusion: data.conclusion,
        fullText: "",
        sections: data.sections.map((sec) => ({
          id: newId("sec"),
          title: stripLeadingNumber(sec.title),
          type: sec.type,
          subsections: sec.subsectionTitles.map((t) => emptyClaim(stripLeadingNumber(t))),
        })),
      },
    })
    .where(eq(caseVariants.id, target.id));
  return meter.total;
}

// ── 立論の本文 ─────────────────────────────────────────
const KIND_TO_TYPE: Record<string, SourceType> = {
  law: "law",
  precedent: "precedent",
  statistic: "statistic",
  paper: "paper",
  govt_doc: "govt_doc",
  diet_record: "diet_record",
};

export async function stepCaseBody(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  if (variant.debateCase.sections.length === 0) {
    throw new Error("先に立論の骨子を作ってください。");
  }
  const categories = (await loadCategories(ctx.projectId)).map((c) => c.name);

  const outlineJson = JSON.stringify(
    {
      claim: variant.debateCase.claim,
      sections: variant.debateCase.sections.map((s) => ({
        title: s.title,
        type: s.type,
        subsectionTitles: s.subsections.map((c) => c.title),
      })),
      conclusion: variant.debateCase.conclusion,
    },
    null,
    2,
  );

  const data = meter.add(
    await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.caseBodyPrompt(
        outlineJson,
        project.resolution,
        categories,
        variant.debateCase.sections.reduce((n, s) => n + s.subsections.length, 0),
        variant.side,
      ),
      schema: caseBodyOutputSchema,
      maxTokens: 12000,
    }),
  );

  // 再実行で資料の実体が二重にできないよう、この立論が持っていた実体を消す
  for (const ref of variant.sourceRefs) {
    await db.delete(sourceMaterials).where(eq(sourceMaterials.id, ref.materialId));
  }

  const slotToRefId = new Map<string, string>();
  const sourceRefs: SourceRequirement[] = [];

  const sections: CaseSection[] = [];
  for (const [si, s] of data.sections.entries()) {
    const subsections: Claim[] = [];
    for (const [ci, sub] of s.subsections.entries()) {
      const claimId =
        variant.debateCase.sections[si]?.subsections[ci]?.id ?? newId("clm");
      const refIds: string[] = [];
      for (const slot of sub.refSlots) {
        let refId = slotToRefId.get(slot.slot);
        if (!refId) {
          refId = newId("ref");
          slotToRefId.set(slot.slot, refId);
          const materialId = newId("mat");
          await db.insert(sourceMaterials).values({
            id: materialId,
            projectId: ctx.projectId,
            provesWhat: slot.provesWhat,
            sourceType: KIND_TO_TYPE[slot.kind ?? ""] ?? "govt_doc",
            status: "procedure",
            origin: "ai_fetched",
          });
          sourceRefs.push({
            id: refId,
            number: sourceRefs.length + 1,
            materialId,
            supportsClaimIds: [],
            categoryIds: [],
            description: "",
            searchKeywords: [],
            suggestedSourceIds: [],
            formatHint: slot.kind === "statistic" ? "chart" : slot.kind === "law" ? "law_text" : "quote",
          });
        }
        const ref = sourceRefs.find((r) => r.id === refId);
        if (ref && !ref.supportsClaimIds.includes(claimId)) ref.supportsClaimIds.push(claimId);
        refIds.push(refId);
      }

      const numbers = refIds
        .map((id) => sourceRefs.find((r) => r.id === id)?.number)
        .filter((n): n is number => n !== undefined);

      subsections.push({
        id: claimId,
        categoryIds: await categoryIdsByName(ctx.projectId, sub.categoryNames),
        title: stripLeadingNumber(sub.title),
        claim: ensureRefMarkers(replaceSlotMarkers(sub.claim, slotToRefId, sourceRefs), numbers),
        warrant: replaceSlotMarkers(sub.warrant, slotToRefId, sourceRefs),
        sourceRefIds: refIds,
        causalChain: sub.causalChain.map((c) => replaceSlotMarkers(c, slotToRefId, sourceRefs)),
        impact: replaceSlotMarkers(sub.impact, slotToRefId, sourceRefs),
      });
    }
    sections.push({
      id: variant.debateCase.sections[si]?.id ?? newId("sec"),
      title: stripLeadingNumber(s.title),
      type: s.type,
      subsections,
    });
  }

  let debateCase: DebateCase = { ...variant.debateCase, sections, fullText: "" };
  debateCase.fullText = renderFullText(debateCase);

  // 字数の自動調整（最大2回）。早口で合わせるのは減点対象なので、文章量で合わせる
  const adjusted = await adjustLength(debateCase, meter);
  debateCase = adjusted.debateCase;

  const validated = validateVariant({
    ...asCaseVariant(variant),
    debateCase,
    sourceRefs,
  } satisfies CaseVariant);

  await db
    .update(caseVariants)
    .set({
      debateCase: validated.debateCase,
      sourceRefs: validated.sourceRefs,
      lengthWarning: adjusted.warning ?? null,
    })
    .where(eq(caseVariants.id, variant.id));

  await recordAiRevision(ctx.projectId, "case", variant.id, validated.debateCase);
  return meter.total;
}

/** 読み上げ字数が適正範囲に入っているか */
export function lengthStatus(text: string): "short" | "ok" | "over" {
  return estimateSpeech(text).verdict;
}

export const MAX_LENGTH_ADJUSTMENTS = 2;

/**
 * 字数を 4分30秒超〜5分00秒 に収める（§3.3）。
 * 2回直して収まらなければ、警告を付けて保存する。
 */
export async function adjustLength(
  debateCase: DebateCase,
  meter: UsageMeter,
): Promise<{ debateCase: DebateCase; warning?: string }> {
  let current = debateCase;
  for (let attempt = 0; attempt < MAX_LENGTH_ADJUSTMENTS; attempt++) {
    const status = lengthStatus(current.fullText);
    if (status === "ok") return { debateCase: current };

    const paragraphs = current.sections.flatMap((s) =>
      s.subsections.map((c) => ({ id: c.id, title: c.title, claim: c.claim, warrant: c.warrant, impact: c.impact })),
    );
    let result;
    try {
      result = meter.add(
        await getLlmProvider().generateStructured({
          system: P.SYSTEM_BASE,
          prompt: P.lengthAdjustPrompt(
            JSON.stringify(paragraphs, null, 2),
            countSpeechChars(current.fullText),
            status === "over" ? "shorten" : "lengthen",
          ),
          schema: lengthAdjustSchema,
          maxTokens: 10000,
        }),
      );
    } catch (err) {
      console.error("[generate] 字数の調整に失敗しました", err);
      break;
    }
    current = applyParagraphEdits(current, result.paragraphs);
  }

  return { debateCase: current, warning: adjustLengthWarning(current) };
}

/**
 * 段落の書き換えを反映する。資料番号の表記が消えた段落は元に戻す
 * （資料との対応が切れると参考資料が作れない）。
 */
export function applyParagraphEdits(
  debateCase: DebateCase,
  edits: { id: string; claim: string; warrant: string; impact: string }[],
): DebateCase {
  const byId = new Map(edits.map((e) => [e.id, e]));
  const refsIn = (t: string) => (t.match(/【[^】]*?資料\d+参照】/g) ?? []).sort().join();
  const next: DebateCase = {
    ...debateCase,
    sections: debateCase.sections.map((s) => ({
      ...s,
      subsections: s.subsections.map((c) => {
        const e = byId.get(c.id);
        if (!e) return c;
        const before = refsIn(c.claim + c.warrant + c.impact);
        const after = refsIn(e.claim + e.warrant + e.impact);
        if (before !== after) return c;
        return { ...c, claim: e.claim, warrant: e.warrant, impact: e.impact };
      }),
    })),
  };
  next.fullText = renderFullText(next);
  return next;
}
