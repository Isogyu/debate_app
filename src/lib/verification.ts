/**
 * 検証状態の判定（REQUIREMENTS.md §6.2 信頼性）
 *
 * 「AI生成（未確認）」のバッジは、人が資料の実在を確かめたら消える。
 * ここを固定値にしてしまうと、いくら確認してもバッジが消えず、
 * 画面の案内が嘘になる。
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sourceMaterials } from "@/db/schema";

/**
 * その論題の資料がすべて人の確認済みか。
 * 資料が1件もない場合は「確認済」とは呼べないので false を返す。
 */
export async function isProjectVerified(projectId: string): Promise<boolean> {
  const materials = await db
    .select({ status: sourceMaterials.status })
    .from(sourceMaterials)
    .where(eq(sourceMaterials.projectId, projectId));

  return (
    materials.length > 0 && materials.every((m) => m.status === "verified")
  );
}
