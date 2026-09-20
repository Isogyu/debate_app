/**
 * プロジェクト一覧（DESIGN.md §1 HOME）
 *
 * 会場で開いたときに即使えるよう、本番モードを新規作成と同格に置く。
 */

import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { generationJobs, projects } from "@/db/schema";
import { Header, SideBadge } from "@/components/chrome";
import { progressOf } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt))
    .limit(50);

  const jobs = await db.select().from(generationJobs);
  const jobByProject = new Map(jobs.map((j) => [j.projectId, j]));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">プロジェクト一覧</h1>

        <div className="mb-2 flex flex-wrap gap-3">
          <Link
            href="/projects/new"
            className="rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white"
          >
            ＋ 新しい論題で準備を始める
          </Link>
          <Link
            href="/live"
            className="rounded border-2 border-[var(--accent)] px-6 py-4 text-lg font-bold text-[var(--accent)]"
          >
            本番モード
          </Link>
        </div>
        <p className="mb-8 text-sm text-[var(--muted)]">
          ※「本番モード」は試合会場で直接開く画面です。読み取り専用で、編集はできません。
        </p>

        <h2 className="mb-3 text-lg font-bold">あなたのプロジェクト</h2>
        {rows.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            まだプロジェクトがありません。「＋ 新しい論題で準備を始める」から作成してください。
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {rows.map((p) => {
              const job = jobByProject.get(p.id);
              const progress = job ? progressOf(job.steps) : null;
              return (
                <li
                  key={p.id}
                  className="rounded border border-[var(--line)] p-4"
                >
                  <Link href={`/projects/${p.id}`} className="font-bold hover:underline">
                    {p.title}
                  </Link>
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <SideBadge side={p.mySide} />
                    {p.status === "ready" ? (
                      <span className="text-[var(--muted)]">完成</span>
                    ) : progress ? (
                      <span className="text-[var(--muted)]">
                        生成中 {progress.done}/{progress.total}
                        {progress.failed > 0 && `（${progress.failed}件が失敗）`}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">準備中</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    更新: {p.updatedAt.slice(0, 10)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
