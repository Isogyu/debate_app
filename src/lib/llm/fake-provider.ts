/**
 * 作り物の AI（テスト・画面の通し確認用）。
 *
 * 本物の API を呼ばずに、スキーマごとに固定の出力を返す。
 *  - scripts/smoke-pipeline.ts（生成パイプラインの通し確認）
 *  - DEBATE_FAKE_LLM=1 で起動したサーバー（画面の通し確認）。Fly.io 上では使えない
 */

import * as S from "@/domain/schemas";
import type { LlmProvider, StructuredRequest } from "./provider";

/** 行番号付きの原稿から、見出しの形で区切りを推定する（作り物の AI 用） */
function guessStructure(prompt: string) {
  const lines = [...prompt.matchAll(/^(\d+): (.*)$/gm)].map((m) => ({ n: Number(m[1]), t: m[2].trim() }));
  const find = (re: RegExp, from = 0) => lines.find((l) => l.n >= from && re.test(l.t))?.n ?? -1;
  const claimHead = find(/^[Ⅰ]/);
  const reasonHead = find(/^[Ⅱ]/);
  const conclHead = find(/^[ⅢⅣ]/);
  const last = lines.length ? lines[lines.length - 1].n : 0;
  const content = (a: number, b: number) => lines.filter((l) => l.n >= a && l.n <= b && l.t).map((l) => l.n);
  const claimLines = content(claimHead + 1, reasonHead - 1);
  const secHeads = lines.filter((l) => l.n > reasonHead && l.n < conclHead && /^[0-9０-９]+[.．]/.test(l.t)).map((l) => l.n);
  const sections = secHeads.map((h, i) => {
    const end = (secHeads[i + 1] ?? conclHead) - 1;
    const subHeads = lines.filter((l) => l.n > h && l.n <= end && /^[（(][0-9０-９]+[)）]/.test(l.t)).map((l) => l.n);
    const subs = subHeads.length
      ? subHeads.map((sh, j) => {
          const c = content(sh + 1, (subHeads[j + 1] ?? end + 1) - 1);
          return { titleLine: sh, body: [c[0] ?? sh, c[c.length - 1] ?? sh] as [number, number] };
        })
      : (() => {
          const c = content(h + 1, end);
          return [{ titleLine: h, body: [c[0] ?? h, c[c.length - 1] ?? h] as [number, number] }];
        })();
    return { titleLine: h, type: "criteria" as const, subsections: subs };
  });
  const concl = content(conclHead + 1, last);
  return {
    claim: [claimLines[0] ?? claimHead, claimLines[claimLines.length - 1] ?? claimHead],
    sections,
    conclusion: [concl[0] ?? conclHead, concl[concl.length - 1] ?? conclHead],
  };
}

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
  if (s === S.importStructureSchema) return guessStructure(req.prompt);
  if (s === S.claimRegenerationSchema) return { claim: "書き直した本文である【資料1参照】。", warrant: "理由。", causalChain: [], impact: "効果。" };
  if (s === S.simulatorReplySchema) return { reply: "その点については、立論の(1)で述べたとおりです。前提は維持されます。" };
  if (s === S.simulatorFeedbackSchema)
    return { strengths: ["質問が短い"], weaknesses: ["結論に結びつけていない"], suggestions: ["「つまり〜ということですね」と確認する"], summary: "全体として落ち着いていた。", chains: [], stuckKeys: [], newQuestions: [], closingExample: "質疑で相手は前提を認めた。" };
  if (s === S.pickSpeechSchema || s === S.pickQuoteSchema || s === S.pickStatTableSchema) return { found: false };
  throw new Error("想定していないスキーマです");
}

export const fakeProvider: LlmProvider = {
  name: "fake",
  async generateStructured(req) {
    return { data: req.schema.parse(fake(req as StructuredRequest<unknown>)), usage: { inputTokens: 1, outputTokens: 1, model: "fake" } };
  },
  async searchWeb() {
    return { data: [], usage: { inputTokens: 0, outputTokens: 0, model: "fake" } };
  },
};

