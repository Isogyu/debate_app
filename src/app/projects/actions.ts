"use server";

/**
 * テーマの登録・論題の分析・立論の生成開始（v6 要件 F1 / §3.3、v7 で分析と生成を分離）
 *
 * v7:
 *  - 「論題の分析」は一般的な分析とメモだけを扱う（評価基準の枠組みは扱わない）
 *  - 評価基準の枠組みは「立論を生成する」画面で確認・修正し、そこから生成を始める
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import { db, DB_DIR } from "@/db";
import { issueCategories, projects } from "@/db/schema";
import type { LawRef, ResolutionAnalysis, Side } from "@/domain/types";
import { newId, nowIso } from "@/lib/ids";
import {
  approveAnalysis,
  createTheme,
  deleteArchivedTheme,
  restoreTheme,
  retryAnalysisJob,
  RuleError,
  startGeneration as startCaseGeneration,
} from "@/lib/jobs/orchestrate";
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

/** 論題の分析（一般的な分析とメモ）の修正を保存する */
export async function saveAnalysis(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project?.analysis) return { error: "分析結果が見つかりませんでした。" };
  if (project.status !== "active") return { error: "過去テーマは変更できません。現テーマに戻すと編集できます。" };

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
    stakeholders: splitList(String(formData.get("stakeholders") ?? "")),
    coreIssues: splitLines(String(formData.get("coreIssues") ?? "")),
  };
  const memo = String(formData.get("memo") ?? "").slice(0, 20000);

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
  await db
    .update(projects)
    .set({ analysis, analysisMemo: memo, updatedAt: nowIso() })
    .where(eq(projects.id, projectId));
  await log(userId, "edit", projectId, projectId, "論題の分析・メモを修正");
  revalidatePath(`/projects/${projectId}/analysis`);
  return { ok: true };
}

/** 争点は1行に1つ。文中に読点を含むので、読点では区切らない */
function splitLines(value: string): string[] {
  return value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 「立論を生成する」画面から生成を始める。
 * 評価基準の枠組みの修正を保存してから、
 *  - side=both … まだ生成した立論がない側に1本ずつ（最初の生成）
 *  - side=affirmative / negative … その側にもう1本（各側3本まで）
 */
export async function generateFromSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const target = String(formData.get("side") ?? "");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "テーマが見つかりませんでした。" };
  if (project.status !== "active") return { error: "過去テーマでは生成できません。現テーマに戻してから生成してください。" };
  if (!project.analysis) return { error: "論題の分析が終わってから生成できます。" };

  const frameworks: ResolutionAnalysis["frameworks"] = {
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
  };
  for (const [key, label] of [["affirmative", "賛成側"], ["negative", "反対側"]] as const) {
    if (!frameworks[key].name) return { error: `${label}の評価基準の枠組み名を入力してください。` };
    if (frameworks[key].criteria.length === 0) return { error: `${label}の評価基準を1つ以上入力してください。` };
  }
  await db
    .update(projects)
    .set({ analysis: { ...project.analysis, frameworks }, updatedAt: nowIso() })
    .where(eq(projects.id, projectId));

  try {
    if (target === "both") {
      await approveAnalysis(projectId, userId);
      await log(userId, "generate", projectId, projectId, "立論の生成を開始（各側1本）");
    } else if (target === "affirmative" || target === "negative") {
      const variantId = await startCaseGeneration(projectId, target as Side, userId);
      await log(userId, "generate", variantId, projectId, "立論を生成");
    } else {
      await log(userId, "edit", projectId, projectId, "評価基準の枠組みを修正");
    }
  } catch (err) {
    if (err instanceof RuleError || err instanceof JobBusyError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/generate`);
  revalidatePath("/");
  if (target === "both" || target === "affirmative" || target === "negative") redirect(`/projects/${projectId}`);
  return { ok: true };
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

/** 過去テーマを現テーマに戻す（v7）。いまの現テーマは過去テーマになる */
export async function restoreThemeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  try {
    const { previous } = restoreTheme(projectId);
    await log(userId, "edit", projectId, projectId, "過去テーマを現テーマに戻した");
    if (previous) await log(userId, "edit", previous, previous, "現テーマを過去テーマに回した（入れ替え）");
  } catch (err) {
    if (err instanceof RuleError) return { error: err.message };
    throw err;
  }
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

/**
 * 過去テーマを削除する（v7）。確認の入力がなければ消さない。
 * 立論・資料・質疑・練習の記録と、登録したファイルもまとめて消える。元に戻せない。
 */
export async function deleteThemeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  if (formData.get("understood") !== "on") {
    return { error: "削除すると元に戻せないことを確認して、チェックを入れてください。" };
  }
  try {
    const { resolution } = deleteArchivedTheme(projectId);
    // 登録した Word ファイルも消す（消せなくても削除自体は終わっている）
    await fs.rm(path.join(DB_DIR, "uploads", projectId), { recursive: true, force: true }).catch(() => {});
    await log(userId, "edit", projectId, projectId, `過去テーマを削除: ${resolution.slice(0, 60)}`);
  } catch (err) {
    if (err instanceof RuleError) return { error: err.message };
    throw err;
  }
  revalidatePath("/");
  redirect("/");
}
