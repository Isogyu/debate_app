/**
 * ホーム（DESIGN.md §1）
 *
 * 扱うお題は常に1つ。1つの論題に対して、いろいろな観点の立論を作っていく
 * のがこのアプリの使い方なので、お題が複数並ぶと迷う。
 * 前のお題は消さずに片付けて、「過去のお題」から見られるようにしている。
 */

import Link from "next/link";
import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants, generationJobs, projects } from "@/db/schema";
import { Header, SideBadge } from "@/components/chrome";
import { InstallGuide } from "@/components/install-guide";
import { progressOf } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [active] = await db
    .select()
    .from(projects)
    .where(ne(projects.status, "archived"))
    .orderBy(desc(projects.updatedAt))
    .limit(1);

  const archived = await db
    .select()
    .from(projects)
    .where(eq(projects.status, "archived"))
    .orderBy(desc(projects.updatedAt))
    .limit(20);

  const job = active
    ? (
        await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.projectId, active.id))
          .orderBy(desc(generationJobs.createdAt))
          .limit(1)
      )[0]
    : undefined;

  const variants = active
    ? await db
        .select()
        .from(caseVariants)
        .where(eq(caseVariants.projectId, active.id))
    : [];

  const progress = job ? progressOf(job.steps) : null;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <InstallGuide />

        {active ? (
          <>
            <h1 className="mb-1 text-sm text-[var(--muted)]">いまのお題</h1>
            <p className="mb-3 text-xl font-bold">{active.resolution}</p>

            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
              <SideBadge side={active.mySide} />
              {active.status === "ready" ? (
                <span className="text-[var(--muted)]">準備できています</span>
              ) : progress && progress.done < progress.total ? (
                <span className="text-[var(--muted)]">
                  生成中 {progress.done}/{progress.total}
                  {progress.failed > 0 && `（${progress.failed}件が失敗）`}
                </span>
              ) : (
                <span className="text-[var(--muted)]">準備中</span>
              )}
              <span className="text-[var(--muted)]">
                立論 {variants.length}パターン
              </span>
            </div>

            <div className="mb-3 flex flex-wrap gap-3">
              <Link
                href={`/projects/${active.id}`}
                className="rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white"
              >
                準備を続ける
              </Link>
              <Link
                href={`/live/${active.id}`}
                className="rounded border-2 border-[var(--accent)] px-6 py-4 text-lg font-bold text-[var(--accent)]"
              >
                本番モード
              </Link>
            </div>
            <p className="mb-8 text-sm text-[var(--muted)]">
              ※「本番モード」は試合中に開く画面です。読み取り専用で、編集はできません。
            </p>

            <Link
              href="/projects/new"
              className="text-sm text-[var(--accent)] underline underline-offset-2"
            >
              お題を変更する
            </Link>
            <p className="mt-1 text-sm text-[var(--muted)]">
              いまのお題の準備内容は残りますが、「過去のお題」に移ります。
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-4 text-2xl font-bold">お題を登録してください</h1>
            <p className="mb-5 text-[var(--muted)]">
              論題を入れると、両側の立論・資料要件・質疑・反駁が作られます。
            </p>
            <Link
              href="/projects/new"
              className="inline-block rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white"
            >
              ＋ お題を登録する
            </Link>
          </>
        )}

        {archived.length > 0 && (
          <details className="mt-10 border-t border-[var(--line)] pt-5">
            <summary className="cursor-pointer text-sm font-bold">
              過去のお題（{archived.length}件）
            </summary>
            <ul className="mt-3 space-y-2">
              {archived.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="block rounded border border-[var(--line)] p-3 text-sm hover:border-[var(--accent)]"
                  >
                    {p.title}
                    <span className="ml-2 text-[var(--muted)]">
                      {p.updatedAt.slice(0, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--muted)]">
              過去のお題も開けます。練習の振り返りに使えます。
            </p>
          </details>
        )}
      </main>
    </>
  );
}
