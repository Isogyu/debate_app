/**
 * ダッシュボード（DESIGN.md §4 DASH）
 *
 * 論題の成果物ハブ。生成中でもここに進捗が出続けるので、
 * ウィザードで生成を開始したあと画面を閉じても状況が分かる。
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
import { Breadcrumb, Header, SideBadge, VerificationBadge } from "@/components/chrome";
import { GEN_STEP_LABELS } from "@/domain/types";
import { latestJob, progressOf } from "@/lib/jobs/runner";
import { GenerationProgress } from "./progress";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
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

  const [variants, materials, blockRows, rebuttalRows, categories, cxRows, job] =
    await Promise.all([
      db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)),
      db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
      db.select().from(blocks).where(eq(blocks.projectId, projectId)),
      db.select().from(rebuttals).where(eq(rebuttals.projectId, projectId)),
      db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
      db.select().from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
      latestJob(projectId),
    ]);

  const found = materials.filter((m) => m.status !== "needed").length;
  const awaitingReview = job?.status === "awaiting_review";

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb items={[{ label: "ホーム", href: "/" }, { label: project.title }]} />

        <div className="mb-5">
          <h1 className="mb-2 text-xl font-bold">{project.resolution}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <SideBadge side={project.mySide} />
            <VerificationBadge verified={false} />
            {project.isCompetitionTopic && (
              <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted)]">
                本番論題（教材公開しない）
              </span>
            )}
          </div>
        </div>

        {/* 分析は済んだが生成前。次に何をすべきかを画面から消さない */}
        {awaitingReview && (
          <section className="mb-5 rounded border-2 border-[var(--accent)] p-4">
            <p className="mb-2 font-bold">分析の確認が終わっていません</p>
            <p className="mb-3 text-sm">
              AIの分析結果を確認・修正してから、立論の生成に進みます。
            </p>
            <Link
              href={`/projects/${projectId}/analysis`}
              className="inline-block rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
            >
              分析結果を確認する →
            </Link>
          </section>
        )}

        {job && (
          <div className="mb-6">
            <GenerationProgress
              jobId={job.id}
              initial={{
                status: job.status,
                progress: progressOf(job.steps),
                steps: job.steps.map((s) => ({
                  step: s.step,
                  label: GEN_STEP_LABELS[s.step],
                  status: s.status,
                  error: s.error,
                })),
              }}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card
            title="立論"
            href={`/projects/${projectId}/case`}
            lines={[
              `肯定側 ${variants.filter((v) => v.side === "affirmative").length}パターン`,
              `否定側 ${variants.filter((v) => v.side === "negative").length}パターン`,
            ]}
            ready={variants.length > 0}
          />
          <Card
            title="資料要件"
            href={`/projects/${projectId}/sources`}
            lines={[`${materials.length}件`, `発見済 ${found} / 未発見 ${materials.length - found}`]}
            ready={materials.length > 0}
          />
          <Card
            title="質疑フロー"
            href={`/projects/${projectId}/crossexam`}
            lines={[`${cxRows.length}ノード`, "練習モードあり"]}
            ready={cxRows.length > 0}
          />
          <Card
            title="反駁・比較"
            href={`/projects/${projectId}/rebuttal`}
            lines={[
              `反駁 ${rebuttalRows.length}件`,
              project.comparison ? "比較表あり" : "比較表なし",
            ]}
            ready={rebuttalRows.length > 0}
          />
          <Card
            title="ブロック集"
            href={`/projects/${projectId}/blocks`}
            lines={[`${blockRows.length}件`, `${categories.length}カテゴリ`]}
            ready={blockRows.length > 0}
          />
          <Card
            title="本番モード"
            href={`/live/${projectId}`}
            lines={["カテゴリから2タップで返しへ"]}
            ready={blockRows.length > 0}
          />
          <Card
            title="エクスポート"
            href={`/projects/${projectId}/export`}
            lines={["Word・PDF・本番パック"]}
            ready={variants.length > 0}
          />
        </div>
      </main>
    </>
  );
}

/** 未完成のカードは薄く見せる。押せるのに中身がない、を避ける（DESIGN §4） */
function Card({
  title,
  href,
  lines,
  ready,
}: {
  title: string;
  href: string;
  lines: string[];
  ready: boolean;
}) {
  const body = (
    <>
      <p className="font-bold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-sm text-[var(--muted)]">
          {l}
        </p>
      ))}
    </>
  );

  if (!ready) {
    return (
      <div className="rounded border border-dashed border-[var(--line)] p-4 opacity-50">
        {body}
        <p className="mt-1 text-xs text-[var(--muted)]">まだ生成されていません</p>
      </div>
    );
  }
  return (
    <Link href={href} className="rounded border border-[var(--line)] p-4 hover:border-[var(--accent)]">
      {body}
    </Link>
  );
}
