/**
 * 質疑シミュレーター（v6 要件 F11）
 *
 * 練習回数を増やすのが目的なので、過去の練習も一覧で振り返れるようにする。
 */

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, practiceSessions, projects } from "@/db/schema";
import { Breadcrumb } from "@/components/chrome";
import { Header } from "@/components/header";
import { CASE_ORIGIN_LABELS, SIDE_LABELS } from "@/domain/types";
import { requireSession } from "@/lib/session";
import { SimulatorClient, type VariantOption } from "./simulator-client";
import { formatJstDateTime } from "@/domain/jst";

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
  const userId = await requireSession();
  const { projectId } = await params;
  const { session: sessionId } = await searchParams;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  const variantRows = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId))
    .orderBy(caseVariants.side, caseVariants.origin, caseVariants.createdAt);
  // 本文の構造がない立論（取り込み途中など）はAIが立脚できないので選ばせない
  const variants: VariantOption[] = variantRows
    .filter((v) => v.debateCase.sections.length > 0)
    .map((v) => ({ id: v.id, side: v.side, origin: v.origin, label: v.label }));
  const variantName = new Map(
    variantRows.map((v) => [
      v.id,
      `${SIDE_LABELS[v.side]}・${CASE_ORIGIN_LABELS[v.origin]}「${v.label}」`,
    ]),
  );

  const sessions = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.projectId, projectId))
    .orderBy(desc(practiceSessions.createdAt))
    .limit(20);

  let current = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
  if (sessionId && !current) {
    // 21件目より古い練習も、URLで直接開けるようにする
    [current] = await db
      .select()
      .from(practiceSessions)
      .where(eq(practiceSessions.id, sessionId));
    if (current && current.projectId !== projectId) current = undefined;
  }

  const myFinished = sessions.filter((s) => s.userId === userId && s.finishedAt).length;

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
              最近のあなたの練習: {myFinished}回
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

        {project.status !== "active" && !current && (
          <p className="mb-4 rounded border border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            過去テーマのため、新しい練習は始められません（これまでの練習の記録は見られます）。
          </p>
        )}
        <SimulatorClient
          projectId={projectId}
          // 過去テーマでは練習を始められない（閲覧のみ）
          variants={project.status === "active" ? variants : []}
          initialSession={
            current
              ? {
                  id: current.id,
                  mode: current.mode,
                  userVariantId: current.userVariantId,
                  userCaseName: variantName.get(current.userVariantId) ?? "（不明）",
                  opponentCaseName: variantName.get(current.opponentVariantId) ?? "（不明）",
                  turns: current.turns,
                  feedback: current.feedback ?? undefined,
                  reflection: current.reflection ?? undefined,
                  finished: !!current.finishedAt,
                  mine: current.userId === userId,
                }
              : null
          }
        />

        {!current && sessions.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-bold">これまでの練習（最近20件）</h2>
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/projects/${projectId}/simulator?session=${s.id}`}
                    className="block rounded border border-[var(--line)] p-3 text-sm hover:border-[var(--accent)]"
                  >
                    <span className="font-bold">{MODE_LABELS[s.mode]}</span>
                    <span className="ml-2 text-[var(--muted)]">
                      {formatJstDateTime(s.createdAt)}／やり取り{" "}
                      {s.turns.filter((t) => t.speaker === "user").length} 回
                      {s.finishedAt ? "／講評あり" : "／途中"}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      自分: {variantName.get(s.userVariantId) ?? "（不明）"}　相手:{" "}
                      {variantName.get(s.opponentVariantId) ?? "（不明）"}
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
