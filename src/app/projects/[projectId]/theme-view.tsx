/**
 * テーマ画面（v6 画面構成: テーマ／立論一覧）
 *
 * 現テーマは常に1つ。賛成側・反対側 × 登録・生成 の立論を一覧にし、
 * ここから生成（各側3本まで）と登録を始める。過去テーマは閲覧のみ。
 */

import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseVariants,
  crossExamNodes,
  generationJobs,
  projects,
  uploads,
} from "@/db/schema";
import { Header, OriginBadge, SideBadge } from "@/components/chrome";
import { JobStatus, type JobView } from "@/components/job-status";
import { estimateSpeech } from "@/domain/speech";
import {
  GEN_STEP_LABELS,
  MAX_GENERATED_PER_SIDE,
  SIDE_LABELS,
  type Side,
} from "@/domain/types";
import { progressOf } from "@/lib/jobs/runner";
import { GenerateButton } from "./generate-button";

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

  const [variants, jobs, questionRows, uploadRows, pastThemes] = await Promise.all([
    db.select().from(caseVariants).where(eq(caseVariants.projectId, projectId)).orderBy(caseVariants.createdAt),
    db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)),
    db.select({ variantId: crossExamNodes.targetVariantId }).from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
    db.select().from(uploads).where(eq(uploads.projectId, projectId)),
    db.select().from(projects).where(and(eq(projects.status, "archived"))).orderBy(desc(projects.archivedAt)).limit(200),
  ]);

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
              <Link href={`/projects/${projectId}/analysis`} className="rounded border border-[var(--line)] px-3 py-2 hover:border-[var(--accent)]">
                論題の分析を見る
              </Link>
            )}
            {!archived && (
              <>
                <Link href={`/projects/${projectId}/practice`} className="rounded border border-[var(--line)] px-3 py-2 hover:border-[var(--accent)]">
                  練習（タイマー・読み上げ）
                </Link>
                <Link href={`/projects/${projectId}/simulator`} className="rounded border border-[var(--line)] px-3 py-2 hover:border-[var(--accent)]">
                  質疑練習
                </Link>
              </>
            )}
            <Link href={`/projects/${projectId}/export`} className="rounded border border-[var(--line)] px-3 py-2 hover:border-[var(--accent)]">
              エクスポート・印刷
            </Link>
          </div>
        </div>

        {archived && (
          <p className="mb-6 rounded border border-[var(--line)] bg-[var(--line)]/20 p-3 text-sm">
            このテーマは過去テーマです。閲覧と印刷だけができます。資料は、各立論の「資料」タブから現テーマの立論へコピーできます。
          </p>
        )}

        {analysisJob && analysisJob.status !== "done" && (
          <div className="mb-6">
            <JobStatus initial={toJobView(analysisJob)} />
          </div>
        )}

        {awaitingReview && (
          <section className="mb-6 rounded border-2 border-[var(--accent)] p-4">
            <p className="mb-2 font-bold">論題の分析ができました</p>
            <p className="mb-3 text-sm">分析結果を確認・修正してから、立論の生成を始めます。</p>
            <Link href={`/projects/${projectId}/analysis`} className="inline-block rounded bg-[var(--accent)] px-5 py-3 font-bold text-white">
              分析結果を確認する →
            </Link>
          </section>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {(["affirmative", "negative"] as Side[]).map((side) => {
            const list = variants.filter((v) => v.side === side);
            const generated = list.filter((v) => v.origin === "generated").length;
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
                  <div className="flex flex-wrap gap-2">
                    <GenerateButton
                      projectId={projectId}
                      side={side}
                      remaining={MAX_GENERATED_PER_SIDE - generated}
                      disabled={!project.analysis || awaitingReview}
                      first={generated === 0}
                    />
                    <Link
                      href={`/projects/${projectId}/upload?side=${side}`}
                      className="inline-flex min-h-11 items-center rounded border border-[var(--line)] px-4 text-sm hover:border-[var(--accent)]"
                    >
                      自作の立論を登録
                    </Link>
                  </div>
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
                  変更すると、このテーマは「過去テーマ」として保管されます（閲覧・印刷と、資料のコピーができます）。
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
  themes: { id: string; resolution: string; archivedAt: string | null }[];
}) {
  if (themes.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 font-bold">過去テーマ</h2>
      <ul className="space-y-1 text-sm">
        {themes.map((t) => (
          <li key={t.id}>
            <Link href={`/projects/${t.id}`} className="underline underline-offset-2">
              {t.resolution}
            </Link>
            {t.archivedAt && (
              <span className="ml-2 text-xs text-[var(--muted)]">（{t.archivedAt.slice(0, 10)}まで）</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
