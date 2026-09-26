/**
 * 生成プロンプト: 資料の計画・取得・数字の検査（v6 要件 §1-3・§1-9・§3.4）
 *
 * AI の役割は「選ぶ」ことだけ。引用文は本文から**そのまま**抜き出させ、
 * 一致はコードで検査する。統計の数値は行のキーで指させ、値はコードが入れる。
 */

import { whitelistForPrompt } from "@/domain/source-whitelist";
import { categoryInstruction } from "./prompts";

export function sourcePlanPrompt(
  resolution: string,
  caseText: string,
  slotsJson: string,
  categories: string[],
): string {
  return `
立論が必要としている資料それぞれについて、「どこから・何を取れば証明できるか」の計画を立ててください。
この計画をもとに、アプリが公的な情報源（e-Gov・国会会議録・e-Stat・官公庁・裁判所・CiNii/J-STAGE）
から実物を取得します。取得できなかった場合は、この計画がそのままゼミ生向けの「作成手順」になります。

論題: ${resolution}

立論:
${caseText}

必要な資料（本文の【資料N参照】の N と、証明すべき命題）:
${slotsJson}

情報源のID:
${whitelistForPrompt()}

${categoryInstruction(categories)}

出力するJSON（slot は渡された値をそのまま返す）:
{
  "requirements": [
    {
      "slot": "1",
      "provesWhat": "この資料が証明する命題（資料のタイトルになる）",
      "sourceType": "law|precedent|statistic|paper|govt_doc|diet_record|book",
      "description": "なぜこの箇所にこの資料が必要か",
      "searchKeywords": ["検索欄にそのまま入れる語"],
      "suggestedSourceIds": ["情報源のID"],
      "formatHint": "quote|chart|table|law_text",
      "categoryNames": ["争点カテゴリ名"],
      "lawName": "法令のとき: 正式な法令名（例: 所得税法）",
      "article": "法令のとき: 条（例: 第56条）",
      "statKeywords": ["統計のとき: e-Stat で統計表を探す語（統計名＋表の内容。例: 就業構造基本調査 従業上の地位 女性）"],
      "statisticSteps": ["統計のとき: 取り出す数値と計算の手順を1手ずつ"],
      "webQuery": "官公庁資料・判例・論文のとき: 検索語（組織名・文書名・事件名を含める）",
      "whatToExtract": "見つけた資料から、何を抜き出せば命題の証明になるか"
    }
  ]
}

注意:
- 数値で示したい命題は sourceType を statistic にし、statKeywords と statisticSteps を必ず書いてください
- 法解釈・制度趣旨・学説を示す資料は paper（CiNii/J-STAGE）か govt_doc（審議会・税制調査会の資料）にしてください
- 国会での政府答弁・立法趣旨は diet_record にしてください
- 使わない項目は省略して構いません
`.trim();
}

/**
 * 取得した本文から引用箇所を選ばせる。
 * 一字一句そのまま抜き出させ、アプリ側で本文との一致を検査する。
 */
export function pickQuotePrompt(
  provesWhat: string,
  whatToExtract: string,
  documentTitle: string,
  excerpt: string,
): string {
  return `
次の文書の本文から、命題を証明する箇所を**本文の文字列そのまま**抜き出してください。

証明したい命題: ${provesWhat}
抜き出したいもの: ${whatToExtract}
文書: ${documentTitle}

--- 本文（抜粋） ---
${excerpt}
--- ここまで ---

【厳守】
- quote は本文にある文字列を**一字一句そのまま**写すこと。要約・言い換え・語順の変更・「…」での省略は禁止
  （アプリが本文と照合し、一致しなければ採用しません）
- 長さは40〜400字。文の途中で切らず、句点までを含める
- 命題を証明する箇所が本文にない場合は found を false にする（無理に選ばない）

出力するJSON:
{ "found": true, "quote": "本文そのままの抜き出し", "why": "この箇所が命題を証明する理由を一文で" }
`.trim();
}

export function pickSpeechPrompt(
  provesWhat: string,
  whatToExtract: string,
  speeches: { index: number; header: string; excerpt: string }[],
): string {
  return `
国会会議録の発言から、命題を証明する発言を1つ選び、その発言の本文から引用箇所を抜き出してください。

証明したい命題: ${provesWhat}
抜き出したいもの: ${whatToExtract}

${speeches
  .map((s) => `[${s.index}] ${s.header}\n${s.excerpt}`)
  .join("\n\n")}

【厳守】
- quote は発言の本文を**一字一句そのまま**写すこと（照合して一致しなければ採用しません）
- 40〜400字。命題を証明する発言がなければ found を false にする

出力するJSON:
{ "found": true, "index": 0, "quote": "発言そのままの抜き出し", "why": "理由を一文で" }
`.trim();
}

export function pickStatTablePrompt(
  provesWhat: string,
  steps: string[],
  tables: { id: string; statName: string; title: string; surveyDate: string; govOrg: string }[],
): string {
  return `
次の e-Stat の統計表の中から、命題を数値で示すのに最も適した表を1つ選んでください。

証明したい命題: ${provesWhat}
計算の手順（計画）:
${steps.map((s) => `- ${s}`).join("\n") || "- （なし）"}

統計表:
${tables.map((t) => `- id=${t.id} ／ ${t.govOrg}「${t.statName}」${t.title}（調査年月 ${t.surveyDate}）`).join("\n")}

適した表がなければ found を false にしてください。

出力するJSON:
{ "found": true, "tableId": "上の id をそのまま", "why": "選んだ理由" }
`.trim();
}

/**
 * 統計表の行から、使う値と計算を選ばせる。値そのものは書かせない（行キーで指す）。
 */
export function buildStatisticPrompt(
  provesWhat: string,
  steps: string[],
  tableTitle: string,
  rows: { key: string; label: string; value: string; unit: string }[],
): string {
  return `
統計表「${tableTitle}」の行から、命題を示すのに使う値と計算を選んでください。

証明したい命題: ${provesWhat}
計算の手順（計画）:
${steps.map((s) => `- ${s}`).join("\n") || "- （なし）"}

行（key: 分類 = 値 単位）:
${rows.map((r) => `${r.key}: ${r.label} = ${r.value} ${r.unit}`).join("\n")}

【厳守】
- 値は書かないこと。行は key（r12 など）で指すこと。値はアプリが表から入れます
- operation は ratio（A÷B）/ percent（A÷B×100）/ growth（(A−B)÷B×100）/ difference（A−B）/
  per_capita（A÷B）/ share（A÷B×100）のどれか
- formulas の a・b には inputs の key か、前の formulas の key を書く
- 表の値だけで命題を示せるなら formulas は空でよい
- 命題を示せる行がなければ found を false にする

出力するJSON:
{
  "found": true,
  "inputs": [ { "key": "x1", "row": "r12", "label": "2022年 女性就業者のうち家族従業者" } ],
  "formulas": [ { "key": "f1", "label": "家族従業者の割合", "operation": "percent", "a": "x1", "b": "x2", "unit": "%" } ],
  "chart": { "type": "bar|line", "title": "グラフの題", "points": ["x1","x2","f1 などグラフに出す key"] },
  "tableRows": ["表に載せる行の key（r12 など）"],
  "summary": "この資料が示すことを一文で（数値は書かない）"
}
`.trim();
}

/** 数字の使い方の妥当性（§1-9 第4観点） */
export function numberUsagePrompt(
  caseText: string,
  mentions: { location: string; text: string; sentence: string; source: string }[],
): string {
  return `
次の立論で使われている数字について、「その数字が主張を本当に支えているか」を点検してください。
相手チームの質疑で突かれる危険を見つけるのが目的です。

立論:
${caseText}

数字と、その出典:
${mentions.map((m, i) => `[${i}] ${m.location}: 「${m.text}」— ${m.sentence}（出典: ${m.source}）`).join("\n")}

観点:
- 相関と因果の混同（数字は関係を示すだけなのに、原因だと言っていないか）
- 期間の切り取り（都合のよい年だけを選んでいないか）
- 母数の違い（比べている集団の定義が違わないか）
- 平均で隠れる分布（一部の極端な値で平均が動いていないか）
- 数字の古さ・対象範囲（全国か一部か）

問題がないものは出力しないでください。

出力するJSON:
{
  "findings": [
    { "index": 0, "severity": "high|medium|low", "message": "何が危ないか、相手にどう突かれるか（2文以内）" }
  ]
}
`.trim();
}
