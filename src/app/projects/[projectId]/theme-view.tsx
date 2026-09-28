/**
 * テーマ画面（v6 画面構成: テーマ／立論一覧。v7 で生成を「立論を生成する」へ分離）
 *
 * 現テーマは常に1つ。賛成側・反対側 × 登録・生成 の立論を一覧にする。
 * 生成は「立論を生成する」から（各側3本まで。両側とも3本になったらタブの表示が変わる）。
 * 過去テーマは閲覧のみ。削除しない限りずっと残り、現テーマに戻すこともできる（v7）。
 */

import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseVariants,
  crossExamNodes,
  generationJobs,
  practiceSessions,
  projects,
  sourceMaterials,
  uploads,
} from "@/db/schema";
import { OriginBadge, SideBadge } from "@/components/chrome";
import { Header } from "@/components/header";
import { JobStatus, type JobView } from "@/components/job-status";
import { estimateSpeech } from "@/domain/speech";
import {
  GEN_STEP_LABELS,
  MAX_GENERATED_PER_SIDE,
  SIDE_LABELS,
  type Side,
} from "@/domain/types";
import { progressOf } from "@/lib/jobs/runner";
import { GENERATION_FULL_LABEL } from "@/lib/generation-quota";
import { DeleteThemeButton, RestoreThemeButton } from "@/components/theme-controls";

export function toJobView(job: typeof generationJobs.$inferSelect): JobView {
  return {
    id: job.id,
    status: job.status,
    progress: progressOf(job.steps),
    steps: job.steps.map((s) => ({
      step: s.step,
      label: GEN_STEP_LABELS[s.step],
      status: s.status,
      error: s.error,
    })),
  };
}

export async function ThemeView({ projectId }: { projectId: string }) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const archived = project.status === "archived";

  const [variants, jobs, questionRows, uploadRows, pastThemes, materialRows, sessionRows, activeRows] = await Promise.all([
    db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)).orderBy(caseVariants.createdAt),
    db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)),
    db.select({ variantId: crossExamNodes.targetVariantId }).from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
    db.select().from(uploads).where(eq(uploads.projectId, projectId)),
    // 過去テーマは削除しない限りずっと残す（v7）。件数で打ち切らない
    db.select().from(projects).where(and(eq(projects.status, "archived"))).orderBy(desc(projects.archivedAt)),
    db.select({ id: sourceMaterials.id }).from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
    db.select({ id: practiceSessions.id }).from(practiceSessions).where(eq(practiceSessions.projectId, projectId)),
    db.select().from(projects).where(eq(projects.status, "active")),
  ]);
  const currentTheme = activeRows[0] ?? null;
  const currentBusy =
    archived && currentTheme
      ? (await db.select({ status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.projectId, currentTheme.id)))
          .some((j) => j.status === "running" || j.status === "queued")
      : false;

  const latestByVariant = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (j.variantId && !latestByVariant.has(j.variantId)) latestByVariant.set(j.variantId, j);
  }
  const analysisJob = jobs.find((j) => j.kind === "analysis");
  const busy = jobs.some((j) => j.status === "running" || j.status === "queued");
  const questionCount = new Map<string, number>();
  for (const q of questionRows) questionCount.set(q.variantId, (questionCount.get(q.variantId) ?? 0) + 1);
  const issueCount = new Map(uploadRows.map((u) => [u.variantId ?? "", u.issues.filter((i) => i.severity === "error").length]));

  const awaitingReview =
    !archived &&
    project.reviewAnalysis &&
    !!project.analysis &&
    !variants.some((v) => v.origin === "generated");
  const generatedCount = (side: Side) =>
    variants.filter((v) => v.side === side && v.origin === "generated").length;
  const generationFull = (["affirmative", "negative"] as Side[]).every(
    (side) => generatedCount(side) >= MAX_GENERATED_PER_SIDE,
  );
  const tabClass = "rounded border border-[var(--line)] px-3 py-2 hover:border-[var(--accent)]";

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-6">
          <p className="mb-1 text-sm text-[var(--muted)]">
            {archived ? "過去テーマ（閲覧のみ）" : "現テーマ"}
          </p>
          <h1 className="mb-3 text-xl font-bold leading-relaxed">{project.resolution}</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            {project.analysis && (
              <Link href={`/projects/${projectId}/analysis`} className={tabClass}>
                論題の分析を見る
              </Link>
            )}
            {!archived &&
              (generationFull ? (
                // 両側とも上限に達したら押せない表示にする（v7）
                <span
                  aria-disabled="true"
                  className="cursor-not-allowed rounded border border-dashed border-[var(--line)] px-3 py-2 text-[var(--muted)]"
                >
                  {GENERATION_FULL_LABEL}
                </span>
              ) : project.analysis ? (
                <Link href={`/projects/${projectId}/generate`} className={tabClass}>
                  立論を生成する
                </Link>
              ) : null)}
            {!archived && (
              <>
                <Link href={`/projects/${projectId}/practice`} className={tabClass}>
                  練習（タイマー・読み上げ）
                </Link>
                <Link href={`/projects/${projectId}/simulator`} className={tabClass}>
                  質疑練習
                </Link>
              </>
            )}
            <Link href={`/projects/${projectId}/export`} className={tabClass}>
              エクスポート・印刷
            </Link>
          </div>
        </div>

        {archived && (
          <section className="mb-6 rounded border border-[var(--line)] bg-[var(--line)]/20 p-4 text-sm">
            <p className="mb-3">
              このテーマは過去テーマです。閲覧と印刷ができます。資料は、各立論の「資料」タブから現テーマの立論へコピーできます。
              過去テーマは、削除しない限りずっと残ります。
            </p>
            <div className="flex flex-wrap gap-2">
              <RestoreThemeButton
                projectId={projectId}
                currentResolution={currentTheme?.resolution ?? null}
                disabledReason={
                  currentBusy ? "いまの現テーマで生成中のため、切り替えられません。生成が終わってから切り替えてください。" : undefined
                }
              />
              <DeleteThemeButton
                projectId={projectId}
                resolution={project.resolution}
                counts={{
                  cases: variants.length,
                  materials: materialRows.length,
                  questions: questionRows.length,
                  sessions: sessionRows.length,
                }}
              />
            </div>
            {currentBusy && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                いまの現テーマで生成中のため、現テーマへの切り替えは生成が終わってからできます。
              </p>
            )}
          </section>
        )}

        {analysisJob && analysisJob.status !== "done" && (
          <div className="mb-6">
            <JobStatus initial={toJobView(analysisJob)} />
          </div>
        )}

        {awaitingReview && (
          <section className="mb-6 rounded border-2 border-[var(--accent)] p-4">
            <p className="mb-2 font-bold">論題の分析ができました</p>
            <p className="mb-3 text-sm">
              分析を確認・修正したら、「立論を生成する」で評価基準の枠組みを確かめて生成を始めてください。
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/projects/${projectId}/analysis`} className="inline-block rounded border-2 border-[var(--accent)] px-5 py-3 font-bold text-[var(--accent)]">
                論題の分析を見る
              </Link>
              <Link href={`/projects/${projectId}/generate`} className="inline-block rounded bg-[var(--accent)] px-5 py-3 font-bold text-white">
                立論を生成する →
              </Link>
            </div>
          </section>
        )}

        {!archived && (
          <div className="mb-4">
            <Link
              href={`/projects/${projectId}/upload`}
              className="inline-flex min-h-12 items-center rounded border-2 border-[var(--accent)] px-5 font-bold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
            >
              自作の立論・資料を登録する
            </Link>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {(["affirmative", "negative"] as Side[]).map((side) => {
            const list = variants.filter((v) => v.side === side);
            const generated = generatedCount(side);
            return (
              <section key={side} className="rounded border border-[var(--line)] p-4">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                  <SideBadge side={side} /> {SIDE_LABELS[side]}の立論
                </h2>
                {list.length === 0 ? (
                  <p className="mb-3 text-sm text-[var(--muted)]">まだ立論がありません。</p>
                ) : (
                  <ul className="mb-4 space-y-2">
                    {list.map((v) => {
                      const job = latestByVariant.get(v.id);
                      const building = v.debateCase.sections.length === 0;
                      const est = building ? null : estimateSpeech(v.debateCase.fullText);
                      return (
                        <li key={v.id}>
                          <Link
                            href={`/projects/${projectId}/cases/${v.id}`}
                            className="block rounded border border-[var(--line)] p-3 hover:border-[var(--accent)]"
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <OriginBadge origin={v.origin} />
                              <b className="text-sm">{v.label}</b>
                            </div>
                            <div className="flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
                              {est && (
                                <span className={est.verdict === "ok" ? "" : "text-[var(--neg)]"}>
                                  読み上げ {est.label}
                                </span>
                              )}
                              {!building && <span>質疑 {questionCount.get(v.id) ?? 0}問</span>}
                              {(issueCount.get(v.id) ?? 0) > 0 && (
                                <span className="text-[var(--neg)]">取り込みの指摘あり</span>
                              )}
                              {job && (job.status === "running" || job.status === "queued" || job.status === "partial" || job.status === "failed") && (
                                <JobStatus initial={toJobView(job)} compact />
                              )}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!archived && (
                  <p className="text-xs text-[var(--muted)]">
                    生成した立論 {generated}本 / {MAX_GENERATED_PER_SIDE}本
                  </p>
                )}
              </section>
            );
          })}
        </div>

        {!archived && (
          <section className="mt-8 rounded border border-[var(--line)] p-4">
            <h2 className="mb-2 font-bold">テーマの変更</h2>
            {busy ? (
              <p className="text-sm text-[var(--muted)]">
                生成中のため、いまはテーマを変更できません。生成が終わってから変更してください。
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-[var(--muted)]">
                  変更すると、このテーマは「過去テーマ」として保管されます。削除しない限りずっと残り、閲覧・印刷・資料のコピーができ、あとで現テーマに戻すこともできます。
                </p>
                <Link href="/projects/new" className="inline-flex min-h-11 items-center rounded border border-[var(--line)] px-4 text-sm hover:border-[var(--accent)]">
                  テーマを変更する
                </Link>
              </>
            )}
          </section>
        )}

        <PastThemes themes={pastThemes.filter((t) => t.id !== projectId)} />
      </main>
    </>
  );
}

export function PastThemes({
  themes,
}: {
  themes: { id: string; resolution: string }[];
}) {
  if (themes.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-1 font-bold">過去テーマ</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">
        削除しない限りずっと残ります。開くと、現テーマに戻す・削除するができます。
      </p>
      <ul className="space-y-1 text-sm">
        {themes.map((t) => (
          <li key={t.id}>
            <Link href={`/projects/${t.id}`} className="underline underline-offset-2">
              {t.resolution}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
