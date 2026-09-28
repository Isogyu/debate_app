/**
 * 立論を生成する（v7 で「論題の分析」から分離）
 *
 * 税法ゼミのディベートを前提に、各側の評価基準の枠組みから立論を作る。
 * 両側とも3本に達したら、生成はできない（タブの表示も変わる）。
 */

import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Breadcrumb } from "@/components/chrome";
import { Header } from "@/components/header";
import { requireSession } from "@/lib/session";
import { GENERATION_FULL_LABEL, generationQuota } from "@/lib/generation-quota";
import { GenerateForm } from "./generate-form";

export const dynamic = "force-dynamic";

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();
  const quota = await generationQuota(projectId);

  let body: React.ReactNode;
  if (project.status !== "active") {
    body = (
      <p className="rounded border border-[var(--line)] p-4 text-sm">
        過去テーマでは生成できません。生成するには、テーマの画面で現テーマに戻してください。
      </p>
    );
  } else if (!project.analysis) {
    body = (
      <p className="rounded border border-[var(--line)] p-4 text-sm">
        論題の分析が終わってから生成できます。
        <Link href={`/projects/${projectId}`} className="ml-1 text-[var(--accent)] underline">
          テーマの画面で進み具合を見る
        </Link>
      </p>
    );
  } else if (quota.full) {
    body = (
      <section className="rounded border-2 border-[var(--line)] p-5">
        <p className="mb-2 text-lg font-bold">{GENERATION_FULL_LABEL}</p>
        <p className="text-sm text-[var(--muted)]">
          賛成側・反対側とも、生成できる本数（各側3本）に達しました。これ以上は生成できません。
          自分たちで作った立論は、テーマの画面の「自作の立論・資料を登録する」から追加できます。
        </p>
      </section>
    );
  } else {
    body = (
      <>
        <p className="mb-5 text-sm text-[var(--muted)]">
          税法ゼミのディベートを前提に、各側の<b>評価基準の枠組み</b>（例: 租税公平主義、税の基本原則）から立論を作ります。
          必要なら枠組みを直してから生成してください。2本目・3本目は、すでにある立論と切り口を変えて作ります。
          論題そのものの整理は「論題の分析を見る」にあります。
        </p>
        <GenerateForm
          projectId={projectId}
          frameworks={project.analysis.frameworks}
          generated={quota.generated}
        />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "立論を生成する" },
          ]}
        />
        <h1 className="mb-2 text-2xl font-bold">立論を生成する</h1>
        <p className="mb-5 text-sm text-[var(--muted)]">論題: {project.resolution}</p>
        {body}
      </main>
    </>
  );
}
