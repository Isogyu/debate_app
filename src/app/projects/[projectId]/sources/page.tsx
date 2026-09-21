/**
 * 資料要件画面（DESIGN.md §6 SRC）
 *
 * 資料番号は立論バリエーション内でのみ一意なので、
 * どのパターンの番号体系を見ているかを常にはっきりさせる。
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, issueCategories, projects, sourceMaterials } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { getSuggestedSource } from "@/domain/source-whitelist";
import { SourcesView, type SourceItem } from "./sources-view";

export const dynamic = "force-dynamic";

export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ variant?: string; status?: string }>;
}) {
  const { projectId } = await params;
  const { variant: variantParam, status: statusParam } = await searchParams;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) notFound();

  const [variants, categories, materials] = await Promise.all([
    db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
    db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
    db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
  ]);

  // 既定は採用中のパターン。なければ自分の側の最初のもの
  const current =
    variants.find((v) => v.id === variantParam) ??
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide) ??
    variants[0];

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const claimTitleById = new Map(
    (current?.debateCase.sections ?? [])
      .flatMap((s) => s.subsections)
      .map((c) => [c.id, c.title]),
  );

  const items: SourceItem[] = (current?.sourceRefs ?? [])
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((ref) => {
      const material = materialById.get(ref.materialId);
      return {
        refId: ref.id,
        number: ref.number,
        materialId: ref.materialId,
        provesWhat: material?.provesWhat ?? "",
        sourceType: material?.sourceType ?? "book",
        status: (material?.status ?? "needed") as SourceItem["status"],
        citation: material?.citation ?? undefined,
        quote: material?.quote ?? undefined,
        isModified: material?.isModified ?? false,
        modificationNote: material?.modificationNote ?? undefined,
        description: ref.description,
        searchKeywords: ref.searchKeywords,
        // ホワイトリストにあるものだけをリンクにする（捏造されたURLを出さない）
        suggestedSources: ref.suggestedSourceIds
          .map((id) => getSuggestedSource(id))
          .filter((s) => !!s)
          .map((s) => ({ id: s.id, label: s.label, url: s.url, hint: s.hint })),
        categoryIds: ref.categoryIds,
        usedIn: ref.supportsClaimIds
          .map((id) => ({ claimId: id, title: claimTitleById.get(id) ?? "" }))
          .filter((u) => u.title),
        formatHint: ref.formatHint,
      };
    });

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "資料要件" },
          ]}
        />
        <h1 className="mb-2 text-2xl font-bold">資料要件</h1>
        <p className="mb-5 text-sm text-[var(--muted)]">
          AIが作るのは「何を証明する資料が要るか」までです。
          <b>実際の出典と引用文は、みなさんが探して登録してください。</b>
        </p>

        {items.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            資料要件がまだ生成されていません。
          </p>
        ) : (
          <SourcesView
            projectId={projectId}
            items={items}
            variants={variants.map((v) => ({
              id: v.id,
              label: `${v.side === "affirmative" ? "肯定側" : "否定側"} ${v.framework} / ${v.approach}`,
            }))}
            currentVariantId={current!.id}
            initialStatus={
              statusParam === "needed" ||
              statusParam === "found" ||
              statusParam === "verified"
                ? statusParam
                : "all"
            }
            categoryNames={Object.fromEntries(
              categories.map((c) => [c.id, c.name]),
            )}
          />
        )}
      </main>
    </>
  );
}
