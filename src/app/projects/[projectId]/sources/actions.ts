"use server";

/**
 * 資料要件画面のサーバー処理（DESIGN.md §6 SRC）
 *
 * ここは「AIが作った資料要件」を「実在する資料」に変える場所。
 * 法務上のルール（§6.2.1）はシステム側で強制する:
 *  - 引用文を登録するなら出典は必須
 *  - 下線などを加えたなら注記も必須
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projects, revisions, sourceMaterials } from "@/db/schema";
import type { SourceMaterial } from "@/domain/types";
import { InvariantError, assertCitationRules } from "@/domain/invariants";
import { newId, nowIso } from "@/lib/ids";
import { currentUserId, log } from "@/lib/session";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

/** 出典・引用文の登録 */
export async function saveMaterial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const materialId = String(formData.get("materialId") ?? "");
  const [material] = await db
    .select()
    .from(sourceMaterials)
    .where(eq(sourceMaterials.id, materialId));
  if (!material) return { error: "資料が見つかりませんでした。" };

  const citation = String(formData.get("citation") ?? "").trim();
  const quote = String(formData.get("quote") ?? "").trim();
  const isModified = formData.get("isModified") === "on";
  const modificationNote = String(formData.get("modificationNote") ?? "").trim();

  const next: SourceMaterial = {
    id: material.id,
    provesWhat: String(formData.get("provesWhat") ?? material.provesWhat).trim(),
    sourceType: material.sourceType as SourceMaterial["sourceType"],
    // 出典が入ったら「発見済」に上がる。確認済への昇格は別操作
    status: citation ? (material.status === "verified" ? "verified" : "found") : "needed",
    citation: citation || undefined,
    quote: quote || undefined,
    isModified,
    modificationNote: modificationNote || undefined,
  };

  try {
    assertCitationRules(next);
  } catch (err) {
    if (err instanceof InvariantError) return { error: err.message };
    throw err;
  }

  const userId = (await currentUserId()) ?? "unknown";

  // 変更前を残す（§6.2 完全性）
  await db.insert(revisions).values({
    id: newId("rev"),
    projectId: material.projectId,
    entityType: "source",
    entityId: material.id,
    snapshot: material,
    changedBy: userId,
    origin: "human",
  });

  await db
    .update(sourceMaterials)
    .set({
      provesWhat: next.provesWhat,
      status: next.status,
      citation: next.citation ?? null,
      quote: next.quote ?? null,
      isModified: next.isModified,
      modificationNote: next.modificationNote ?? null,
    })
    .where(eq(sourceMaterials.id, materialId));

  await db
    .update(projects)
    .set({ updatedAt: nowIso() })
    .where(eq(projects.id, material.projectId));

  await log(userId, "edit", materialId, material.projectId, "資料の出典を登録");
  revalidatePath(`/projects/${material.projectId}/sources`);
  return { ok: true };
}

/**
 * 「確認済」への昇格。
 * 資料が実在することを人が確かめた、という記録（§6.2 信頼性）。
 * AIが出した要件をそのまま信じない仕組みなので、誰がいつ確認したかを残す。
 */
export async function verifyMaterial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const materialId = String(formData.get("materialId") ?? "");
  const [material] = await db
    .select()
    .from(sourceMaterials)
    .where(eq(sourceMaterials.id, materialId));
  if (!material) return { error: "資料が見つかりませんでした。" };

  if (!material.citation) {
    return {
      error: "先に出典を登録してください。出典のない資料は確認済にできません。",
    };
  }

  const userId = (await currentUserId()) ?? "unknown";
  const toVerified = material.status !== "verified";

  await db
    .update(sourceMaterials)
    .set({
      status: toVerified ? "verified" : "found",
      verifiedBy: toVerified ? userId : null,
      verifiedAt: toVerified ? nowIso() : null,
    })
    .where(eq(sourceMaterials.id, materialId));

  await log(
    userId,
    "verify",
    materialId,
    material.projectId,
    toVerified ? "資料を確認済にした" : "確認済を取り消した",
  );
  revalidatePath(`/projects/${material.projectId}/sources`);
  return { ok: true };
}
