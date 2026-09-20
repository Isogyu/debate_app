/**
 * ブロック集画面（DESIGN.md §9 BLK）
 */

import Link from "next/link";
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
import { Breadcrumb, Header } from "@/components/chrome";
import { BlocksView, type BlockView } from "./blocks-view";

export const dynamic = "force-dynamic";

export default async function BlocksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  const [blockRows, rebuttalRows, cxRows, materials, categories, variants] =
    await Promise.all([
      db.select().from(blocks).where(eq(blocks.projectId, projectId)),
      db.select().from(rebuttals).where(eq(rebuttals.projectId, projectId)),
      db.select().from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
      db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
      db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
      db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
    ]);

  const rebuttalById = new Map(rebuttalRows.map((r) => [r.id, r]));
  const cxById = new Map(cxRows.map((c) => [c.id, c]));
  const materialById = new Map(materials.map((m) => [m.id, m]));

  // 資料番号は採用パターンのもの（番号はパターン内スコープ）
  const adopted =
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide);
  const numberByMaterial = new Map(
    (adopted?.sourceRefs ?? []).map((r) => [r.materialId, r.number]),
  );

  const views: BlockView[] = blockRows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b) => ({
      id: b.id,
      categoryIds: b.categoryIds,
      opponentArgument: b.opponentArgument,
      summary: b.summary,
      rebuttals: b.myRebuttalIds
        .map((id) => rebuttalById.get(id))
        .filter((r) => !!r)
        .map((r) => ({ id: r.id, attackPoint: r.attackPoint, argument: r.argument })),
      crossExams: b.myCrossExamIds
        .map((id) => cxById.get(id))
        .filter((c) => !!c)
        .map((c) => ({ id: c.id, question: c.question })),
      materials: b.myMaterialIds
        .map((id) => materialById.get(id))
        .filter((m) => !!m)
        .map((m) => ({
          id: m.id,
          number: numberByMaterial.get(m.id) ?? 0,
          provesWhat: m.provesWhat,
        })),
    }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "ブロック集" },
          ]}
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">ブロック集</h1>
          <Link
            href={`/live/${projectId}`}
            className="rounded border-2 border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)]"
          >
            本番モードで開く
          </Link>
          <Link
            href={`/projects/${projectId}/print/blocks`}
            className="rounded border border-[var(--line)] px-4 py-2 text-sm"
          >
            印刷する
          </Link>
        </div>

        {views.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            ブロックがまだ生成されていません。
          </p>
        ) : (
          <BlocksView
            projectId={projectId}
            blocks={views}
            categories={categories
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => ({ id: c.id, name: c.name }))}
          />
        )}
      </main>
    </>
  );
}
