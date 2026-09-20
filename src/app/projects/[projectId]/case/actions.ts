"use server";

/**
 * 立論画面のサーバー処理（DESIGN.md §5 CASE）
 *
 * 編集の原則（§14 壊さない編集）:
 *  - 保存も再生成もサブセクション単位。立論全体を作り直さない
 *  - 保存のたびに変更前をRevisionに残す（§6.2 完全性）
 *  - 保存後は必ず validateVariant を通し、資料番号と本文の整合を保つ
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caseVariants, projects, revisions } from "@/db/schema";
import type { CaseVariant, DebateCase } from "@/domain/types";
import { renderFullText } from "@/domain/case-format";
import { InvariantError, validateVariant } from "@/domain/invariants";
import { newId, nowIso } from "@/lib/ids";
import { currentUserId, log } from "@/lib/session";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { LlmConfigError, LlmSchemaError } from "@/lib/llm/provider";
import { claimRegenerationSchema } from "@/domain/schemas";
import { SYSTEM_BASE, regenerateClaimPrompt } from "@/lib/llm/prompts";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function loadVariant(variantId: string) {
  const [variant] = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.id, variantId));
  if (!variant) throw new Error("立論が見つかりませんでした。");
  return variant;
}

/** 変更前の状態を残す。あとから差分を見て戻せるようにするため */
async function snapshot(
  projectId: string,
  variantId: string,
  debateCase: DebateCase,
  origin: "ai" | "human",
) {
  await db.insert(revisions).values({
    id: newId("rev"),
    projectId,
    entityType: "case",
    entityId: variantId,
    snapshot: debateCase,
    changedBy: (await currentUserId()) ?? "unknown",
    origin,
  });
}

/** 保存の共通処理。不変条件を通してから書き戻す */
async function persist(
  variant: Awaited<ReturnType<typeof loadVariant>>,
  debateCase: DebateCase,
): Promise<ActionState> {
  debateCase.fullText = renderFullText(debateCase);

  try {
    const validated = validateVariant({
      ...(variant as unknown as CaseVariant),
      debateCase,
    });
    await db
      .update(caseVariants)
      .set({
        debateCase: validated.debateCase,
        sourceRefs: validated.sourceRefs,
      })
      .where(eq(caseVariants.id, variant.id));
  } catch (err) {
    if (err instanceof InvariantError) return { error: err.message };
    throw err;
  }

  await db
    .update(projects)
    .set({ updatedAt: nowIso() })
    .where(eq(projects.id, variant.projectId));

  revalidatePath(`/projects/${variant.projectId}/case`);
  revalidatePath(`/projects/${variant.projectId}/sources`);
  return { ok: true };
}

/** Ⅰ.主張 と Ⅲ.結論 の編集 */
export async function saveCaseFrame(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const variantId = String(formData.get("variantId") ?? "");
  const variant = await loadVariant(variantId);
  await snapshot(variant.projectId, variantId, variant.debateCase, "human");

  const debateCase: DebateCase = {
    ...variant.debateCase,
    claim: String(formData.get("claim") ?? "").trim(),
    conclusion: String(formData.get("conclusion") ?? "").trim(),
  };

  const userId = (await currentUserId()) ?? "unknown";
  await log(userId, "edit", variantId, variant.projectId, "主張・結論を編集");
  return persist(variant, debateCase);
}

/** サブセクション（（1）（2）（3））1つ分の編集 */
export async function saveClaim(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const variantId = String(formData.get("variantId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  const variant = await loadVariant(variantId);
  await snapshot(variant.projectId, variantId, variant.debateCase, "human");

  const debateCase: DebateCase = {
    ...variant.debateCase,
    sections: variant.debateCase.sections.map((s) => ({
      ...s,
      subsections: s.subsections.map((c) =>
        c.id !== claimId
          ? c
          : {
              ...c,
              title: String(formData.get("title") ?? "").trim(),
              claim: String(formData.get("claim") ?? "").trim(),
              warrant: String(formData.get("warrant") ?? "").trim(),
              impact: String(formData.get("impact") ?? "").trim(),
            },
      ),
    })),
  };

  const userId = (await currentUserId()) ?? "unknown";
  await log(userId, "edit", claimId, variant.projectId, "立論の一部を編集");
  return persist(variant, debateCase);
}

/**
 * サブセクション単位の再生成（DESIGN §5「この部分を再生成」）
 *
 * 全体を壊さないため、対象の段落だけを作り直す。
 * 既存の【資料N参照】は維持させる。番号を勝手に変えられると
 * 資料要件との対応が崩れるため。
 */
export async function regenerateClaim(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const variantId = String(formData.get("variantId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  const variant = await loadVariant(variantId);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, variant.projectId));
  if (!project) return { error: "プロジェクトが見つかりませんでした。" };

  const section = variant.debateCase.sections.find((s) =>
    s.subsections.some((c) => c.id === claimId),
  );
  const target = section?.subsections.find((c) => c.id === claimId);
  if (!section || !target) {
    return { error: "再生成する部分が見つかりませんでした。" };
  }

  // この段落が使ってよい資料番号。これ以外を本文に書かせない
  const allowedNumbers = variant.sourceRefs
    .filter((r) => target.sourceRefIds.includes(r.id))
    .map((r) => r.number);

  try {
    const { data } = await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: regenerateClaimPrompt({
        resolution: project.resolution,
        side: variant.side,
        framework: variant.framework,
        sectionTitle: section.title,
        claimTitle: target.title,
        current: target.claim,
        allowedRefNumbers: allowedNumbers,
      }),
      schema: claimRegenerationSchema,
    });

    await snapshot(variant.projectId, variantId, variant.debateCase, "ai");

    const debateCase: DebateCase = {
      ...variant.debateCase,
      sections: variant.debateCase.sections.map((s) => ({
        ...s,
        subsections: s.subsections.map((c) =>
          c.id !== claimId
            ? c
            : {
                ...c,
                claim: data.claim,
                warrant: data.warrant,
                causalChain: data.causalChain,
                impact: data.impact,
              },
        ),
      })),
    };

    const userId = (await currentUserId()) ?? "unknown";
    await log(userId, "generate", claimId, variant.projectId, "立論の一部を再生成");
    return persist(variant, debateCase);
  } catch (err) {
    if (err instanceof LlmConfigError) return { error: err.message };
    if (err instanceof LlmSchemaError) {
      return {
        error:
          "AIの出力が読み取れませんでした。もう一度「この部分を再生成」を押してください。",
      };
    }
    return {
      error:
        err instanceof Error ? err.message : "再生成に失敗しました。",
    };
  }
}

/** 採用する立論パターンを決める（DESIGN §5 パターン切替） */
export async function adoptVariant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const variantId = String(formData.get("variantId") ?? "");
  const variant = await loadVariant(variantId);

  // 採用は自分の側で1つだけ。前の採用は候補に戻す
  const siblings = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, variant.projectId));

  for (const v of siblings) {
    if (v.side !== variant.side) continue;
    const role = v.id === variantId ? "adopted" : v.role === "adopted" ? "candidate" : v.role;
    if (role !== v.role) {
      await db.update(caseVariants).set({ role }).where(eq(caseVariants.id, v.id));
    }
  }

  await db
    .update(projects)
    .set({ adoptedCaseId: variantId, updatedAt: nowIso() })
    .where(eq(projects.id, variant.projectId));

  const userId = (await currentUserId()) ?? "unknown";
  await log(userId, "edit", variantId, variant.projectId, "採用する立論を変更");

  revalidatePath(`/projects/${variant.projectId}/case`);
  revalidatePath(`/projects/${variant.projectId}/sources`);
  return { ok: true };
}
