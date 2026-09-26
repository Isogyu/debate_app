/**
 * 生成ステップ: 登録（アップロード）の取り込み（v6 要件 §3.2）
 *
 * 本文はファイルから抽出済み（アップロード時）。ここでは
 *  1. AIに区切りの行番号だけを返させ、本文はコードで切り出して構造化する
 *  2. 資料ファイルを【資料N】で区切り、立論の【資料N参照】と番号で対応付ける
 *  3. 対応が取れない番号を指摘として保存する
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants, sourceMaterials, uploads } from "@/db/schema";
import {
  applyCaseStructure,
  checkStructureCoverage,
  repairStructure,
  ImportStructureError,
  caseRefNumbers,
  numberedLines,
  numberingIssues,
  parseMaterialsText,
  type CaseStructure,
} from "@/domain/import-parse";
import { renderFullText, matchRefMarkers } from "@/domain/case-format";
import { hostOf, isWithinAllowedSources } from "@/domain/source-whitelist";
import type { SourceRequirement, SourceType } from "@/domain/types";
import { importStructureSchema } from "@/domain/schemas";
import { getLlmProvider, LIGHT_MODEL } from "@/lib/llm/anthropic";
import * as P from "@/lib/llm/prompts";
import { newId } from "@/lib/ids";
import { loadVariant, UsageMeter, type StepContext } from "./common";
import { todayJst } from "@/domain/jst";

/** 出典のURLから資料の種類を推す */
export function guessSourceType(url: string | undefined, citation: string): SourceType {
  const host = url ? (hostOf(url) ?? "") : "";
  if (host.includes("e-gov.go.jp") || /法（|法律第|条/.test(citation)) return "law";
  if (host.includes("kokkai.ndl.go.jp") || /国会.*(委員会|本会議)/.test(citation)) return "diet_record";
  if (host.includes("e-stat.go.jp") || /統計|調査/.test(citation)) return "statistic";
  if (host.includes("courts.go.jp") || /(地裁|高裁|最高裁|判決)/.test(citation)) return "precedent";
  if (host.includes("jstage") || host.includes("nii.ac.jp") || host.endsWith("ac.jp")) return "paper";
  if (host.endsWith("go.jp")) return "govt_doc";
  if (/新聞/.test(citation)) return "news";
  return "org_doc";
}

export async function stepImport(ctx: StepContext) {
  const meter = new UsageMeter();
  const variant = await loadVariant(ctx.variantId);
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, ctx.params.uploadId ?? ""));
  if (!upload) throw new Error("登録したファイルが見つかりませんでした。");

  const structure = meter.add(
    await getLlmProvider().generateStructured({
      system:
        "あなたはディベート原稿の構造を読み取る補助です。本文を書き換えず、行番号だけを答えます。",
      prompt: P.importStructurePrompt(numberedLines(upload.caseText)),
      schema: importStructureSchema,
      model: LIGHT_MODEL,
      maxTokens: 8000,
    }),
  );
  // 本文が欠ける・重なる区切りは採用しない。ImportStructureError になり、ランナーが1回だけやり直す
  const repaired = repairStructure(upload.caseText, structure as CaseStructure);
  const coverage = checkStructureCoverage(upload.caseText, repaired);
  if (coverage.missingInside.length > 0 || coverage.overlapping.length > 0) {
    const lines = upload.caseText.replace(/\r\n?/g, "\n").split("\n");
    const sample = [...coverage.missingInside, ...coverage.overlapping]
      .slice(0, 2)
      .map((i) => `「${lines[i].trim().slice(0, 30)}」`)
      .join("、");
    throw new ImportStructureError(
      `原稿の区切りを読み取れませんでした（${sample} の行を本文に正しく入れられません）。見出し（Ⅰ・Ⅱ・（1）など）の書き方を確認してください。`,
    );
  }
  const debateCase = applyCaseStructure(upload.caseText, repaired, variant.side, newId);
  debateCase.fullText = renderFullText(debateCase);

  // 資料ファイル → 資料の実体と参照
  const blocks = upload.materialsText ? parseMaterialsText(upload.materialsText) : null;
  const refs: SourceRequirement[] = [];
  // 再実行に備え、この立論に紐づいていた資料の実体を消してから作る
  for (const ref of variant.sourceRefs) {
    await db.delete(sourceMaterials).where(eq(sourceMaterials.id, ref.materialId));
  }
  const today = todayJst();
  for (const b of blocks ?? []) {
    if (refs.some((r) => r.number === b.number)) continue; // 番号の重複は指摘に回す
    const materialId = newId("mat");
    await db.insert(sourceMaterials).values({
      id: materialId,
      projectId: variant.projectId,
      provesWhat: b.title,
      sourceType: guessSourceType(b.url, b.citation),
      // 自作の資料は AI 生成物ではない。本人が作ったものとして確認済で持つ
      status: "verified",
      origin: "uploaded",
      citation: b.citation || null,
      // 本文のない資料（出典だけ）の引用欄は空にする。出典と同じ文を二重に出さない
      quote: b.body || null,
      url: b.url ?? null,
      sourceDomain: b.url ? hostOf(b.url) : null,
      lastCheckedAt: b.lastCheckedAt ?? null,
      withinAllowedSources: isWithinAllowedSources(b.url),
      verifiedAt: today,
    });
    refs.push({
      id: newId("ref"),
      number: b.number,
      materialId,
      supportsClaimIds: [],
      categoryIds: [],
      description: "",
      searchKeywords: [],
      suggestedSourceIds: [],
      formatHint: "quote",
    });
  }
  refs.sort((a, b) => a.number - b.number);

  // 段落 → 参照している資料
  for (const s of debateCase.sections) {
    for (const c of s.subsections) {
      const nums = [...matchRefMarkers(c.claim)].map((m) => m.number);
      for (const n of new Set(nums)) {
        const ref = refs.find((r) => r.number === n);
        if (!ref) continue;
        c.sourceRefIds.push(ref.id);
        ref.supportsClaimIds.push(c.id);
      }
    }
  }

  const issues = numberingIssues(upload.caseText, blocks);
  if (upload.materialsText && /^[\s　.．]*Ⅰ\s*[.．、]?\s*関連法令/m.test(upload.materialsText)) {
    issues.push({
      severity: "warning",
      message:
        "資料ファイルの「Ⅰ. 関連法令」には資料番号がないため、資料としては取り込んでいません（条文は立論の中の表記のまま残ります）。",
    });
  }
  if (coverage.outside.length > 0) {
    // 題名・チーム名など、主張の前・結論の後の行は本文に含めない。黙って落とさず知らせる
    issues.push({
      severity: "warning",
      message: `次の行は立論の本文（Ⅰ主張〜Ⅲ結論）の外にあるため、読み上げ時間に含めていません: ${coverage.outside
        .slice(0, 3)
        .map((l) => `「${l.slice(0, 30)}」`)
        .join("、")}${coverage.outside.length > 3 ? ` ほか${coverage.outside.length - 3}行` : ""}`,
    });
  }
  const used = caseRefNumbers(upload.caseText);
  if (used.length === 0 && blocks && blocks.length > 0) {
    issues.push({
      severity: "warning",
      message: "立論の中に【資料N参照】（または（資料N））の表記が見つかりませんでした。資料との対応が付けられません。",
    });
  }

  await db
    .update(caseVariants)
    .set({ debateCase, sourceRefs: refs })
    .where(eq(caseVariants.id, variant.id));
  await db.update(uploads).set({ issues }).where(eq(uploads.id, upload.id));
  return meter.total;
}
