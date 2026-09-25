/**
 * 自作の立論＋資料の登録（v6 要件 F2 / §3.2）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { requireSession } from "@/lib/session";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const { side } = await searchParams;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "自作の立論を登録" },
          ]}
        />
        <h1 className="mb-2 text-2xl font-bold">自作の立論と資料を登録する</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          登録した立論にも、質疑と回答・フローチャート・最終弁論の雛形・特徴と戦い方を作ります。
          立論の本文はAIで書き換えません。
        </p>
        {project.status !== "active" ? (
          <p className="rounded border border-[var(--line)] p-4">過去テーマには登録できません。</p>
        ) : (
          <UploadForm
            projectId={projectId}
            defaultSide={side === "negative" ? "negative" : "affirmative"}
          />
        )}
      </main>
    </>
  );
}
