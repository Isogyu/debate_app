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
import * as S from "../src/domain/schemas";
import { setLlmProvider } from "../src/lib/llm/anthropic";
import type { LlmProvider, StructuredRequest } from "../src/lib/llm/provider";

const para = (t: string) =>
  `${t}について、制度の趣旨と現状を比較すると、見直しが必要であるといえる【資料s1参照】。` +
  "家族経営の実態は大きく変化しており、一律の規制は合理性を失っている。".repeat(4);

function fake(req: StructuredRequest<unknown>): unknown {
  const s = req.schema as unknown;
  if (s === S.analysisOutputSchema)
    return {
      policyChange: "所得税法56条を廃止する", statusQuo: "親族への対価は必要経費にならない",
      relatedLaws: [{ name: "所得税法", article: "第56条" }], stakeholders: ["個人事業主"], coreIssues: ["公平"],
      categories: [{ name: "担税力", description: "" }, { name: "租税回避", description: "" }],
      frameworks: { affirmative: { name: "租税公平主義", criteria: ["担税力", "公平"] }, negative: { name: "税の基本原則", criteria: ["公平", "簡素"] } },
    };
  if (s === S.caseOutlineOutputSchema)
    return {
      side: "affirmative", framework: "租税公平主義", approach: "環境変化型", valuePremise: "公平", claim: "56条を廃止するべきである。",
      sections: [{ title: "租税公平主義から見た問題点", type: "criteria", subsectionTitles: ["担税力", "公平"] }, { title: "社会の変化", type: "environment", subsectionTitles: ["家族経営の変化"] }],
      conclusion: "以上より、廃止するべきである。",
    };
  if (s === S.caseBodyOutputSchema)
    return {
      sections: [
        { title: "租税公平主義から見た問題点", type: "criteria", subsections: [
          { title: "担税力", claim: para("担税力") + "家族従業者は約61%であった。", warrant: "理由。", causalChain: ["a", "b"], impact: "効果。", categoryNames: ["担税力"], refSlots: [{ slot: "s1", provesWhat: "家族従業者の割合が減少した", kind: "statistic" }] },
          { title: "公平", claim: para("公平").replace("s1", "s2"), warrant: "理由。", causalChain: [], impact: "効果。", categoryNames: ["担税力"], refSlots: [{ slot: "s2", provesWhat: "56条の立法趣旨", kind: "diet_record" }] },
        ] },
        { title: "社会の変化", type: "environment", subsections: [
          { title: "家族経営の変化", claim: para("家族経営").replace("s1", "s3"), warrant: "理由。", causalChain: [], impact: "効果。", categoryNames: [], refSlots: [{ slot: "s3", provesWhat: "所得税法56条の条文", kind: "law" }] },
        ] },
      ],
    };
  if (s === S.lengthAdjustSchema) return { paragraphs: [] };
  if (s === S.sourcePlanSchema)
    return { requirements: ["1", "2", "3"].map((slot) => ({ slot, provesWhat: `命題${slot}`, sourceType: slot === "1" ? "statistic" : slot === "2" ? "diet_record" : "law", description: "", searchKeywords: ["家族従業者"], suggestedSourceIds: ["estat", "bogus"], formatHint: "quote", categoryNames: [], lawName: "所得税法", article: "第56条", statKeywords: ["労働力調査"], statisticSteps: ["割合を出す"], whatToExtract: "一節" })) };
  if (s === S.paragraphTextSchema) return { claim: "家族経営の実態は大きく変化している【資料1参照】。", warrant: "理由。", impact: "効果。" };
  if (s === S.numberUsageSchema) return { findings: [] };
  if (s === S.crossExamChainsSchema)
    return { chains: [
      { attackPoint: "premise", goal: "前提を崩す", priority: 5, categoryNames: ["担税力"], nodes: [
        { key: "n1", question: "制度の前提は今も成り立ちますか？", purpose: "前提", modelAnswer: "成り立ちます。", branches: [{ kind: "admit", expectedAnswer: "はい", followUpKey: "n2" }, { kind: "deny", expectedAnswer: "いいえ" }] },
        { key: "n2", question: "では根拠は？", purpose: "根拠", modelAnswer: "資料1です。", branches: [{ kind: "evade", expectedAnswer: "…", followUpKey: "n1" }] },
      ] },
      ...["evidence", "causality", "impact", "numbers"].map((ap) => ({ attackPoint: ap, goal: "g", priority: 3, categoryNames: [], nodes: [{ key: "k", question: `${ap}の質問`, purpose: "", modelAnswer: "答え", branches: [] }] })),
    ] };
  if (s === S.closingSchema) {
    const p = { frame: "質疑で相手は【①】を認めた。", blanks: [{ key: "①", label: "認めたこと", hint: "" }], examples: [{ pathLabel: "認めた場合", chainId: "bogus", text: "例文" }] };
    return { own: p, opponent: p };
  }
  if (s === S.strategySchema) return { summary: "特徴", strengths: ["強み"], weaknesses: [{ point: "弱点", why: "理由" }], defend: ["守る"], neverConcede: ["譲らない"], winningPath: "勝ち筋", howToAttack: ["攻め筋"] };
  if (s === S.importStructureSchema) return { claim: [1, 1], sections: [{ titleLine: 3, type: "criteria", subsections: [{ titleLine: 3, body: [4, 4] }] }], conclusion: [6, 6] };
  if (s === S.pickSpeechSchema || s === S.pickQuoteSchema || s === S.pickStatTableSchema) return { found: false };
  throw new Error("想定していないスキーマです");
}

const provider: LlmProvider = {
  name: "fake",
  async generateStructured(req) {
    return { data: req.schema.parse(fake(req as StructuredRequest<unknown>)), usage: { inputTokens: 1, outputTokens: 1, model: "fake" } };
  },
  async searchWeb() {
    return { data: [], usage: { inputTokens: 0, outputTokens: 0, model: "fake" } };
  },
};

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
