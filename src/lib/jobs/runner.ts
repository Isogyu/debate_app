/**
 * 生成ジョブランナー（REQUIREMENTS.md §4「生成ジョブの実行方式」）
 *
 * 生成は数分かかり「閉じてもOK」が要件。HTTPリクエスト内で完結させず、
 * ジョブをDBに永続化してバックグラウンドで進める。
 *
 *  - ステップ単位で状態を保存 → ブラウザを閉じても継続、途中失敗しても再開できる
 *  - スキーマ検証に落ちたら自動リトライ1回
 *  - 失敗したステップがあっても他のステップは止めない（partial で終える）
 */

import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiUsage, generationJobs, projects } from "@/db/schema";
import { GEN_STEPS, GEN_STEP_LABELS } from "@/domain/types";
import type { GenStep, GenerationStepState } from "@/domain/types";
import { LlmConfigError, LlmSchemaError } from "@/lib/llm/provider";
import { newId, nowIso } from "@/lib/ids";
import { runStep } from "./steps";

const MAX_ATTEMPTS = 2; // 初回 + 自動リトライ1回

export function initialSteps(): GenerationStepState[] {
  return GEN_STEPS.map((step) => ({ step, status: "pending", attempts: 0 }));
}

export async function createJob(
  projectId: string,
  createdBy: string,
): Promise<string> {
  const id = newId("job");
  await db.insert(generationJobs).values({
    id,
    projectId,
    steps: initialSteps(),
    status: "queued",
    createdBy,
  });
  return id;
}

/** プロジェクトに紐づく最新のジョブ。画面は常にこれを見る */
export async function latestJob(projectId: string) {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.projectId, projectId))
    .orderBy(desc(generationJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function saveSteps(jobId: string, steps: GenerationStepState[]) {
  await db.update(generationJobs).set({ steps }).where(eq(generationJobs.id, jobId));
}

export interface RunOptions {
  /**
   * 実行するステップを限定する。
   * 論題分析だけを先に走らせ、人が確認してから残りを流すために使う
   * （DESIGN §3 の品質ゲート）。
   */
  only?: GenStep[];
}

/**
 * ジョブ本体。APIハンドラからは await せずに起動する（即座に202を返すため）。
 * 管理者PC1台構成なので外部キューは使わず、DBをキューとして扱う。
 */
export async function runJob(
  jobId: string,
  options: RunOptions = {},
): Promise<void> {
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId));
  if (!job) return;

  const steps = [...job.steps];
  await db
    .update(generationJobs)
    .set({ status: "running", startedAt: nowIso() })
    .where(eq(generationJobs.id, jobId));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.status === "done") continue; // 再開時は済んだステップを飛ばす
    if (options.only && !options.only.includes(step.step)) continue;

    steps[i] = { ...step, status: "running" };
    await saveSteps(jobId, steps);

    const outcome = await attemptStep(job.projectId, step.step, jobId);
    steps[i] = outcome;
    await saveSteps(jobId, steps);
  }

  const failed = steps.filter((s) => s.status === "failed").length;
  const pending = steps.filter((s) => s.status === "pending").length;

  // まだ流していないステップが残っている＝人の確認待ち（品質ゲートの途中）
  const status = pending > 0
    ? (failed > 0 ? "failed" : "awaiting_review")
    : failed === 0
      ? "done"
      : failed === steps.length
        ? "failed"
        : "partial";

  await db
    .update(generationJobs)
    .set({
      status,
      finishedAt: pending > 0 ? null : nowIso(),
    })
    .where(eq(generationJobs.id, jobId));

  await db
    .update(projects)
    .set({
      status: projectStatusFor(status),
      updatedAt: nowIso(),
    })
    .where(eq(projects.id, job.projectId));
}

/** ジョブの状態をプロジェクトの表示ステータスに写す */
function projectStatusFor(
  jobStatus: "awaiting_review" | "done" | "partial" | "failed",
): "analyzing" | "generating" | "ready" {
  // 一部失敗でも、できたところまでは使えるので ready にする
  if (jobStatus === "done" || jobStatus === "partial") return "ready";
  return "analyzing";
}

async function attemptStep(
  projectId: string,
  step: GenStep,
  jobId: string,
): Promise<GenerationStepState> {
  let attempts = 0;
  let lastError = "";

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const usage = await runStep(projectId, step);
      if (usage) {
        await db.insert(apiUsage).values({
          id: newId("use"),
          projectId,
          jobId,
          step,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }
      return {
        step,
        status: "done",
        attempts,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        model: usage?.model,
      };
    } catch (err) {
      // 設定不備はリトライしても無駄なので即座に諦める
      if (err instanceof LlmConfigError) {
        return { step, status: "failed", attempts, error: err.message };
      }
      lastError =
        err instanceof LlmSchemaError
          ? `${GEN_STEP_LABELS[step]}のAI出力が読み取れませんでした。`
          : err instanceof Error
            ? err.message
            : "原因不明のエラーが発生しました。";
    }
  }

  return {
    step,
    status: "failed",
    attempts,
    // ユーザー向け日本語。次に何をすればよいかまで書く（§6.3 エラー設計）
    error: `${lastError} この項目だけあとから再実行できます。`,
  };
}

/** 失敗したステップだけを再実行する（§6.3 テスト戦略3） */
export async function retryStep(jobId: string, step: GenStep): Promise<void> {
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId));
  if (!job) return;

  const steps = job.steps.map((s) =>
    s.step === step ? { ...s, status: "pending" as const, error: undefined } : s,
  );
  await saveSteps(jobId, steps);
  await runJob(jobId, { only: [step] });
}

/** 進捗表示用（DESIGN §1/§4 の「5/8」の実体） */
export function progressOf(steps: GenerationStepState[]) {
  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  return { done, failed, total: steps.length };
}
