/**
 * テーマ・立論の作成とジョブの起動（v6 要件 §2 F1〜F5）
 *
 * 画面（Server Action / Route Handler）からはここを呼ぶ。
 * 生成上限・テーマ変更の制限といった「守るべき決まり」はここで検査する。
 */

import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  caseVariants,
  generationJobs,
  projects,
  sourceMaterials,
  uploads,
} from "@/db/schema";
import { MAX_GENERATED_PER_SIDE, type Side } from "@/domain/types";
import { newId, nowIso } from "@/lib/ids";
import {
  activeJobs,
  createJob,
  latestAnalysisJob,
  resumeInterruptedJobs,
  retryFailed,
  runJob,
} from "./runner";

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

function background(p: Promise<unknown>, label: string) {
  void p.catch((err) => console.error(`[generate] ${label} が異常終了しました`, err));
}

export async function activeTheme() {
  const [row] = await db.select().from(projects).where(eq(projects.status, "active"));
  return row ?? null;
}

// ── テーマ ─────────────────────────────────────────────
/**
 * テーマを登録・変更する。現テーマは常に1つ。前のテーマは過去テーマとして保管する。
 * 生成中はテーマを変えられない（完了を待つ）。
 */
export async function createTheme(opts: {
  resolution: string;
  reviewAnalysis: boolean;
  userId: string;
}): Promise<string> {
  const current = await activeTheme();
  if (current && (await activeJobs(current.id)).length > 0) {
    throw new RuleError(
      "生成中のため、テーマを変更できません。いま動いている生成が終わってから変更してください。",
    );
  }

  const projectId = newId("prj");
  const title =
    opts.resolution.length > 40 ? `${opts.resolution.slice(0, 40)}…` : opts.resolution;
  db.transaction((tx) => {
    if (current) {
      tx.update(projects)
        .set({ status: "archived", archivedAt: nowIso(), updatedAt: nowIso() })
        .where(eq(projects.id, current.id))
        .run();
    }
    tx.insert(projects)
      .values({
        id: projectId,
        title,
        resolution: opts.resolution,
        status: "active",
        reviewAnalysis: opts.reviewAnalysis,
        createdBy: opts.userId,
      })
      .run();
  });

  const jobId = await createJob({ kind: "analysis", projectId, createdBy: opts.userId });
  background(runAnalysis(jobId, projectId, opts.userId), "論題分析");
  return projectId;
}

async function runAnalysis(jobId: string, projectId: string, userId: string) {
  const status = await runJob(jobId);
  if (status === "done") await afterAnalysis(projectId, userId);
}

/** 分析のやり直し。終わったら、確認関門を選んでいなければそのまま生成に進む */
export async function retryAnalysisJob(projectId: string, userId: string) {
  const job = await latestAnalysisJob(projectId);
  if (!job) throw new RuleError("分析の記録が見つかりませんでした。");
  const status = await retryFailed(job.id);
  if (status === "done") await afterAnalysis(projectId, userId);
}

/**
 * 分析のあと。確認関門を選んでいなければ、各側1本ずつ生成を始める（§3.3）。
 */
async function afterAnalysis(projectId: string, userId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.status !== "active" || project.reviewAnalysis) return;
  await startInitialGeneration(projectId, userId);
}

/** 各側、まだ生成した立論がなければ1本ずつ作る */
export async function startInitialGeneration(projectId: string, userId: string) {
  for (const side of ["affirmative", "negative"] as Side[]) {
    const existing = await db
      .select({ id: caseVariants.id })
      .from(caseVariants)
      .where(
        and(
          eq(caseVariants.projectId, projectId),
          eq(caseVariants.side, side),
          eq(caseVariants.origin, "generated"),
        ),
      );
    if (existing.length === 0) await startGeneration(projectId, side, userId);
  }
}

// ── 生成 ───────────────────────────────────────────────
export async function generatedCount(projectId: string, side: Side): Promise<number> {
  const rows = await db
    .select({ id: caseVariants.id })
    .from(caseVariants)
    .where(
      and(
        eq(caseVariants.projectId, projectId),
        eq(caseVariants.side, side),
        eq(caseVariants.origin, "generated"),
      ),
    );
  return rows.length;
}

/**
 * 立論を1本生成する。1テーマにつき各側3本まで（§2 F3）。
 * 数える・枠を作るを1つのトランザクションで行い、二重押しで4本目ができないようにする。
 */
export async function startGeneration(
  projectId: string,
  side: Side,
  userId: string,
): Promise<string> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.status !== "active") {
    throw new RuleError("現テーマではないため、生成できません。");
  }
  if (!project.analysis) {
    throw new RuleError("論題の分析が終わってから生成できます。");
  }

  const variantId = newId("var");
  db.transaction((tx) => {
    const count = tx
      .select({ id: caseVariants.id })
      .from(caseVariants)
      .where(
        and(
          eq(caseVariants.projectId, projectId),
          eq(caseVariants.side, side),
          eq(caseVariants.origin, "generated"),
        ),
      )
      .all().length;
    if (count >= MAX_GENERATED_PER_SIDE) {
      throw new RuleError(
        `生成できる立論は1テーマにつき各側${MAX_GENERATED_PER_SIDE}本までです。`,
      );
    }
    tx.insert(caseVariants)
      .values({
        id: variantId,
        projectId,
        side,
        origin: "generated",
        label: "生成中",
        debateCase: {
          side,
          valuePremise: "",
          claim: "",
          sections: [],
          conclusion: "",
          fullText: "",
        },
        sourceRefs: [],
        createdBy: userId,
      })
      .run();
  });

  const jobId = await createJob({ kind: "generate", projectId, variantId, createdBy: userId });
  background(runJob(jobId), "立論の生成");
  return variantId;
}

/** 分析の確認関門を通したあと（§3.3 任意の確認関門） */
export async function approveAnalysis(projectId: string, userId: string) {
  await startInitialGeneration(projectId, userId);
}

// ── 登録 ───────────────────────────────────────────────
export async function startImport(opts: {
  projectId: string;
  side: Side;
  label: string;
  userId: string;
  caseFileName: string;
  caseFilePath: string;
  caseText: string;
  materialsFileName?: string;
  materialsFilePath?: string;
  materialsText?: string;
}): Promise<string> {
  const [project] = await db.select().from(projects).where(eq(projects.id, opts.projectId));
  if (!project || project.status !== "active") {
    throw new RuleError("現テーマではないため、登録できません。");
  }
  const variantId = newId("var");
  const uploadId = newId("upl");
  db.transaction((tx) => {
    tx.insert(caseVariants)
      .values({
        id: variantId,
        projectId: opts.projectId,
        side: opts.side,
        origin: "uploaded",
        label: opts.label,
        debateCase: {
          side: opts.side,
          valuePremise: "",
          claim: "",
          sections: [],
          conclusion: "",
          fullText: "",
        },
        sourceRefs: [],
        // 自作の本文は AI 生成物ではない
        verified: true,
        createdBy: opts.userId,
      })
      .run();
    tx.insert(uploads)
      .values({
        id: uploadId,
        projectId: opts.projectId,
        variantId,
        side: opts.side,
        label: opts.label,
        caseFileName: opts.caseFileName,
        caseFilePath: opts.caseFilePath,
        caseText: opts.caseText,
        materialsFileName: opts.materialsFileName ?? null,
        materialsFilePath: opts.materialsFilePath ?? null,
        materialsText: opts.materialsText ?? null,
        issues: [],
        createdBy: opts.userId,
      })
      .run();
  });
  const jobId = await createJob({
    kind: "import",
    projectId: opts.projectId,
    variantId,
    params: { uploadId },
    createdBy: opts.userId,
  });
  background(runJob(jobId), "登録の取り込み");
  return variantId;
}

// ── 質疑の追加 ─────────────────────────────────────────
export async function startMoreQuestions(
  variantId: string,
  claimId: string,
  userId: string,
): Promise<string> {
  const [variant] = await db.select().from(caseVariants).where(eq(caseVariants.id, variantId));
  if (!variant) throw new RuleError("立論が見つかりませんでした。");
  const running = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.variantId, variantId),
        inArray(generationJobs.status, ["queued", "running"]),
      ),
    );
  if (running.length > 0) {
    throw new RuleError("この立論はいま生成中です。終わってから追加してください。");
  }
  const jobId = await createJob({
    kind: "more_questions",
    projectId: variant.projectId,
    variantId,
    params: { claimId },
    createdBy: userId,
  });
  background(runJob(jobId), "質疑の追加");
  return jobId;
}

// ── 過去テーマからの資料コピー（§3.5） ─────────────────
/**
 * 過去テーマの資料を、現テーマの立論に新しい番号で足す。
 * テーマが変わると使い方の妥当性が変わるので、確認済でも「未確認」に戻す。
 */
export async function copyMaterialToCase(opts: {
  materialId: string;
  targetVariantId: string;
  userId: string;
}) {
  const [material] = await db
    .select()
    .from(sourceMaterials)
    .where(eq(sourceMaterials.id, opts.materialId));
  if (!material) throw new RuleError("資料が見つかりませんでした。");
  const [target] = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.id, opts.targetVariantId));
  if (!target) throw new RuleError("コピー先の立論が見つかりませんでした。");
  const [project] = await db.select().from(projects).where(eq(projects.id, target.projectId));
  if (project?.status !== "active") throw new RuleError("コピー先は現テーマの立論にしてください。");

  const newMaterialId = newId("mat");
  const nextNumber = Math.max(0, ...target.sourceRefs.map((r) => r.number)) + 1;
  await db.insert(sourceMaterials).values({
    ...material,
    id: newMaterialId,
    projectId: target.projectId,
    status: material.status === "procedure" ? "procedure" : "unverified",
    origin: "copied",
    copiedFromMaterialId: material.id,
    verifiedAt: null,
  });
  await db
    .update(caseVariants)
    .set({
      sourceRefs: [
        ...target.sourceRefs,
        {
          id: newId("ref"),
          number: nextNumber,
          materialId: newMaterialId,
          supportsClaimIds: [],
          categoryIds: [],
          description: "過去テーマからコピーした資料",
          searchKeywords: [],
          suggestedSourceIds: [],
          formatHint: material.statistic ? "chart" : "quote",
        },
      ],
    })
    .where(eq(caseVariants.id, target.id));
  return nextNumber;
}

// ── 起動時の再開 ───────────────────────────────────────
let resumed = false;
export async function resumeOnBoot() {
  if (resumed) return;
  resumed = true;
  await resumeInterruptedJobs(async (job, status) => {
    if (job.kind === "analysis" && status === "done") {
      await afterAnalysis(job.projectId, job.createdBy);
    }
  });
}

export { latestAnalysisJob };
