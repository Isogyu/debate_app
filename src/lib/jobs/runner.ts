/**
 * 生成ジョブランナー
 *
 * 生成は数分かかり「閉じてもOK」が要件（v6 要件 §1 #6）。HTTPリクエスト内で完結させず、
 * ジョブをDBに永続化してバックグラウンドで進める。
 *
 *  - ステップ単位で状態を保存 → ブラウザを閉じても継続、途中失敗しても再開できる
 *  - 失敗したら自動リトライ1回
 *  - 失敗したステップがあっても他のステップは止めない（partial で終える）
 *  - サーバーが止まって途中で切れたジョブは、次の起動時に続きから再開する（instrumentation.ts）
 */

import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { apiUsage, generationJobs } from "@/db/schema";
import {
  ANALYSIS_STEPS,
  GENERATE_STEPS,
  GEN_STEP_LABELS,
  IMPORT_STEPS,
  MORE_QUESTION_STEPS,
} from "@/domain/types";
import type {
  GenStep,
  GenerationStepState,
  JobKind,
  JobParams,
} from "@/domain/types";
import {
  LlmConfigError,
  LlmSchemaError,
  LlmTruncatedError,
} from "@/lib/llm/provider";
import { newId, nowIso } from "@/lib/ids";
import { runStep } from "./steps";

const MAX_ATTEMPTS = 2; // 初回 + 自動リトライ1回

export const STEPS_BY_KIND: Record<JobKind, GenStep[]> = {
  analysis: ANALYSIS_STEPS,
  generate: GENERATE_STEPS,
  import: IMPORT_STEPS,
  more_questions: MORE_QUESTION_STEPS,
};

export interface NewJob {
  kind: JobKind;
  projectId: string;
  variantId?: string;
  params?: JobParams;
  createdBy: string;
}

function jobRow(id: string, opts: NewJob) {
  return {
    id,
    kind: opts.kind,
    projectId: opts.projectId,
    variantId: opts.variantId ?? null,
    params: opts.params ?? {},
    steps: STEPS_BY_KIND[opts.kind].map((step) => ({
      step,
      status: "pending" as const,
      attempts: 0,
    })),
    status: "queued" as const,
    createdBy: opts.createdBy,
  };
}

export async function createJob(opts: NewJob): Promise<string> {
  const id = newId("job");
  await db.insert(generationJobs).values(jobRow(id, opts));
  return id;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * トランザクションの中でジョブを作る（同期）。
 * 立論の枠とジョブを別々に作ると、間で失敗したときにジョブのない枠が残り、
 * 生成の1枠を永久に消費してしまう（削除機能がないため戻せない）。
 */
export function createJobTx(tx: Tx, opts: NewJob): string {
  const id = newId("job");
  tx.insert(generationJobs).values(jobRow(id, opts)).run();
  return id;
}

/** トランザクションの中で「生成中のジョブがあるか」を調べる（同期） */
export function hasActiveJobTx(tx: Tx, filter: { projectId?: string; variantId?: string }): boolean {
  const conds = [inArray(generationJobs.status, ["queued", "running"])];
  if (filter.projectId) conds.push(eq(generationJobs.projectId, filter.projectId));
  if (filter.variantId) conds.push(eq(generationJobs.variantId, filter.variantId));
  return tx.select({ id: generationJobs.id }).from(generationJobs).where(and(...conds)).all().length > 0;
}

// ── 同時実行数の制限 ───────────────────────────────────
/**
 * 同時に進めるジョブの数。Fly.io のマシンはメモリ512MBで、PDFの読み込み・
 * AIへの並列問い合わせ・グラフ画像の作成が重なるとメモリが足りなくなる。
 * 超えた分は順番待ちにする（状態は running のまま、ステップは pending）。
 */
const MAX_CONCURRENT_JOBS = Number(process.env.DEBATE_MAX_CONCURRENT_JOBS ?? 2);
let runningCount = 0;
const waiters: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (runningCount < MAX_CONCURRENT_JOBS) {
    runningCount++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) next();
  else runningCount = Math.max(0, runningCount - 1);
}

/** 実行中（または開始待ち）のジョブがあるか。生成中のテーマ変更を止めるのに使う（§3 確定事項） */
export async function activeJobs(projectId: string) {
  return db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.projectId, projectId),
        inArray(generationJobs.status, ["queued", "running"]),
      ),
    );
}

/** 立論ごとの最新のジョブ */
export async function latestJobFor(variantId: string) {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.variantId, variantId))
    .orderBy(desc(generationJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function latestAnalysisJob(projectId: string) {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.kind, "analysis")))
    .orderBy(desc(generationJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function saveSteps(jobId: string, steps: GenerationStepState[]) {
  await db.update(generationJobs).set({ steps }).where(eq(generationJobs.id, jobId));
}

export interface RunOptions {
  /** 実行するステップを限定する（失敗したステップの再実行） */
  only?: GenStep[];
}

/**
 * ジョブ本体。呼び出し側は await せずに起動してよい（即座に応答を返すため）。
 * 外部キューは使わず、DBをキューとして扱う。
 */
export async function runJob(jobId: string, options: RunOptions = {}): Promise<string | null> {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) return null;

  // 二重起動の防止。同じジョブを並行に走らせると後から書いた方が相手の結果を消す
  const claimed = await db
    .update(generationJobs)
    .set({ status: "running", startedAt: job.startedAt ?? nowIso(), finishedAt: null })
    .where(and(eq(generationJobs.id, jobId), ne(generationJobs.status, "running")))
    .returning({ id: generationJobs.id });
  if (claimed.length === 0) {
    console.warn(`[generate] ${jobId} は既に実行中のため、起動を見送りました`);
    return null;
  }
  return runClaimed(job, options);
}

/**
 * 既に running にしたジョブを進める（起動時の再開でも使う）。
 * ステップの外（状態の保存など）で失敗しても、running のまま残さない。
 * 残るとテーマ変更や質疑の追加が、再起動するまで止まってしまう。
 */
async function runClaimed(
  job: typeof generationJobs.$inferSelect,
  options: RunOptions,
): Promise<string> {
  await acquireSlot();
  try {
    return await runClaimedInner(job, options);
  } catch (err) {
    console.error("[generate] ジョブの進行中に想定外のエラーが起きました", job.id, err);
    await db
      .update(generationJobs)
      .set({ status: "failed", finishedAt: nowIso() })
      .where(eq(generationJobs.id, job.id))
      .catch(() => {});
    return "failed";
  } finally {
    releaseSlot();
  }
}

async function runClaimedInner(
  job: typeof generationJobs.$inferSelect,
  options: RunOptions,
): Promise<string> {
  const steps = [...job.steps];
  const ctx = {
    jobId: job.id,
    projectId: job.projectId,
    variantId: job.variantId ?? undefined,
    params: job.params ?? {},
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.status === "done") continue; // 再開時は済んだステップを飛ばす
    if (options.only && !options.only.includes(step.step)) continue;

    steps[i] = { ...step, status: "running" };
    await saveSteps(job.id, steps);
    steps[i] = await attemptStep(step.step, ctx);
    await saveSteps(job.id, steps);

    // 取り込みに失敗したら、後続（質疑など）は材料がないので走らせない
    if (steps[i].status === "failed" && (step.step === "import" || step.step === "case_outline" || step.step === "case_body")) {
      break;
    }
  }

  const failed = steps.filter((s) => s.status === "failed").length;
  const done = steps.filter((s) => s.status === "done").length;
  const status =
    failed === 0 && done === steps.length
      ? "done"
      : done === 0
        ? "failed"
        : "partial";

  await db
    .update(generationJobs)
    .set({ status, finishedAt: nowIso() })
    .where(eq(generationJobs.id, job.id));
  return status;
}

async function attemptStep(
  step: GenStep,
  ctx: Parameters<typeof runStep>[1],
): Promise<GenerationStepState> {
  let attempts = 0;
  let lastError = "";

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const usage = await runStep(step, ctx);
      if (usage && (usage.inputTokens || usage.outputTokens)) {
        await db.insert(apiUsage).values({
          id: newId("use"),
          projectId: ctx.projectId,
          jobId: ctx.jobId,
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
      if (err instanceof LlmConfigError) {
        return { step, status: "failed", attempts, error: err.message };
      }
      if (err instanceof LlmTruncatedError) {
        return {
          step,
          status: "failed",
          attempts,
          error: `${GEN_STEP_LABELS[step]}の生成が途中で切れました。管理者に連絡してください（出力上限の引き上げが必要です）。`,
        };
      }
      console.error(
        `[generate] ${step} が失敗しました (${attempts}回目):`,
        err instanceof Error ? err.message : err,
      );
      if (err instanceof LlmSchemaError) {
        console.error("[generate] AIの生出力(先頭800字):", err.raw.slice(0, 800));
      }
      lastError =
        err instanceof LlmSchemaError
          ? `${GEN_STEP_LABELS[step]}の生成に失敗しました（${err.message}）。`
          : err instanceof Error
            ? err.message
            : "原因不明のエラーが発生しました。";
    }
  }

  return {
    step,
    status: "failed",
    attempts,
    error: `${lastError} この項目だけあとから再実行できます。`,
  };
}

export class JobBusyError extends Error {
  constructor() {
    super("この生成はいま実行中です。終わってから再実行してください。");
    this.name = "JobBusyError";
  }
}

/**
 * 失敗したステップと、その後ろの未完了ステップをやり直す。
 * 「失敗・一部失敗で終わったジョブを running にする」を1文で行い、取れた場合だけ進める。
 * 状態を確かめずに書き換えると、実行中のジョブが二重に走る（二度押し・2つのタブ）。
 */
export async function retryFailed(jobId: string): Promise<string | null> {
  const claimed = await db
    .update(generationJobs)
    .set({ status: "running", finishedAt: null })
    .where(
      and(
        eq(generationJobs.id, jobId),
        inArray(generationJobs.status, ["failed", "partial"]),
      ),
    )
    .returning();
  const job = claimed[0];
  if (!job) {
    const [exists] = await db.select({ id: generationJobs.id }).from(generationJobs).where(eq(generationJobs.id, jobId));
    if (exists) throw new JobBusyError();
    return null;
  }
  const steps = job.steps.map((s) =>
    s.status === "done" ? s : { ...s, status: "pending" as const, error: undefined },
  );
  await saveSteps(jobId, steps);
  return runClaimed({ ...job, steps }, {});
}

/**
 * サーバーの再起動で途中になったジョブを再開する。
 * Fly.io は使われていない間マシンを止めるため、長い生成が途中で切れることがある。
 */
export async function resumeInterruptedJobs(
  onFinished?: (job: typeof generationJobs.$inferSelect, status: string) => Promise<void>,
) {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(inArray(generationJobs.status, ["queued", "running"]));
  for (const job of rows) {
    const steps = job.steps.map((s) =>
      s.status === "running" ? { ...s, status: "pending" as const } : s,
    );
    await db
      .update(generationJobs)
      .set({ steps, status: "running" })
      .where(eq(generationJobs.id, job.id));
    console.log(`[generate] 途中で止まっていたジョブを再開します: ${job.id}`);
    void runClaimed({ ...job, steps, status: "running" }, {})
      .then((status) => onFinished?.(job, status))
      .catch((err) => console.error("[generate] 再開したジョブが異常終了しました", job.id, err));
  }
}

/** 進捗表示用 */
export function progressOf(steps: GenerationStepState[]) {
  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  return { done, failed, total: steps.length };
}
