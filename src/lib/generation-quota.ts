/**
 * 生成した立論の本数（各側3本まで。v6 要件 F3）。
 * v7: 両側とも上限に達したら「立論を生成する」を「生成は各側3本までです」に変え、押せなくする。
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants } from "@/db/schema";
import { MAX_GENERATED_PER_SIDE, type Side } from "@/domain/types";

export interface GenerationQuota {
  generated: Record<Side, number>;
  remaining: Record<Side, number>;
  /** 両側とも上限に達した */
  full: boolean;
}

export async function generationQuota(projectId: string): Promise<GenerationQuota> {
  const rows = await db
    .select({ side: caseVariants.side })
    .from(caseVariants)
    .where(and(eq(caseVariants.projectId, projectId), eq(caseVariants.origin, "generated")));
  const generated: Record<Side, number> = {
    affirmative: rows.filter((r) => r.side === "affirmative").length,
    negative: rows.filter((r) => r.side === "negative").length,
  };
  const remaining: Record<Side, number> = {
    affirmative: Math.max(0, MAX_GENERATED_PER_SIDE - generated.affirmative),
    negative: Math.max(0, MAX_GENERATED_PER_SIDE - generated.negative),
  };
  return { generated, remaining, full: remaining.affirmative === 0 && remaining.negative === 0 };
}

/** 両側とも上限に達したときのタブの表示 */
export const GENERATION_FULL_LABEL = `生成は各側${MAX_GENERATED_PER_SIDE}本までです`;
