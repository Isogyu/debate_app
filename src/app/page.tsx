/**
 * ホーム（v6）
 *
 * 登録できるテーマは1つだけ。現テーマがあればその画面を出し、
 * なければテーマの登録を促す。前のテーマは「過去テーマ」から見られる。
 */

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Header } from "@/components/chrome";
import { requireSession } from "@/lib/session";
import { PastThemes, ThemeView } from "./projects/[projectId]/theme-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireSession();
  const [active] = await db.select().from(projects).where(eq(projects.status, "active"));
  if (active) return <ThemeView projectId={active.id} />;

  const archived = await db
    .select()
    .from(projects)
    .where(eq(projects.status, "archived"))
    .orderBy(desc(projects.archivedAt))
    .limit(20);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="mb-3 text-2xl font-bold">テーマを登録しましょう</h1>
        <p className="mb-6 text-[var(--muted)]">
          論題（テーマ）を1つ登録すると、賛成側・反対側の立論と資料、質疑と回答、
          質疑フローチャート、最終弁論の雛形、立論の戦い方を用意します。
          自分たちで作った立論と資料を登録して、質疑で鍛えることもできます。
        </p>
        <Link
          href="/projects/new"
          className="inline-block rounded bg-[var(--accent)] px-6 py-3 font-bold text-white"
        >
          テーマを登録する →
        </Link>
        <PastThemes themes={archived} />
      </main>
    </>
  );
}
