/**
 * 立論画面（DESIGN.md §5 CASE）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  caseVariants,
  generationJobs,
  issueCategories,
  projects,
  sourceMaterials,
} from "@/db/schema";
import { Breadcrumb, Header, VerificationBadge } from "@/components/chrome";
import { isProjectVerified } from "@/lib/verification";
import { latestJob } from "@/lib/jobs/runner";
import { CaseView, type VariantView } from "./case-view";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) notFound();

  // 資料をすべて人が確認したらバッジが「確認済」に変わる
  const verified = await isProjectVerified(projectId);
  const job = await latestJob(projectId);
  const generating = job?.status === "running";

  // 作りかけで止まっているパターンの理由を拾う
  const jobs = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.projectId, projectId));
  const buildErrorByVariant = new Map<string, string>();
  for (const j of jobs) {
    if (!j.variantId || j.status === "running") continue;
    const failed = j.steps.find((s) => s.status === "failed");
    if (failed?.error) buildErrorByVariant.set(j.variantId, failed.error);
  }

  const [variants, categories, materials] = await Promise.all([
    db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
    db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
    db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
  ]);

  const provesWhatById = new Map(materials.map((m) => [m.id, m.provesWhat]));
  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const views: VariantView[] = variants.map((v) => ({
    id: v.id,
    side: v.side,
    framework: v.framework,
    approach: v.approach,
    role: v.role,
    debateCase: v.debateCase,
    buildError: buildErrorByVariant.get(v.id),
    // 資料番号はこのパターン内でのみ有効。他のパターンの番号と混ぜない
    refTitles: Object.fromEntries(
      v.sourceRefs.map((r) => [r.number, provesWhatById.get(r.materialId) ?? ""]),
    ),
  }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "立論" },
          ]}
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">立論</h1>
          <VerificationBadge verified={verified} projectId={projectId} />
        </div>

        {variants.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            立論がまだ生成されていません。ダッシュボードから生成を開始してください。
          </p>
        ) : (
          <CaseView
            projectId={projectId}
            variants={views}
            categoryNames={categoryNames}
            generating={generating}
          />
        )}
      </main>
    </>
  );
}
