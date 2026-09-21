"use server";

/**
 * 論題入力ウィザードと分析確認画面のサーバー処理
 * （DESIGN.md §2 WIZ / §3 ANAL）
 *
 * 設計上の要点:
 *  - 分析は「作成直後に自動で走らせる」。ウィザードの送信＝分析の開始。
 *  - 残り7ステップは人が分析確認画面で承認するまで走らせない（品質ゲート）。
 */

import { eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { issueCategories, projects, teams } from "@/db/schema";
import type { LawRef, ResolutionAnalysis, Side } from "@/domain/types";
import { randomUUID } from "node:crypto";
import { hashPasscode } from "@/lib/auth";
import { newId, nowIso } from "@/lib/ids";
import { createJob, latestJob, retryStep, runJob } from "@/lib/jobs/runner";
import {
  currentUserId,
  currentUserName,
  log,
  requireSession,
} from "@/lib/session";

export interface FormState {
  error?: string;
}

/** ウィザードの送信。プロジェクトを作り、論題分析だけを走らせる */
export async function createProject(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const resolution = String(formData.get("resolution") ?? "").trim();
  const side = String(formData.get("side") ?? "") as Side;
  const teamName = String(formData.get("teamName") ?? "").trim();
  const membersRaw = String(formData.get("members") ?? "").trim();
  const isCompetitionTopic = formData.get("isCompetitionTopic") === "on";

  // 入力検証。非情報系のユーザー向けに、何を直せばよいかが分かる文言にする
  if (resolution.length < 5) {
    return { error: "論題を入力してください（5文字以上）。" };
  }
  if (side !== "affirmative" && side !== "negative") {
    return { error: "あなたの立場（肯定側／否定側）を選んでください。" };
  }
  // ログイン済みの利用者。アクセス制御はアプリ共通の合言葉が担う（§6.2）
  const userId = await requireSession();
  const authorName = (await currentUserName()) ?? "unknown";

  // 扱うお題は常に1つ。前のお題は消さずに片付ける（練習の振り返りに使える）
  const previous = await db
    .select()
    .from(projects)
    .where(ne(projects.status, "archived"));
  for (const old of previous) {
    await db
      .update(projects)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(eq(projects.id, old.id));
  }

  const teamId = newId("team");
  await db.insert(teams).values({ id: teamId, name: teamName || authorName });

  const projectId = newId("prj");
  await db.insert(projects).values({
    id: projectId,
    // 論題が長いので一覧では先頭だけをタイトルにする
    title: resolution.length > 40 ? `${resolution.slice(0, 40)}…` : resolution,
    resolution,
    mySide: side,
    teamName: teamName || null,
    members: membersRaw ? membersRaw.split(/[\s,、　]+/).filter(Boolean) : null,
    ownerTeamId: teamId,
    // 共通パスワード運用のためプロジェクト個別のパスコードは使わない。
    // 将来チームごとに分ける場合に備えて列は残し、無効な値を入れておく
    passcodeHash: hashPasscode(randomUUID()),
    isCompetitionTopic,
    status: "analyzing",
  });

  await log(userId, "generate", projectId, projectId, "論題分析を開始");

  // 分析だけ同期で待つ。数十秒で終わり、この結果を次の画面で確認してもらうため
  const jobId = await createJob(projectId, userId);
  await runJob(jobId, { only: ["analysis"] });

  redirect(`/projects/${projectId}/analysis`);
}

/** 分析確認画面での修正を保存する（品質ゲート） */
export async function saveAnalysis(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get("projectId") ?? "");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project?.analysis) {
    return { error: "分析結果が見つかりませんでした。" };
  }

  const lawNames = formData.getAll("lawName").map(String);
  const lawArticles = formData.getAll("lawArticle").map(String);
  const relatedLaws: LawRef[] = lawNames
    .map((name, i) => ({
      id: newId("law"),
      name: name.trim(),
      article: (lawArticles[i] ?? "").trim(),
      // 条文全文はLLMに書かせていないので、人がe-Govで確認するまで未確認のまま
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

  const categoryNames = splitList(String(formData.get("categories") ?? ""));
  if (categoryNames.length === 0) {
    return {
      error:
        "争点カテゴリを1つ以上入力してください。全ての成果物と本番モードの検索軸になります。",
    };
  }

  // カテゴリは他の成果物から参照されるため、既存の名前はIDを維持する
  const existing = await db
    .select()
    .from(issueCategories)
    .where(eq(issueCategories.projectId, projectId));
  const idByName = new Map(existing.map((c) => [c.name, c.id]));

  await db
    .delete(issueCategories)
    .where(eq(issueCategories.projectId, projectId));
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
    .set({ analysis, updatedAt: nowIso() })
    .where(eq(projects.id, projectId));

  const userId = (await currentUserId()) ?? "unknown";
  await log(userId, "edit", projectId, projectId, "分析結果を修正");

  revalidatePath(`/projects/${projectId}/analysis`);
  return {};
}

/** 分析を承認して残り7ステップを流す */
export async function startGeneration(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get("projectId") ?? "");

  // 先に保存してから生成する。画面の修正が反映されないまま走るのを防ぐ
  const saved = await saveAnalysis(_prev, formData);
  if (saved.error) return saved;

  const job = await latestJob(projectId);
  if (!job) return { error: "生成の記録が見つかりませんでした。" };

  await db
    .update(projects)
    .set({ status: "generating", updatedAt: nowIso() })
    .where(eq(projects.id, projectId));

  // await しない。数分かかるのでバックグラウンドで進め、画面は進捗を見に行く
  void runJob(job.id).catch((err) => {
    console.error("[generate] ジョブが異常終了しました", job.id, err);
  });

  redirect(`/projects/${projectId}`);
}

/** 分析だけをやり直す */
export async function retryAnalysis(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get("projectId") ?? "");
  const job = await latestJob(projectId);
  if (!job) return { error: "生成の記録が見つかりませんでした。" };

  await retryStep(job.id, "analysis");
  revalidatePath(`/projects/${projectId}/analysis`);
  return {};
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,、，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
