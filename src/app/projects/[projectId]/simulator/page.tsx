/**
 * 質疑シミュレーター（DESIGN.md §11 SIM）
 *
 * 練習回数を増やすのが目的なので、過去の練習も一覧で振り返れるようにする。
 */

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { practiceSessions, projects } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { currentUserId } from "@/lib/session";
import { SimulatorClient } from "./simulator-client";

export const dynamic = "force-dynamic";

const MODE_LABELS = {
  attack: "相手に質問する",
  defense: "相手から質問される",
} as const;

export default async function SimulatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { projectId } = await params;
  const { session: sessionId } = await searchParams;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) notFound();

  const userId = await currentUserId();
  const sessions = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.projectId, projectId))
    .orderBy(desc(practiceSessions.createdAt))
    .limit(20);

  const current = sessionId
    ? sessions.find((s) => s.id === sessionId)
    : undefined;

  const myFinished = sessions.filter(
    (s) => s.userId === userId && s.finishedAt,
  ).length;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "質疑練習" },
          ]}
        />
        <div className="mb-5 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">質疑練習</h1>
          {myFinished > 0 && (
            <span className="text-sm text-[var(--muted)]">
              あなたの練習回数: {myFinished}回
            </span>
          )}
          {current && (
            <Link
              href={`/projects/${projectId}/simulator`}
              className="ml-auto text-sm text-[var(--accent)] hover:underline"
            >
              新しく始める
            </Link>
          )}
        </div>

        <SimulatorClient
          projectId={projectId}
          initialSession={
            current
              ? {
                  id: current.id,
                  mode: current.mode,
                  turns: current.turns,
                  feedback: current.feedback ?? undefined,
                  finished: !!current.finishedAt,
                }
              : null
          }
        />

        {!current && sessions.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-bold">これまでの練習</h2>
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/projects/${projectId}/simulator?session=${s.id}`}
                    className="block rounded border border-[var(--line)] p-3 text-sm hover:border-[var(--accent)]"
                  >
                    <span className="font-bold">{MODE_LABELS[s.mode]}</span>
                    <span className="ml-2 text-[var(--muted)]">
                      {s.createdAt.slice(0, 16).replace("T", " ")}／
                      やり取り {s.turns.filter((t) => t.speaker === "user").length} 回
                      {s.finishedAt ? "／講評あり" : "／途中"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
