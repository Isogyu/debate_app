/**
 * 資料取得の試験（実装計画 §6.3）。実際の情報源に繋いで、資料5本がどこまで取れるかを測る。
 *
 * 公的サイトに繋がる環境（Fly.io のマシン上か、自分のPC）で実行する:
 *
 *   ANTHROPIC_API_KEY=... ESTAT_APP_ID=... npm run spike:sources
 *
 * Fly.io 上で:  fly ssh console -C "npm run spike:sources"
 *
 * 一時フォルダのDBを使うので、本番のデータには触れない。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DEBATE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "debate-spike-"));

const CASES = [
  {
    provesWhat: "所得税法56条は、生計を一にする親族に支払う対価を必要経費に算入しないと定めている",
    sourceType: "law" as const,
    plan: { lawName: "所得税法", article: "第56条", whatToExtract: "条文全文" },
    keywords: ["所得税法", "56条"],
  },
  {
    provesWhat: "女性就業者に占める家族従業者の割合は大きく減少している",
    sourceType: "statistic" as const,
    plan: {
      statKeywords: ["労働力調査", "従業上の地位", "女"],
      statisticSteps: ["女性の就業者総数と家族従業者数を取る", "家族従業者÷就業者総数×100で割合を出す"],
      whatToExtract: "女性の家族従業者数と就業者総数",
    },
    keywords: ["家族従業者", "女性"],
  },
  {
    provesWhat: "56条の趣旨は、親族間の恣意的な所得分割による租税回避の防止にあると政府が答弁している",
    sourceType: "diet_record" as const,
    plan: { whatToExtract: "56条の趣旨を述べた政府答弁" },
    keywords: ["所得税法第五十六条", "趣旨"],
  },
  {
    provesWhat: "税務行政はデジタル化により事務の効率化を進めている",
    sourceType: "govt_doc" as const,
    plan: { webQuery: "国税庁 税務行政の将来像 デジタル・トランスフォーメーション", whatToExtract: "デジタル化で事務を効率化するという記述" },
    keywords: ["税務行政", "デジタル"],
  },
  {
    provesWhat: "所得税法56条の立法趣旨と、その合理性をめぐる学説",
    sourceType: "paper" as const,
    plan: { webQuery: "所得税法56条 立法趣旨 親族", whatToExtract: "56条の立法趣旨を説明している一節" },
    keywords: ["所得税法56条", "親族"],
  },
];

async function main() {
  await import("../src/db/migrate");
  const { acquireMaterial, FetchBudget } = await import("../src/lib/sources/acquire");
  const { UsageMeter } = await import("../src/lib/jobs/common");
  const meter = new UsageMeter();
  const budget = new FetchBudget(60);
  let ok = 0;
  for (const c of CASES) {
    const started = Date.now();
    const result = await acquireMaterial(
      {
        provesWhat: c.provesWhat,
        sourceType: c.sourceType,
        ref: {
          id: "r", number: 1, materialId: "m", supportsClaimIds: [], categoryIds: [],
          description: "", searchKeywords: c.keywords, suggestedSourceIds: [], formatHint: "quote",
          plan: c.plan,
        },
      },
      meter,
      budget,
    );
    const sec = Math.round((Date.now() - started) / 1000);
    if (result.kind === "acquired") {
      ok++;
      console.log(`\n✓ [${c.sourceType}] ${c.provesWhat}（${sec}秒）`);
      console.log(`  出典: ${result.citation}`);
      console.log(`  URL : ${result.url}`);
      console.log(`  引用: ${result.quote.slice(0, 160).replace(/\n/g, " ")}${result.quote.length > 160 ? "…" : ""}`);
    } else {
      console.log(`\n✗ [${c.sourceType}] ${c.provesWhat}（${sec}秒）`);
      for (const r of result.reasons) console.log(`  理由: ${r}`);
    }
  }
  console.log(`\n取得できた資料: ${ok} / ${CASES.length}`);
  console.log(`AIの使用量: 入力 ${meter.total.inputTokens} / 出力 ${meter.total.outputTokens} トークン`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
