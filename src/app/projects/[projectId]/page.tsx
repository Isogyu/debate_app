/**
 * テーマ画面（現テーマ・過去テーマとも）
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { ThemeView } from "./theme-view";

export const dynamic = "force-dynamic";

export default async function ThemePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();
  return <ThemeView projectId={projectId} />;
}
