/**
 * 練習（v6 要件 §9 画面構成「練習」）
 *
 * タイマー・読み上げ練習（ペースメーカー）・質疑シミュレーターへの入口を1か所にまとめる。
 * 試合前にこの画面だけ開けば練習が一通りできるようにするため。
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, projects } from "@/db/schema";
import { Breadcrumb } from "@/components/chrome";
import { Header } from "@/components/header";
import { requireSession } from "@/lib/session";
import { PracticeClient, type PracticeCase } from "./practice-client";

export const dynamic = "force-dynamic";

export default async function PracticePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  const rows = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId))
    .orderBy(caseVariants.side, caseVariants.origin, caseVariants.createdAt);
  // 本文の構造がない立論（取り込み途中など）は読み上げ練習に使えない
  const cases: PracticeCase[] = rows
    .filter((v) => v.debateCase.sections.length > 0)
    .map((v) => ({
      id: v.id,
      side: v.side,
      origin: v.origin,
      label: v.label,
      debateCase: v.debateCase,
    }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "練習" },
          ]}
        />
        <h1 className="mb-5 text-2xl font-bold">練習</h1>
        <PracticeClient projectId={projectId} cases={cases} />
      </main>
    </>
  );
}
