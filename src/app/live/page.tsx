/**
 * 本番モードの入口（DESIGN.md §1・§10）
 *
 * ホーム画面の「本番モード」から来る。論題が1つならそのまま開き、
 * 複数あれば選ばせる。会場で開いて404を見る、という事態を避けるための画面。
 */

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { blocks, projects } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "本番モード | ディベート支援" };

export default async function LiveIndexPage() {
  const rows = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt))
    .limit(20);

  // 1つしかないなら選ばせる意味がない。会場でのタップを1回減らす
  if (rows.length === 1) redirect(`/live/${rows[0].id}`);

  const counts = await Promise.all(
    rows.map(async (p) => ({
      project: p,
      blocks: (await db.select().from(blocks).where(eq(blocks.projectId, p.id)))
        .length,
    })),
  );

  return (
    <main className="live-mode mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">本番モード</h1>
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          準備画面へ戻る
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
          まだ論題がありません。準備画面から作成してください。
        </p>
      ) : (
        <>
          <p className="mb-3">どの論題で戦いますか？</p>
          <ul className="space-y-3">
            {counts.map(({ project, blocks: n }) => (
              <li key={project.id}>
                <Link
                  href={`/live/${project.id}`}
                  className="block rounded border-2 border-[var(--accent)] p-5 text-lg font-bold text-[var(--accent)]"
                >
                  {project.title}
                  <span className="mt-1 block text-sm font-normal text-[var(--muted)]">
                    ブロック {n}件
                    {n === 0 && "（まだ準備できていません）"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
