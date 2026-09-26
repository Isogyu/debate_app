/**
 * テーマ・立論の作成とジョブの起動（v6 要件 §2 F1〜F5）
 *
 * 画面（Server Action / Route Handler）からはここを呼ぶ。
 * 生成上限・テーマ変更の制限といった「守るべき決まり」はここで検査する。
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseVariants,
  projects,
  sourceMaterials,
  uploads,
} from "@/db/schema";
import { MAX_GENERATED_PER_SIDE, type Side } from "@/domain/types";
import { newId, nowIso } from "@/lib/ids";
import {
  createJobTx,
  hasActiveJobTx,
  latestAnalysisJob,
  resumeInterruptedJobs,
  startRetry,
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
  const projectId = newId("prj");
  const title =
    opts.resolution.length > 40 ? `${opts.resolution.slice(0, 40)}…` : opts.resolution;
  // 「生成中か」の確認・前テーマの保管・新テーマとジョブの作成を1つのトランザクションで行う。
  // 分けると、確認の直後に始まった生成が過去テーマの上で走ってしまう
  const jobId = db.transaction((tx) => {
    const current = tx.select().from(projects).where(eq(projects.status, "active")).get();
    if (current) {
      if (hasActiveJobTx(tx, { projectId: current.id })) {
        throw new RuleError(
          "生成中のため、テーマを変更できません。いま動いている生成が終わってから変更してください。",
        );
      }
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
    return createJobTx(tx, { kind: "analysis", projectId, createdBy: opts.userId });
  });
  background(runAnalysis(jobId, projectId, opts.userId), "論題分析");
  return projectId;
}

async function runAnalysis(jobId: string, projectId: string, userId: string) {
  const status = await runJob(jobId);
  if (status === "done") await afterAnalysis(projectId, userId);
}

/** 分析のやり直し。終わったら、確認関門を選んでいなければそのまま生成に進む */
export async function retryAnalysisJob(projectId: string, userId: string) {
  await assertActiveTheme(projectId);
  const job = await latestAnalysisJob(projectId);
  if (!job) throw new RuleError("分析の記録が見つかりませんでした。");
  // 取得（二重実行の防止）だけを待ち、分析そのものは裏で進める。
  // 同時実行の枠が埋まっていると順番待ちになり、画面が長く応答しなくなるため
  const run = await startRetry(job.id);
  if (!run) throw new RuleError("分析の記録が見つかりませんでした。");
  background(
    run.done.then((status) => (status === "done" ? afterAnalysis(projectId, userId) : undefined)),
    "論題分析のやり直し",
  );
}

/**
 * 分析のあと。確認関門を選んでいなければ、各側1本ずつ生成を始める（§3.3）。
 */
async function afterAnalysis(projectId: string, userId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.status !== "active" || project.reviewAnalysis) return;
  await startInitialGeneration(projectId, userId);
}

/**
 * 各側、まだ生成した立論がなければ1本ずつ作る（§2 F3「最初は各側1本」）。
 * 承認の二度押しでも2本目ができないよう、「まだ無い」の確認は枠を作るのと同じ
 * トランザクションで行う。
 */
export async function startInitialGeneration(projectId: string, userId: string) {
  for (const side of ["affirmative", "negative"] as Side[]) {
    try {
      await startGeneration(projectId, side, userId, { onlyIfNone: true });
    } catch (err) {
      if (err instanceof RuleError && err.message === ALREADY_STARTED) continue;
      throw err;
    }
  }
}

const ALREADY_STARTED = "この側の最初の立論はすでに生成を始めています。";

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
 * 現テーマかの確認・数える・枠を作る・ジョブを作るを1つのトランザクションで行い、
 * 二重押しで4本目ができない／ジョブのない枠が残らないようにする。
 */
export async function startGeneration(
  projectId: string,
  side: Side,
  userId: string,
  opts: { onlyIfNone?: boolean } = {},
): Promise<string> {
  const variantId = newId("var");
  const jobId = db.transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project || project.status !== "active") {
      throw new RuleError("現テーマではないため、生成できません。");
    }
    if (!project.analysis) {
      throw new RuleError("論題の分析が終わってから生成できます。");
    }
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
    if (opts.onlyIfNone && count > 0) throw new RuleError(ALREADY_STARTED);
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
    return createJobTx(tx, { kind: "generate", projectId, variantId, createdBy: userId });
  });

  background(runJob(jobId), "立論の生成");
  return variantId;
}

/** 分析の確認関門を通したあと（§3.3 任意の確認関門） */
export async function approveAnalysis(projectId: string, userId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.status !== "active") {
    throw new RuleError("現テーマではないため、生成できません。");
  }
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
  const variantId = newId("var");
  const uploadId = newId("upl");
  const jobId = db.transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, opts.projectId)).get();
    if (!project || project.status !== "active") {
      throw new RuleError("現テーマではないため、登録できません。");
    }
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
    return createJobTx(tx, {
      kind: "import",
      projectId: opts.projectId,
      variantId,
      params: { uploadId },
      createdBy: opts.userId,
    });
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
  const jobId = db.transaction((tx) => {
    const variant = assertEditableVariantTx(tx, variantId);
    const claimExists = variant.debateCase.sections.some((s) =>
      s.subsections.some((c) => c.id === claimId),
    );
    if (!claimExists) throw new RuleError("指定した段落が見つかりませんでした。");
    return createJobTx(tx, {
      kind: "more_questions",
      projectId: variant.projectId,
      variantId,
      params: { claimId },
      createdBy: userId,
    });
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
  return db.transaction((tx) => {
    const material = tx
      .select()
      .from(sourceMaterials)
      .where(eq(sourceMaterials.id, opts.materialId))
      .get();
    if (!material) throw new RuleError("資料が見つかりませんでした。");
    // 生成中の立論は、ジョブが開始時の資料一覧で書き戻すのでコピーが消える
    const target = assertEditableVariantTx(tx, opts.targetVariantId);
    const source = tx.select().from(projects).where(eq(projects.id, material.projectId)).get();
    if (!source || source.status !== "archived") {
      throw new RuleError("コピーできるのは過去テーマの資料です。");
    }

    const newMaterialId = newId("mat");
    const nextNumber = Math.max(0, ...target.sourceRefs.map((r) => r.number)) + 1;
    tx.insert(sourceMaterials)
      .values({
        ...material,
        id: newMaterialId,
        projectId: target.projectId,
        status: material.status === "procedure" ? "procedure" : "unverified",
        origin: "copied",
        copiedFromMaterialId: material.id,
        verifiedAt: null,
      })
      .run();
    tx.update(caseVariants)
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
      .where(eq(caseVariants.id, target.id))
      .run();
    return nextNumber;
  });
}

// ── 編集できるかの確認 ─────────────────────────────────
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 立論を変更してよいか（トランザクション内・同期）。
 *  - 現テーマの立論であること（過去テーマは閲覧のみ。§2 F1）
 *  - その立論のジョブが動いていないこと（動いていると、ジョブの書き戻しで編集が消える）
 *  - projectId を渡した場合、その立論がそのテーマのものであること
 */
export function assertEditableVariantTx(
  tx: Tx,
  variantId: string,
  opts: { projectId?: string; allowRunningJob?: boolean } = {},
) {
  const variant = tx.select().from(caseVariants).where(eq(caseVariants.id, variantId)).get();
  if (!variant || (opts.projectId && variant.projectId !== opts.projectId)) {
    throw new RuleError("立論が見つかりませんでした。");
  }
  const project = tx.select().from(projects).where(eq(projects.id, variant.projectId)).get();
  if (!project || project.status !== "active") {
    throw new RuleError("過去テーマの立論は閲覧のみです。");
  }
  if (!opts.allowRunningJob && hasActiveJobTx(tx, { variantId })) {
    throw new RuleError("この立論はいま生成中です。終わってから操作してください。");
  }
  return variant;
}

export async function assertEditableVariant(
  variantId: string,
  opts: { projectId?: string; allowRunningJob?: boolean } = {},
) {
  return db.transaction((tx) => assertEditableVariantTx(tx, variantId, opts));
}

/** 資料を変更してよいか。資料の属するテーマが現テーマであること */
export async function assertEditableMaterial(materialId: string) {
  const [material] = await db.select().from(sourceMaterials).where(eq(sourceMaterials.id, materialId));
  if (!material) throw new RuleError("資料が見つかりませんでした。");
  const [project] = await db.select().from(projects).where(eq(projects.id, material.projectId));
  if (!project || project.status !== "active") {
    throw new RuleError("過去テーマの資料は閲覧のみです。");
  }
  return material;
}

/** テーマを変更してよいか（分析の修正・承認など） */
export async function assertActiveTheme(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.status !== "active") {
    throw new RuleError("過去テーマは閲覧のみです。");
  }
  return project;
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
