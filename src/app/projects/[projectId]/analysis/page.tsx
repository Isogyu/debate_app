/**
 * 分析確認画面（DESIGN.md §3 ANAL）
 *
 * 分析が失敗している場合は、この画面でやり直せるようにする。
 * 失敗を黙って隠すと、空の分析のまま生成に進んでしまう。
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { issueCategories, projects } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { latestAnalysisJob } from "@/lib/jobs/runner";
import { AnalysisForm } from "./analysis-form";
import { RetryAnalysis } from "./retry-analysis";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
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

  const categories = await db
    .select()
    .from(issueCategories)
    .where(eq(issueCategories.projectId, projectId));

  const job = await latestAnalysisJob(projectId);
  const analysisStep = job?.steps.find((s) => s.step === "analysis");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "分析確認" },
          ]}
        />
        <div className="mb-2 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">分析結果の確認</h1>
          <p className="text-sm text-[var(--muted)]">
            論題の分析（確認してから生成）
          </p>
        </div>
        <p className="mb-6 text-sm text-[var(--muted)]">論題: {project.resolution}</p>

        {project.analysis ? (
          <AnalysisForm
            data={{
              projectId,
              resolution: project.resolution,
              policyChange: project.analysis.policyChange,
              statusQuo: project.analysis.statusQuo,
              relatedLaws: project.analysis.relatedLaws.map((l) => ({
                name: l.name,
                article: l.article,
              })),
              categories: categories
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((c) => c.name),
              frameworks: project.analysis.frameworks,
            }}
          />
        ) : (
          <div className="rounded border-2 border-[var(--neg)] p-5">
            <p className="mb-2 font-bold">分析ができていません</p>
            <p className="mb-4 text-sm">
              {analysisStep?.error ??
                "論題の分析がまだ終わっていないか、途中で失敗しました。"}
            </p>
            <RetryAnalysis projectId={projectId} />
          </div>
        )}
      </main>
    </>
  );
}
