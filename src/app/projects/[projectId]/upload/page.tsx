/**
 * 自作の立論＋資料の登録（v6 要件 F2 / §3.2）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, projects } from "@/db/schema";
import { CASE_ORIGIN_LABELS, SIDE_LABELS } from "@/domain/types";
import { Breadcrumb } from "@/components/chrome";
import { Header } from "@/components/header";
import { requireSession } from "@/lib/session";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ side?: string; category?: string; variant?: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const { side, category, variant } = await searchParams;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();
  // 資料を付けられる立論（本文ができているもの）
  const cases = (
    await db
      .select()
      .from(caseVariants)
      .where(eq(caseVariants.projectId, projectId))
      .orderBy(caseVariants.side, caseVariants.createdAt)
  )
    .filter((v) => v.debateCase.sections.length > 0)
    .map((v) => ({
      id: v.id,
      label: `${SIDE_LABELS[v.side]}・${CASE_ORIGIN_LABELS[v.origin]}｜${v.label}`,
      refCount: v.sourceRefs.length,
    }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "自作の立論・資料を登録" },
          ]}
        />
        <h1 className="mb-2 text-2xl font-bold">自作の立論・資料を登録する</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          「立論」は立論（と資料）をまとめて登録し、質疑と回答・フローチャート・最終弁論の雛形・特徴と戦い方を作ります。
          「資料」は、登録済み・生成済みの立論に自作の資料を付けます。どちらも本文はAIで書き換えません。
        </p>
        {project.status !== "active" ? (
          <p className="rounded border border-[var(--line)] p-4">過去テーマには登録できません。</p>
        ) : (
          <UploadForm
            projectId={projectId}
            defaultSide={side === "negative" ? "negative" : "affirmative"}
            defaultCategory={category === "materials" ? "materials" : "case"}
            defaultVariantId={variant}
            cases={cases}
          />
        )}
      </main>
    </>
  );
}
