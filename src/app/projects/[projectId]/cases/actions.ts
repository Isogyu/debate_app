"use server";

/**
 * 立論まわりのサーバー処理（v6）
 *
 *  - 生成（各側3本まで）・登録（.docx / PDF）・質疑の追加
 *  - 立論の編集（段落単位。v5 の「壊さない編集」を継続）
 *  - 「確認済」への切り替え（誰でもボタン一つ。記録は取らない — v6 要件 §1 #5）
 *  - 資料の手入力（作成手順どおりに自分で作った資料を入れる）
 *  - 過去テーマの資料のコピー（§3.5）
 *
 * 立論の削除機能は置かない（第5回確認）。
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { db, DB_DIR } from "@/db";
import {
  caseStrategies,
  caseVariants,
  closingTemplates,
  generationJobs,
  projects,
  revisions,
  sourceMaterials,
} from "@/db/schema";
import type { CaseVariant, DebateCase, Side } from "@/domain/types";
import { renderFullText } from "@/domain/case-format";
import { InvariantError, validateVariant } from "@/domain/invariants";
import { claimRegenerationSchema } from "@/domain/schemas";
import { hostOf, isWithinAllowedSources } from "@/domain/source-whitelist";
import { newId, nowIso } from "@/lib/ids";
import { JobBusyError, startRetry } from "@/lib/jobs/runner";
import {
  assertActiveTheme,
  assertEditableMaterial,
  assertEditableVariant,
  copyMaterialToCase,
  RuleError,
  startGeneration,
  startImport,
  startMoreQuestions,
} from "@/lib/jobs/orchestrate";
import { loadMaterialsFor, stripUnsourcedNumbers } from "@/lib/jobs/steps-numbers";
import { adjustLengthWarning } from "@/lib/jobs/length";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { LlmConfigError, LlmSchemaError } from "@/lib/llm/provider";
import { SYSTEM_BASE, regenerateClaimPrompt } from "@/lib/llm/prompts";
import { ExtractError, extractUploadText } from "@/lib/text-extract";
import { currentUserId, log, requireSession } from "@/lib/session";
import { todayJst } from "@/domain/jst";

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

function userMessage(err: unknown, fallback: string): string {
  if (err instanceof RuleError || err instanceof ExtractError || err instanceof JobBusyError) {
    return err.message;
  }
  if (err instanceof LlmConfigError) return err.message;
  console.error(err);
  return fallback;
}

function revalidateTheme(projectId: string, variantId?: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  if (variantId) revalidatePath(`/projects/${projectId}/cases/${variantId}`);
}

// ── 生成 ───────────────────────────────────────────────
export async function generateCase(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const side = String(formData.get("side") ?? "") as Side;
  if (side !== "affirmative" && side !== "negative") return { error: "側を選んでください。" };
  try {
    const variantId = await startGeneration(projectId, side, userId);
    await log(userId, "generate", variantId, projectId, "立論を生成");
    revalidateTheme(projectId);
    return { ok: true, message: "生成を始めました。数分〜十数分かかります。画面を閉じても続きます。" };
  } catch (err) {
    return { error: userMessage(err, "生成を始められませんでした。") };
  }
}

/** 失敗したステップからやり直す */
export async function retryJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const jobId = String(formData.get("jobId") ?? "");
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) return { error: "生成の記録が見つかりませんでした。" };
  try {
    await assertActiveTheme(job.projectId);
  } catch (err) {
    return { error: userMessage(err, "再実行できませんでした。") };
  }
  if (job.status !== "failed" && job.status !== "partial") {
    return { error: "この生成はいま実行中か、すでに終わっています。" };
  }
  // 状態の確認と取得は1文で行う（二度押しで二重に走らせない）。実行は待たない
  try {
    const run = await startRetry(jobId);
    void run?.done.catch((err) => console.error("[generate] 再実行が異常終了しました", err));
  } catch (err) {
    return { error: userMessage(err, "再実行できませんでした。") };
  }
  revalidateTheme(job.projectId, job.variantId ?? undefined);
  return { ok: true, message: "失敗したところからやり直しています。" };
}

// ── 登録（アップロード） ─────────────────────────────────
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

async function saveUploadFile(
  projectId: string,
  file: File,
): Promise<{ filePath: string; text: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractError("ファイルが大きすぎます（15MBまで）。");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const { text } = await extractUploadText(file.name, data);
  const dir = path.join(DB_DIR, "uploads", projectId);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z]/g, "") || ".bin";
  const filePath = path.join(dir, `${newId("file")}${ext}`);
  await fs.writeFile(filePath, data);
  return { filePath, text };
}

export async function uploadCase(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const side = String(formData.get("side") ?? "") as Side;
  const label = String(formData.get("label") ?? "").trim();
  const caseFile = formData.get("caseFile");
  const materialsFile = formData.get("materialsFile");

  if (side !== "affirmative" && side !== "negative") {
    return { error: "賛成側か反対側かを選んでください。" };
  }
  if (!(caseFile instanceof File) || caseFile.size === 0) {
    return { error: "立論のファイルを選んでください。" };
  }

  let variantId: string;
  try {
    await assertActiveTheme(projectId);
    const c = await saveUploadFile(projectId, caseFile);
    const m =
      materialsFile instanceof File && materialsFile.size > 0
        ? await saveUploadFile(projectId, materialsFile)
        : null;
    variantId = await startImport({
      projectId,
      side,
      label: label || caseFile.name.replace(/\.[^.]+$/, ""),
      userId,
      caseFileName: caseFile.name,
      caseFilePath: c.filePath,
      caseText: c.text,
      materialsFileName: m ? (materialsFile as File).name : undefined,
      materialsFilePath: m?.filePath,
      materialsText: m?.text,
    });
    await log(userId, "upload", variantId, projectId, `立論を登録: ${caseFile.name}`);
  } catch (err) {
    return { error: userMessage(err, "登録できませんでした。") };
  }
  revalidateTheme(projectId);
  redirect(`/projects/${projectId}/cases/${variantId}`);
}

// ── 質疑の追加（この箇所をもっと） ───────────────────────
export async function addQuestions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const variantId = String(formData.get("variantId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  try {
    await startMoreQuestions(variantId, claimId, userId);
    const [v] = await db.select().from(caseVariants).where(eq(caseVariants.id, variantId));
    if (v) revalidateTheme(v.projectId, variantId);
    return { ok: true, message: "この箇所の質疑を追加しています（1〜2分）。" };
  } catch (err) {
    return { error: userMessage(err, "質疑を追加できませんでした。") };
  }
}

// ── 確認済への切り替え ─────────────────────────────────
type VerifyTarget = "case" | "questions" | "closing" | "strategy" | "material";

export async function setVerified(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const target = String(formData.get("target") ?? "") as VerifyTarget;
  const id = String(formData.get("id") ?? "");
  const value = formData.get("value") === "true";
  const projectId = String(formData.get("projectId") ?? "");
  const variantId = String(formData.get("variantId") ?? "") || undefined;

  // 過去テーマは閲覧のみ。対象がどのテーマのものかをサーバー側で確かめる（§2 F1）
  try {
    if (target === "material") {
      const m = await assertEditableMaterial(id);
      if (m.projectId !== projectId) return { error: "資料が見つかりませんでした。" };
    } else {
      await assertEditableVariant(id, { projectId, allowRunningJob: true });
    }
  } catch (err) {
    return { error: userMessage(err, "変更できませんでした。") };
  }

  switch (target) {
    case "case":
      await db.update(caseVariants).set({ verified: value }).where(eq(caseVariants.id, id));
      break;
    case "questions":
      await db.update(caseVariants).set({ questionsVerified: value }).where(eq(caseVariants.id, id));
      break;
    case "closing":
      await db.update(closingTemplates).set({ verified: value }).where(eq(closingTemplates.variantId, id));
      break;
    case "strategy":
      await db.update(caseStrategies).set({ verified: value }).where(eq(caseStrategies.variantId, id));
      break;
    case "material": {
      const [m] = await db.select().from(sourceMaterials).where(eq(sourceMaterials.id, id));
      if (!m) return { error: "資料が見つかりませんでした。" };
      if (m.status === "procedure" && value) {
        return { error: "作成手順しかない資料は、先に中身（出典と引用）を入力してください。" };
      }
      await db
        .update(sourceMaterials)
        .set({ status: value ? "verified" : "unverified", verifiedAt: value ? nowIso() : null })
        .where(eq(sourceMaterials.id, id));
      break;
    }
    default:
      return { error: "確認の対象が不明です。" };
  }
  await log(userId, "verify", `${target}:${id}`, projectId, value ? "確認済にした" : "未確認に戻した");
  revalidateTheme(projectId, variantId);
  return { ok: true };
}

// ── 資料の手入力 ───────────────────────────────────────
/**
 * 作成手順どおりに自分で見つけた資料を入れる。人が入れたものなので確認済にする。
 * 引用文を入れるなら出典は必須（v5 からの不変条件4）。
 */
export async function saveMaterial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const materialId = String(formData.get("materialId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const variantId = String(formData.get("variantId") ?? "") || undefined;
  const citation = String(formData.get("citation") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const quote = String(formData.get("quote") ?? "").trim();
  const lastCheckedAt = String(formData.get("lastCheckedAt") ?? "").trim();

  try {
    const m = await assertEditableMaterial(materialId);
    if (m.projectId !== projectId) return { error: "資料が見つかりませんでした。" };
    if (variantId) await assertEditableVariant(variantId, { projectId });
  } catch (err) {
    return { error: userMessage(err, "資料を保存できませんでした。") };
  }
  if (!quote) return { error: "引用文（資料の中身）を入力してください。" };
  if (!citation) return { error: "出典（発行元・題名など）を入力してください。" };
  if (url && !hostOf(url)) return { error: "URL の形式が正しくありません。" };

  await db
    .update(sourceMaterials)
    .set({
      citation,
      url: url || null,
      quote,
      sourceDomain: url ? hostOf(url) : null,
      lastCheckedAt: lastCheckedAt || todayJst(),
      withinAllowedSources: url ? isWithinAllowedSources(url) : false,
      // 人が入れた資料。再実行の自動取得で上書きしない（steps-sources.ts）
      origin: "manual",
      status: "verified",
      verifiedAt: nowIso(),
    })
    .where(eq(sourceMaterials.id, materialId));
  await log(userId, "edit", materialId, projectId, "資料を入力");
  revalidateTheme(projectId, variantId);
  return { ok: true };
}

// ── 過去テーマの資料のコピー ───────────────────────────
export async function copyMaterial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireSession();
  const materialId = String(formData.get("materialId") ?? "");
  const targetVariantId = String(formData.get("targetVariantId") ?? "");
  try {
    const number = await copyMaterialToCase({ materialId, targetVariantId, userId });
    const [v] = await db.select().from(caseVariants).where(eq(caseVariants.id, targetVariantId));
    if (v) {
      await log(userId, "copy", materialId, v.projectId, `資料をコピー（資料${number}）`);
      revalidateTheme(v.projectId, v.id);
    }
    return { ok: true, message: `コピーしました（コピー先では【資料${number}】）。本文に【資料${number}参照】を書き足して使ってください。` };
  } catch (err) {
    return { error: userMessage(err, "コピーできませんでした。") };
  }
}

// ── 立論の編集（段落単位） ─────────────────────────────
/** 編集してよい立論を読む（現テーマ・生成中でない。§2 F1） */
async function loadVariantRow(variantId: string) {
  return assertEditableVariant(variantId);
}

async function snapshot(projectId: string, variantId: string, debateCase: DebateCase, origin: "ai" | "human") {
  await db.insert(revisions).values({
    id: newId("rev"),
    projectId,
    entityType: "case",
    entityId: variantId,
    snapshot: debateCase,
    changedBy: (await currentUserId()) ?? "unknown",
    origin,
  });
}

async function persist(
  variant: Awaited<ReturnType<typeof loadVariantRow>>,
  debateCase: DebateCase,
): Promise<ActionState> {
  debateCase.fullText = renderFullText(debateCase);
  try {
    if (variant.origin === "generated") {
      // 生成立論は資料番号を 1..N に保つ（v5 の不変条件）
      const validated = validateVariant({
        ...(variant as unknown as CaseVariant),
        debateCase,
      });
      await db
        .update(caseVariants)
        .set({
          debateCase: validated.debateCase,
          sourceRefs: validated.sourceRefs,
          // 手で直したら字数の警告も測り直す
          lengthWarning: adjustLengthWarning(validated.debateCase) ?? null,
        })
        .where(eq(caseVariants.id, variant.id));
    } else {
      // 登録立論は自分たちの番号の付け方（（資料N）など）をそのまま残す
      await db.update(caseVariants).set({ debateCase }).where(eq(caseVariants.id, variant.id));
    }
  } catch (err) {
    if (err instanceof InvariantError) return { error: err.message };
    throw err;
  }
  await db.update(projects).set({ updatedAt: nowIso() }).where(eq(projects.id, variant.projectId));
  revalidateTheme(variant.projectId, variant.id);
  return { ok: true };
}

export async function saveCaseFrame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireSession();
  const variantId = String(formData.get("variantId") ?? "");
  let variant;
  try {
    variant = await loadVariantRow(variantId);
  } catch (err) {
    return { error: userMessage(err, "保存できませんでした。") };
  }
  await snapshot(variant.projectId, variantId, variant.debateCase, "human");
  const debateCase: DebateCase = {
    ...variant.debateCase,
    claim: String(formData.get("claim") ?? "").trim(),
    conclusion: String(formData.get("conclusion") ?? "").trim(),
  };
  await log(userId, "edit", variantId, variant.projectId, "主張・結論を編集");
  return persist(variant, debateCase);
}

export async function saveClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireSession();
  const variantId = String(formData.get("variantId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  let variant;
  try {
    variant = await loadVariantRow(variantId);
  } catch (err) {
    return { error: userMessage(err, "保存できませんでした。") };
  }
  await snapshot(variant.projectId, variantId, variant.debateCase, "human");
  const debateCase: DebateCase = {
    ...variant.debateCase,
    sections: variant.debateCase.sections.map((s) => ({
      ...s,
      subsections: s.subsections.map((c) =>
        c.id !== claimId
          ? c
          : {
              ...c,
              title: String(formData.get("title") ?? "").trim(),
              claim: String(formData.get("claim") ?? "").trim(),
              warrant: String(formData.get("warrant") ?? "").trim(),
              impact: String(formData.get("impact") ?? "").trim(),
            },
      ),
    })),
  };
  await log(userId, "edit", claimId, variant.projectId, "立論の一部を編集");
  return persist(variant, debateCase);
}

/** 段落単位の再生成（生成立論のみ。自作の立論はAIに書き換えさせない） */
export async function regenerateClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireSession();
  const variantId = String(formData.get("variantId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  let variant;
  try {
    variant = await loadVariantRow(variantId);
  } catch (err) {
    return { error: userMessage(err, "再生成できませんでした。") };
  }
  if (variant.origin !== "generated") {
    return { error: "登録した立論はAIで書き換えません。" };
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, variant.projectId));
  if (!project) return { error: "テーマが見つかりませんでした。" };

  const section = variant.debateCase.sections.find((s) => s.subsections.some((c) => c.id === claimId));
  const target = section?.subsections.find((c) => c.id === claimId);
  if (!section || !target) return { error: "再生成する部分が見つかりませんでした。" };

  const allowedNumbers = variant.sourceRefs
    .filter((r) => target.sourceRefIds.includes(r.id))
    .map((r) => r.number);

  try {
    const { data } = await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: regenerateClaimPrompt({
        resolution: project.resolution,
        side: variant.side,
        framework: variant.framework,
        sectionTitle: section.title,
        claimTitle: target.title,
        current: [target.claim, target.warrant, target.impact].filter(Boolean).join("\n"),
        allowedRefNumbers: allowedNumbers,
      }),
      schema: claimRegenerationSchema,
    });
    // 書き直した段落も、数字の関所を通す（出典に結びつかない数字を含む文は落とす。§1-9）
    const materials = new Map((await loadMaterialsFor(variant)).map((m) => [m.id, m]));
    const location = target.title;
    const guard = (t: string) => stripUnsourcedNumbers(t, location, variant.sourceRefs, materials);
    const claimText = guard(data.claim);
    const warrant = guard(data.warrant);
    const impact = guard(data.impact);
    const removedCount = claimText.removed.length + warrant.removed.length + impact.removed.length;

    await snapshot(variant.projectId, variantId, variant.debateCase, "ai");
    const debateCase: DebateCase = {
      ...variant.debateCase,
      sections: variant.debateCase.sections.map((s) => ({
        ...s,
        subsections: s.subsections.map((c) =>
          c.id !== claimId
            ? c
            : {
                ...c,
                claim: claimText.text,
                warrant: warrant.text,
                causalChain: data.causalChain,
                impact: impact.text,
              },
        ),
      })),
    };
    debateCase.fullText = renderFullText(debateCase);
    // AI が書き直した部分は未確認に戻し、字数も測り直す（§3.3）
    await db
      .update(caseVariants)
      .set({ verified: false, lengthWarning: adjustLengthWarning(debateCase) ?? null })
      .where(eq(caseVariants.id, variantId));
    await log(userId, "generate", claimId, variant.projectId, "立論の一部を再生成");
    const result = await persist(variant, debateCase);
    if (result.ok && removedCount > 0) {
      return {
        ...result,
        message: `出典に結びつかない数字を含む文を${removedCount}か所取り除きました。`,
      };
    }
    return result;
  } catch (err) {
    if (err instanceof LlmSchemaError) {
      return { error: "AIの出力が読み取れませんでした。もう一度「この部分を再生成」を押してください。" };
    }
    return { error: userMessage(err, "再生成に失敗しました。") };
  }
}
