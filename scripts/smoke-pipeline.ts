/**
 * 生成パイプラインの通し確認（AIの応答は作り物）。
 *
 *   DEBATE_DATA_DIR=/tmp/smoke npx tsx --conditions=react-server scripts/smoke-pipeline.ts
 *
 * AI の出力をスキーマごとに固定の値で返し、テーマ登録 → 分析 → 生成（各側1本）→
 * 登録（テキスト）→ 質疑の追加 までを流して、各ステップが通ることを確かめる。
 * 外部サイトには繋がらない前提（資料はすべて「作成手順」になる）。
 */

import fs from "node:fs";
import { eq } from "drizzle-orm";
import { setLlmProvider } from "../src/lib/llm/anthropic";
import { fakeProvider as provider } from "../src/lib/llm/fake-provider";

async function waitJobs(db: typeof import("../src/db").db, jobs: typeof import("../src/db/schema").generationJobs) {
  for (let i = 0; i < 300; i++) {
    const rows = await db.select().from(jobs);
    if (rows.length > 0 && rows.every((r) => r.status !== "running" && r.status !== "queued")) return rows;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("ジョブが終わりません");
}

async function main() {
  const dir = process.env.DEBATE_DATA_DIR!;
  fs.rmSync(dir, { recursive: true, force: true });
  await import("../src/db/migrate");
  setLlmProvider(provider);
  const { db } = await import("../src/db");
  const T = await import("../src/db/schema");
  const O = await import("../src/lib/jobs/orchestrate");

  const projectId = await O.createTheme({ resolution: "日本は所得税法第56条を廃止すべきである", reviewAnalysis: false, userId: "u1" });
  let rows = await waitJobs(db, T.generationJobs);
  await new Promise((r) => setTimeout(r, 500));
  rows = await waitJobs(db, T.generationJobs);
  console.log("ジョブ:", rows.map((r) => `${r.kind}=${r.status}${r.steps.filter((s) => s.status === "failed").map((s) => ` ✗${s.step}:${s.error}`).join("")}`).join(" / "));

  const variants = await db.select().from(T.caseVariants).where(eq(T.caseVariants.projectId, projectId));
  for (const v of variants) {
    console.log(`立論 ${v.side} ${v.origin} label=${v.label} 段落=${v.debateCase.sections.flatMap((s) => s.subsections).length} warning=${v.lengthWarning ?? "-"}`);
    console.log("  本文に数字:", /61%/.test(v.debateCase.fullText) ? "残っている（NG）" : "除かれた");
  }
  const mats = await db.select().from(T.sourceMaterials);
  console.log("資料:", mats.map((m) => `${m.sourceType}:${m.status}（${m.procedure?.reason?.slice(0, 40)}）whereToLook=${m.procedure?.whereToLook.length}`).join("\n  "));
  const nodes = await db.select().from(T.crossExamNodes);
  console.log("質疑:", nodes.length, "問 / 8分セット:", new Set(nodes.filter((n) => n.setOrder != null).map((n) => n.chainId)).size, "本");
  console.log("数字の指摘:", (await db.select().from(T.numberFindings)).map((f) => `${f.aspect}:${f.value}:${f.resolution ? "対応済" : "未"}`).join(" "));
  console.log("雛形:", (await db.select().from(T.closingTemplates)).length, "戦い方:", (await db.select().from(T.caseStrategies)).length);

  // 生成上限
  await O.startGeneration(projectId, "affirmative", "u1");
  await O.startGeneration(projectId, "affirmative", "u1");
  try {
    await O.startGeneration(projectId, "affirmative", "u1");
    console.log("上限: 4本目ができてしまった（NG）");
  } catch (e) {
    console.log("上限: 4本目は拒否 →", (e as Error).message);
  }
  // 生成中のテーマ変更
  try {
    await O.createTheme({ resolution: "別のテーマについて考える", reviewAnalysis: false, userId: "u1" });
    console.log("生成中のテーマ変更: できてしまった（NG）");
  } catch (e) {
    console.log("生成中のテーマ変更: 拒否 →", (e as Error).message);
  }
  await waitJobs(db, T.generationJobs);

  // 登録
  const caseText = ["Ⅰ　主張", "56条を廃止するべきである。", "Ⅱ　理由", "1. 担税力", "家族従業者は61.5％である（資料1）。出典のない数字は12%。", "Ⅲ　結論", "廃止するべきである。"].join("\n");
  const vid = await O.startImport({ projectId, side: "negative", label: "自作", userId: "u1", caseFileName: "a.txt", caseFilePath: "/dev/null", caseText, materialsText: "【資料1】\n日経新聞の記事\nhttps://www.nikkei.com/x\n（最終確認日：2025年1月1日）\n家族従業員が含まれる割合は61.5％である。" });
  await waitJobs(db, T.generationJobs);
  const [imp] = await db.select().from(T.caseVariants).where(eq(T.caseVariants.id, vid));
  const upl = await db.select().from(T.uploads);
  console.log("登録:", imp.debateCase.sections[0]?.subsections[0]?.claim, "/ 指摘:", upl[0].issues.map((i) => i.message).join(" "));
  console.log("登録の数字の指摘:", (await db.select().from(T.numberFindings).where(eq(T.numberFindings.variantId, vid))).map((f) => `${f.aspect}:${f.value}:${f.message.slice(0, 30)}`).join(" | "));

  const claimId = imp.debateCase.sections[0].subsections[0].id;
  await O.startMoreQuestions(vid, claimId, "u1");
  const done = await waitJobs(db, T.generationJobs);
  console.log("最終:", done.map((r) => `${r.kind}=${r.status}`).join(" "));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
