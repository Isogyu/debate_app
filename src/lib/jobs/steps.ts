/**
 * 生成8ステップの実装（REQUIREMENTS.md §8）
 *
 * 各ステップは「前のステップの成果をDBから読み、LLMを呼び、結果をDBに保存する」だけ。
 * ジョブの進行・リトライ・失敗の扱いは runner.ts の責務。
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  blocks,
  caseVariants,
  crossExamNodes,
  issueCategories,
  projects,
  rebuttals,
  revisions,
  sourceMaterials,
} from "@/db/schema";
import type {
  CaseSection,
  CaseVariant,
  Claim,
  CrossExamNode,
  DebateCase,
  GenStep,
  Side,
  SourceRequirement,
} from "@/domain/types";
import { validateVariant, assertNoCycle } from "@/domain/invariants";
import {
  ensureRefMarkers,
  renderFullText,
  replaceSlotMarkers,
  stripLeadingNumber,
} from "@/domain/case-format";
import { sanitizeSuggestedSourceIds } from "@/domain/source-whitelist";
import type { LlmUsage } from "@/lib/llm/provider";
import { getLlmProvider } from "@/lib/llm/anthropic";
import {
  analysisOutputSchema,
  blocksOutputSchema,
  caseBodyOutputSchema,
  caseOutlineOutputSchema,
  comparisonOutputSchema,
  crossExamOutputSchema,
  rebuttalOutputSchema,
  sourceRequirementOutputSchema,
} from "@/domain/schemas";
import * as P from "@/lib/llm/prompts";
import { newId, nowIso } from "@/lib/ids";

/** 生成の各段で必要になる中間状態。ステップ間はDB経由で受け渡す */
async function loadProject(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("プロジェクトが見つかりませんでした。");
  return project;
}

async function loadCategories(projectId: string) {
  return db
    .select()
    .from(issueCategories)
    .where(eq(issueCategories.projectId, projectId));
}

/** 突き合わせ用に表記ゆれを吸収する（全角半角・空白・記号） */
function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s・/／,、]/g, "")
    .toLowerCase();
}

/** カテゴリ名 → ID。LLMは名前で返すのでここで解決する */
async function categoryIdsByName(
  projectId: string,
  names: string[],
): Promise<string[]> {
  const rows = await loadCategories(projectId);
  const byName = new Map(rows.map((r) => [normalizeName(r.name), r.id]));
  const ids = names
    .map((n) => byName.get(normalizeName(n)))
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

async function recordAiRevision(
  projectId: string,
  entityType: "case" | "analysis" | "source" | "rebuttal" | "block",
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
    origin: "ai", // AI生成物は未検証として記録する（§6.2 信頼性）
  });
}

// ── 1. 論題分析 ───────────────────────────────────────────
async function stepAnalysis(projectId: string): Promise<LlmUsage> {
  const project = await loadProject(projectId);
  const { data, usage } = await getLlmProvider().generateStructured({
    system: P.SYSTEM_BASE,
    prompt: P.analysisPrompt(project.resolution),
    schema: analysisOutputSchema,
  });

  // 再実行されても重複しないよう、いったん消してから入れ直す
  await db
    .delete(issueCategories)
    .where(eq(issueCategories.projectId, projectId));

  await db.insert(issueCategories).values(
    data.categories.map((c, i) => ({
      id: newId("cat"),
      projectId,
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
        // 条文全文はLLMに書かせない。人がe-Govから入れるまで verified=false
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
    .where(eq(projects.id, projectId));

  await recordAiRevision(projectId, "analysis", projectId, data);
  return usage;
}

// ── 2〜4. 立論骨子 → 本文 → 資料要件 ─────────────────────
/** 両側ぶんの骨子を作り、空の本文で登録しておく */
async function stepCaseOutline(projectId: string): Promise<LlmUsage> {
  const project = await loadProject(projectId);
  const analysis = project.analysis;
  if (!analysis) throw new Error("先に論題の分析を終えてください。");

  let total: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

  // このステップをやり直すときは作り直しになる。
  // 消さずに入れると同じ論題の立論が二重に並ぶため、先に消す
  // （反駁は外部キーで一緒に消える。作り直した立論への反駁は作り直しが要るため妥当）
  await db.delete(caseVariants).where(eq(caseVariants.projectId, projectId));

  for (const side of ["affirmative", "negative"] as Side[]) {
    const framework = analysis.frameworks[side];
    const { data, usage } = await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.caseOutlinePrompt({
        resolution: project.resolution,
        side,
        frameworkName: framework.name,
        criteria: framework.criteria,
        // 実例に倣い、肯定側は環境変化型・否定側は比較衡量型を既定にする（§2.1）
        secondBlockType: side === "affirmative" ? "environment" : "comparison",
      }),
      schema: caseOutlineOutputSchema,
    });

    const debateCase: DebateCase = {
      side,
      valuePremise: data.valuePremise,
      claim: data.claim,
      conclusion: data.conclusion,
      fullText: "",
      sections: data.sections.map((s) => ({
        id: newId("sec"),
        title: s.title,
        type: s.type,
        subsections: s.subsectionTitles.map((t) => emptyClaim(t)),
      })),
    };

    await db.insert(caseVariants).values({
      id: newId("var"),
      projectId,
      side,
      framework: data.framework,
      approach: data.approach,
      debateCase,
      sourceRefs: [],
      // 自分の側は採用候補、相手の側は想定パターンとして扱う
      role: side === project.mySide ? "candidate" : "opponent_prediction",
    });

    total = mergeUsage(total, usage);
  }
  return total;
}

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

async function stepCaseBody(projectId: string): Promise<LlmUsage> {
  const project = await loadProject(projectId);
  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));

  let total: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

  for (const variant of variants) {
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

    const { data, usage } = await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.caseBodyPrompt(
        outlineJson,
        project.resolution,
        (await loadCategories(projectId)).map((c) => c.name),
        // 字数の目安は小見出しの数で割って出すので、実際の数を渡す
        variant.debateCase.sections.reduce(
          (n, s) => n + s.subsections.length,
          0,
        ),
      ),
      schema: caseBodyOutputSchema,
      maxTokens: 12000,
    });

    // slot は本文中の【資料{slot}参照】に対応する一時キー。
    // ここで実体を作り、renumberSourceRefs が 1..N の番号に直す。
    const slotToRefId = new Map<string, string>();
    const sourceRefs: SourceRequirement[] = [];

    const sections: CaseSection[] = await Promise.all(
      data.sections.map(async (s, si) => ({
        id: variant.debateCase.sections[si]?.id ?? newId("sec"),
        title: stripLeadingNumber(s.title),
        type: s.type,
        subsections: await Promise.all(
          s.subsections.map(async (sub, ci) => {
            const claimId =
              variant.debateCase.sections[si]?.subsections[ci]?.id ??
              newId("clm");

            const refIds: string[] = [];
            for (const slot of sub.refSlots) {
              let refId = slotToRefId.get(slot.slot);
              if (!refId) {
                refId = newId("ref");
                slotToRefId.set(slot.slot, refId);
                const materialId = newId("mat");
                await db.insert(sourceMaterials).values({
                  id: materialId,
                  projectId,
                  provesWhat: slot.provesWhat,
                  sourceType: "book", // 資料要件ステップで上書きする
                  status: "needed",
                  isModified: false,
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
                  formatHint: "quote",
                });
              }
              const ref = sourceRefs.find((r) => r.id === refId);
              if (ref && !ref.supportsClaimIds.includes(claimId)) {
                ref.supportsClaimIds.push(claimId);
              }
              refIds.push(refId);
            }

            const claimText = replaceSlotMarkers(
              sub.claim,
              slotToRefId,
              sourceRefs,
            );
            const numbers = refIds
              .map((id) => sourceRefs.find((r) => r.id === id)?.number)
              .filter((n): n is number => n !== undefined);

            return {
              id: claimId,
              categoryIds: await categoryIdsByName(projectId, sub.categoryNames),
              // 見出しの番号は表示側で付けるので、ここでは落とす
              title: stripLeadingNumber(sub.title),
              claim: ensureRefMarkers(claimText, numbers),
              warrant: replaceSlotMarkers(sub.warrant, slotToRefId, sourceRefs),
              sourceRefIds: refIds,
              causalChain: sub.causalChain.map((c) =>
                replaceSlotMarkers(c, slotToRefId, sourceRefs),
              ),
              impact: replaceSlotMarkers(sub.impact, slotToRefId, sourceRefs),
            } satisfies Claim;
          }),
        ),
      })),
    );

    const debateCase: DebateCase = {
      ...variant.debateCase,
      sections,
      fullText: "",
    };
    debateCase.fullText = renderFullText(debateCase);

    // 保存前に不変条件を通す。ここで資料番号が 1..N に再採番され、本文も書き換わる
    const validated = validateVariant({
      ...(variant as unknown as CaseVariant),
      debateCase,
      sourceRefs,
    });

    await db
      .update(caseVariants)
      .set({
        debateCase: validated.debateCase,
        sourceRefs: validated.sourceRefs,
      })
      .where(eq(caseVariants.id, variant.id));

    await recordAiRevision(projectId, "case", variant.id, validated.debateCase);
    total = mergeUsage(total, usage);
  }
  return total;
}

async function stepSourceRequirements(projectId: string): Promise<LlmUsage> {
  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));
  const materials = await db
    .select()
    .from(sourceMaterials)
    .where(eq(sourceMaterials.projectId, projectId));
  const materialById = new Map(materials.map((m) => [m.id, m]));

  let total: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

  for (const variant of variants) {
    if (variant.sourceRefs.length === 0) continue;

    const slotsJson = JSON.stringify(
      variant.sourceRefs.map((r) => ({
        slot: String(r.number),
        provesWhat: materialById.get(r.materialId)?.provesWhat ?? "",
      })),
      null,
      2,
    );

    const { data, usage } = await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.sourceRequirementPrompt(slotsJson),
      schema: sourceRequirementOutputSchema,
    });

    // LLMが slot を勝手に "s1" 等へ変えることがある。
    // 数字部分だけで突き合わせ、それでも合わなければ並び順で対応づける
    const digitsOf = (v: string) => v.replace(/\D/g, "");
    const bySlot = new Map(
      data.requirements.map((r) => [digitsOf(r.slot) || r.slot, r]),
    );
    const updatedRefs: SourceRequirement[] = [];

    for (const [index, ref] of variant.sourceRefs.entries()) {
      const info =
        bySlot.get(String(ref.number)) ?? data.requirements[index];
      if (!info) {
        updatedRefs.push(ref);
        continue;
      }
      await db
        .update(sourceMaterials)
        .set({ provesWhat: info.provesWhat, sourceType: info.sourceType })
        .where(eq(sourceMaterials.id, ref.materialId));

      updatedRefs.push({
        ...ref,
        description: info.description,
        searchKeywords: info.searchKeywords,
        // ホワイトリスト外のIDはここで落とす（捏造対策）
        suggestedSourceIds: sanitizeSuggestedSourceIds(info.suggestedSourceIds),
        formatHint: info.formatHint,
        categoryIds: await categoryIdsByName(projectId, info.categoryNames),
      });
    }

    await db
      .update(caseVariants)
      .set({ sourceRefs: updatedRefs })
      .where(eq(caseVariants.id, variant.id));
    total = mergeUsage(total, usage);
  }
  return total;
}

// ── 5〜8. 質疑・反駁・ブロック・比較 ───────────────────────
async function opponentVariants(projectId: string) {
  const all = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));
  return all.filter((v) => v.role === "opponent_prediction");
}

async function stepCrossExam(projectId: string): Promise<LlmUsage> {
  const opponents = await opponentVariants(projectId);
  const categoryNames = (await loadCategories(projectId)).map((c) => c.name);
  let total: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

  for (const opponent of opponents) {
    // 相手を攻める質疑と、自分が受ける質疑の両方向を作る（U4）
    for (const direction of ["attack", "defense"] as const) {
      const { data, usage } = await getLlmProvider().generateStructured({
        system: P.SYSTEM_BASE,
        prompt: P.crossExamPrompt(
          opponent.debateCase.fullText,
          direction,
          categoryNames,
        ),
        schema: crossExamOutputSchema,
        // 分岐ツリーはJSONが嵩む。8000だと途中で切れて必ず失敗する
        maxTokens: 16000,
      });

      const idByKey = new Map(data.nodes.map((n) => [n.key, newId("cx")]));
      const nodes: CrossExamNode[] = await Promise.all(
        data.nodes.map(async (n) => ({
          id: idByKey.get(n.key)!,
          // モデルは defense の呼び出しでも "attack" と返すことがある。
          // どちらの向きで頼んだかは呼び出し側が知っているので、そちらを使う
          direction,
          targetVariantId: opponent.id,
          categoryIds: await categoryIdsByName(projectId, n.categoryNames),
          question: n.question,
          purpose: n.purpose,
          branches: n.branches.map((b) => ({
            expectedAnswer: b.expectedAnswer,
            followUpNodeId: b.followUpKey ? idByKey.get(b.followUpKey) : undefined,
            exposedWeakness: b.exposedWeakness,
          })),
        })),
      );

      // 循環したまま保存するとツリー描画が無限ループする（不変条件3）
      assertNoCycle(nodes);

      await db.insert(crossExamNodes).values(
        nodes.map((n) => ({
          id: n.id,
          projectId,
          targetVariantId: opponent.id,
          direction,
          targetClaimId: n.targetClaimId,
          question: n.question,
          purpose: n.purpose,
          categoryIds: n.categoryIds,
          branches: n.branches,
        })),
      );
      total = mergeUsage(total, usage);
    }
  }
  return total;
}

async function stepRebuttal(projectId: string): Promise<LlmUsage> {
  const opponents = await opponentVariants(projectId);
  const categoryNames = (await loadCategories(projectId)).map((c) => c.name);
  let total: LlmUsage = { inputTokens: 0, outputTokens: 0, model: "" };

  for (const opponent of opponents) {
    const { data, usage } = await getLlmProvider().generateStructured({
      system: P.SYSTEM_BASE,
      prompt: P.rebuttalPrompt(opponent.debateCase.fullText, categoryNames),
      schema: rebuttalOutputSchema,
      // 相手の全主張×4つの攻撃点ぶんを書くので長くなる
      maxTokens: 16000,
    });

    const claimByTitle = new Map(
      opponent.debateCase.sections
        .flatMap((s) => s.subsections)
        .map((c) => [c.title, c.id]),
    );

    for (const r of data.rebuttals) {
      await db.insert(rebuttals).values({
        id: newId("reb"),
        projectId,
        // どの相手想定パターンへの反駁かを保持する（レビュー M-2）
        targetVariantId: opponent.id,
        targetClaimId: claimByTitle.get(r.targetClaimTitle) ?? "",
        attackPoint: r.attackPoint,
        argument: r.argument,
        categoryIds: await categoryIdsByName(projectId, r.categoryNames),
        sourceRefIds: [],
      });
    }
    total = mergeUsage(total, usage);
  }
  return total;
}

async function stepBlocks(projectId: string): Promise<LlmUsage> {
  const rows = await db
    .select()
    .from(rebuttals)
    .where(eq(rebuttals.projectId, projectId));
  if (rows.length === 0) throw new Error("先に反駁シートを作ってください。");

  const { data, usage } = await getLlmProvider().generateStructured({
    system: P.SYSTEM_BASE,
    prompt: P.blocksPrompt(
      JSON.stringify(
        rows.map((r) => ({ attackPoint: r.attackPoint, argument: r.argument })),
        null,
        2,
      ),
      (await loadCategories(projectId)).map((c) => c.name),
    ),
    schema: blocksOutputSchema,
    // 反駁を全件束ねて書き出すため長くなる
    maxTokens: 16000,
  });

  const byArgument = new Map(rows.map((r) => [r.argument, r]));

  for (const [i, b] of data.blocks.entries()) {
    const linked = b.rebuttalArguments
      .map((a) => byArgument.get(a))
      .filter((r): r is (typeof rows)[number] => !!r);
    let categoryIds = await categoryIdsByName(projectId, b.categoryNames);
    if (categoryIds.length === 0) {
      // カテゴリが付かないブロックは本番モードから辿り着けない。
      // 束ねた反駁のカテゴリを引き継いで、必ずどこかから引ける状態にする
      categoryIds = [...new Set(linked.flatMap((r) => r.categoryIds))];
    }

    await db.insert(blocks).values({
      id: newId("blk"),
      projectId,
      opponentArgument: b.opponentArgument,
      summary: b.summary,
      categoryIds,
      myRebuttalIds: linked.map((r) => r.id),
      myCrossExamIds: [],
      myMaterialIds: [],
      // 本番モードの検索を200ms以内にするため、検索対象を事前に連結しておく
      searchText: [b.opponentArgument, b.summary, ...b.rebuttalArguments].join(
        " ",
      ),
      sortOrder: i,
    });
  }
  return usage;
}

async function stepComparison(projectId: string): Promise<LlmUsage> {
  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));
  const aff = variants.find((v) => v.side === "affirmative");
  const neg = variants.find((v) => v.side === "negative");
  if (!aff || !neg) throw new Error("両側の立論がそろっていません。");

  const categories = await loadCategories(projectId);
  const { data, usage } = await getLlmProvider().generateStructured({
    system: P.SYSTEM_BASE,
    prompt: P.comparisonPrompt(
      aff.debateCase.fullText,
      neg.debateCase.fullText,
      categories.map((c) => c.name),
    ),
    schema: comparisonOutputSchema,
  });

  const byName = new Map(categories.map((c) => [c.name, c.id]));
  await db
    .update(projects)
    .set({
      comparison: {
        criteria: data.criteria.map((c) => ({
          // 比較衡量表も争点カテゴリ軸に乗せる（§14）
          categoryId: byName.get(c.categoryName) ?? "",
          name: c.name,
          affirmative: c.affirmative,
          negative: c.negative,
        })),
        verdictLogic: data.verdictLogic,
      },
      updatedAt: nowIso(),
    })
    .where(eq(projects.id, projectId));
  return usage;
}

function mergeUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    model: b.model || a.model,
  };
}

const HANDLERS: Record<GenStep, (projectId: string) => Promise<LlmUsage>> = {
  analysis: stepAnalysis,
  case_outline: stepCaseOutline,
  case_body: stepCaseBody,
  source_req: stepSourceRequirements,
  cross_exam: stepCrossExam,
  rebuttal: stepRebuttal,
  blocks: stepBlocks,
  comparison: stepComparison,
};

export async function runStep(
  projectId: string,
  step: GenStep,
): Promise<LlmUsage> {
  return HANDLERS[step](projectId);
}
