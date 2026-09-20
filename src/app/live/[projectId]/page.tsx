/**
 * 本番モードのデータ供給（DESIGN.md §10）
 *
 * 試合中にサーバーへ問い合わせないよう、必要なデータを一度に渡しきる。
 * 本番パック（オフラインの単一HTML）でも同じデータ形を使う。
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  blocks,
  caseVariants,
  crossExamNodes,
  issueCategories,
  projects,
  rebuttals,
  sourceMaterials,
} from "@/db/schema";
import { LiveClient, type LiveData } from "./live-client";

export const dynamic = "force-dynamic";

export async function buildLiveData(projectId: string): Promise<LiveData | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const [categories, blockRows, rebuttalRows, materialRows, cxRows, variants] =
    await Promise.all([
      db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
      db.select().from(blocks).where(eq(blocks.projectId, projectId)),
      db.select().from(rebuttals).where(eq(rebuttals.projectId, projectId)),
      db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
      db.select().from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
      db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
    ]);

  const rebuttalById = new Map(rebuttalRows.map((r) => [r.id, r]));
  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const cxById = new Map(cxRows.map((c) => [c.id, c]));

  // 資料番号は採用した立論パターンのものを使う（番号はパターン内スコープ）
  const adopted =
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide);
  const numberByMaterial = new Map(
    (adopted?.sourceRefs ?? []).map((r) => [r.materialId, r.number]),
  );

  return {
    projectId,
    title: project.title,
    side: project.mySide,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    blocks: blockRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => ({
        id: b.id,
        categoryIds: b.categoryIds,
        opponentArgument: b.opponentArgument,
        summary: b.summary,
        searchText: b.searchText,
        rebuttals: b.myRebuttalIds
          .map((id) => rebuttalById.get(id))
          .filter((r) => !!r)
          .map((r) => ({
            id: r.id,
            attackPoint: r.attackPoint,
            argument: r.argument,
          })),
        materials: b.myMaterialIds
          .map((id) => materialById.get(id))
          .filter((m) => !!m)
          .map((m) => ({
            id: m.id,
            number: numberByMaterial.get(m.id) ?? 0,
            provesWhat: m.provesWhat,
            citation: m.citation ?? undefined,
          })),
        crossExams: b.myCrossExamIds
          .map((id) => cxById.get(id))
          .filter((c) => !!c)
          .map((c) => ({ id: c.id, question: c.question })),
      })),
    builtAt: new Date().toISOString(),
  };
}

export default async function LivePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await buildLiveData(projectId);
  if (!data) notFound();
  return <LiveClient data={data} />;
}
