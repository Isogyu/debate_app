/**
 * 質疑フロー画面（DESIGN.md §7 CX）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { crossExamNodes, issueCategories, projects } from "@/db/schema";
import { Breadcrumb, Header, VerificationBadge } from "@/components/chrome";
import { isProjectVerified } from "@/lib/verification";
import { CrossExamView, type CxNode } from "./crossexam-view";

export const dynamic = "force-dynamic";

export default async function CrossExamPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  // 資料をすべて人が確認したらバッジが「確認済」に変わる
  const verified = await isProjectVerified(projectId);

  const [rows, categories] = await Promise.all([
    db.select().from(crossExamNodes).where(eq(crossExamNodes.projectId, projectId)),
    db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
  ]);

  const nodes: CxNode[] = rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    question: r.question,
    purpose: r.purpose,
    categoryIds: r.categoryIds,
    branches: r.branches,
  }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "質疑フロー" },
          ]}
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">質疑フロー</h1>
          <VerificationBadge verified={verified} projectId={projectId} />
        </div>

        {nodes.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            質疑がまだ生成されていません。
          </p>
        ) : (
          <CrossExamView
            nodes={nodes}
            categoryNames={Object.fromEntries(categories.map((c) => [c.id, c.name]))}
          />
        )}
      </main>
    </>
  );
}
