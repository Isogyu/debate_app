/**
 * 反駁・比較画面（DESIGN.md §8 REB）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, issueCategories, projects, rebuttals } from "@/db/schema";
import { Breadcrumb, Header, VerificationBadge } from "@/components/chrome";
import { isProjectVerified } from "@/lib/verification";
import { RebuttalView, type RebuttalView as RebuttalItem } from "./rebuttal-view";

export const dynamic = "force-dynamic";

export default async function RebuttalPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  // 資料をすべて人が確認したらバッジが「確認済」に変わる
  const verified = await isProjectVerified(projectId);

  const [rows, variants, categories] = await Promise.all([
    db.select().from(rebuttals).where(eq(rebuttals.projectId, projectId)),
    db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
    db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
  ]);

  const variantById = new Map(variants.map((v) => [v.id, v]));
  // targetClaimId から相手の主張の見出しを引く
  const claimTitleById = new Map(
    variants.flatMap((v) =>
      v.debateCase.sections.flatMap((s) =>
        s.subsections.map((c) => [c.id, c.title] as const),
      ),
    ),
  );

  const items: RebuttalItem[] = rows.map((r) => {
    const variant = variantById.get(r.targetVariantId);
    return {
      id: r.id,
      targetClaimTitle: claimTitleById.get(r.targetClaimId) ?? "",
      targetVariantLabel: variant
        ? `${variant.side === "affirmative" ? "肯定側" : "否定側"} ${variant.framework}`
        : "",
      attackPoint: r.attackPoint,
      argument: r.argument,
      categoryIds: r.categoryIds,
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
            { label: "反駁・比較" },
          ]}
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">反駁・比較</h1>
          <VerificationBadge verified={verified} projectId={projectId} />
        </div>

        <RebuttalView
          projectId={projectId}
          rebuttals={items}
          comparison={project.comparison ?? null}
          categoryNames={Object.fromEntries(categories.map((c) => [c.id, c.name]))}
        />
      </main>
    </>
  );
}
