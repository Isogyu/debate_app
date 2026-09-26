"use server";

/**
 * テーマの登録・分析の確認（v6 要件 F1 / §3.3）
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { issueCategories, projects } from "@/db/schema";
import type { LawRef, ResolutionAnalysis } from "@/domain/types";
import { newId, nowIso } from "@/lib/ids";
import { approveAnalysis, createTheme, retryAnalysisJob, RuleError } from "@/lib/jobs/orchestrate";
import { log, requireSession } from "@/lib/session";
import { JobBusyError } from "@/lib/jobs/runner";

export interface FormState {
  error?: string;
  ok?: boolean;
}

export async function createThemeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const resolution = String(formData.get("resolution") ?? "").trim();
  const reviewAnalysis = formData.get("reviewAnalysis") === "on";
  if (resolution.length < 5) return { error: "論題を入力してください（5文字以上）。" };

  let projectId: string;
  try {
    projectId = await createTheme({ resolution, reviewAnalysis, userId });
  } catch (err) {
    if (err instanceof RuleError) return { error: err.message };
    throw err;
  }
  await log(userId, "generate", projectId, projectId, "テーマを登録（論題分析を開始）");
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

function splitList(value: string): string[] {
  return value.split(/[\n,、，]+/).map((s) => s.trim()).filter(Boolean);
}

/** 分析確認画面での修正を保存する */
export async function saveAnalysis(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project?.analysis) return { error: "分析結果が見つかりませんでした。" };
  if (project.status !== "active") return { error: "過去テーマは変更できません。" };

  const lawNames = formData.getAll("lawName").map(String);
  const lawArticles = formData.getAll("lawArticle").map(String);
  const relatedLaws: LawRef[] = lawNames
    .map((name, i) => ({
      id: newId("law"),
      name: name.trim(),
      article: (lawArticles[i] ?? "").trim(),
      verified: false,
    }))
    .filter((l) => l.name);

  const analysis: ResolutionAnalysis = {
    ...project.analysis,
    policyChange: String(formData.get("policyChange") ?? "").trim(),
    statusQuo: String(formData.get("statusQuo") ?? "").trim(),
    relatedLaws,
    frameworks: {
      affirmative: {
        name: String(formData.get("affFramework") ?? "").trim(),
        basisLaw: String(formData.get("affBasisLaw") ?? "").trim() || undefined,
        criteria: splitList(String(formData.get("affCriteria") ?? "")),
      },
      negative: {
        name: String(formData.get("negFramework") ?? "").trim(),
        basisLaw: String(formData.get("negBasisLaw") ?? "").trim() || undefined,
        criteria: splitList(String(formData.get("negCriteria") ?? "")),
      },
    },
  };

  // 同じ名前が2回あると一意制約で保存に失敗するので、先にまとめる
  const categoryNames = [...new Set(splitList(String(formData.get("categories") ?? "")))];
  if (categoryNames.length === 0) {
    return { error: "争点カテゴリを1つ以上入力してください。質疑の整理に使います。" };
  }
  const existing = await db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId));
  const idByName = new Map(existing.map((c) => [c.name, c.id]));
  await db.delete(issueCategories).where(eq(issueCategories.projectId, projectId));
  await db.insert(issueCategories).values(
    categoryNames.map((name, i) => ({
      id: idByName.get(name) ?? newId("cat"),
      projectId,
      name,
      description: existing.find((c) => c.name === name)?.description ?? "",
      sortOrder: i,
    })),
  );
  await db.update(projects).set({ analysis, updatedAt: nowIso() }).where(eq(projects.id, projectId));
  await log(userId, "edit", projectId, projectId, "分析結果を修正");
  revalidatePath(`/projects/${projectId}/analysis`);
  return { ok: true };
}

/** 分析を確認して生成を始める（確認関門を選んだ場合） */
export async function startGeneration(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const saved = await saveAnalysis(_prev, formData);
  if (saved.error) return saved;
  try {
    await approveAnalysis(projectId, userId);
  } catch (err) {
    if (err instanceof RuleError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

/** 分析をやり直す */
export async function retryAnalysis(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  try {
    await retryAnalysisJob(projectId, userId);
  } catch (err) {
    if (err instanceof RuleError || err instanceof JobBusyError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}/analysis`);
  revalidatePath(`/projects/${projectId}`);
  return {};
}
