/**
 * 生成プロンプト: 質疑・最終弁論の雛形・特徴と戦い方（v6 要件 §4〜§7）
 */

import { ATTACK_POINT_LABELS, type AttackPoint } from "@/domain/types";
import { categoryInstruction } from "./prompts";

const ATTACK_POINT_GUIDE = `
攻撃点（attackPoint）:
- premise（前提）: 相手が当然視している前提・定義を疑う
- evidence（根拠）: 資料の射程・古さ・代表性・出典の性質を突く
- causality（因果）: 「AだからB」の飛躍を突く
- impact（効果）: 仮に正しくても論題の判断を変えないと示す
- numbers（数字の使い方）: 数字の比較の前提・期間の切り取り・相関と因果の混同を突く
`.trim();

/** 質疑の連鎖の出力形。段落ごとに呼ぶ */
const CHAIN_OUTPUT = `
出力するJSON:
{
  "chains": [
    {
      "attackPoint": "premise|evidence|causality|impact|numbers",
      "goal": "この連鎖で相手に認めさせたい結論",
      "priority": 1〜5（5=試合で必ず使うべき）,
      "categoryNames": ["争点カテゴリ名"],
      "nodes": [
        {
          "key": "n1",
          "question": "質問文（本番でそのまま読める短さ。1文、長くても60字程度）",
          "purpose": "この質問の意図",
          "modelAnswer": "立論側の模範回答（守る側が準備しておく答え。2文以内）",
          "branches": [
            { "kind": "admit", "expectedAnswer": "認めた場合の回答", "followUpKey": "n2", "exposedWeakness": "露呈する弱点" },
            { "kind": "deny", "expectedAnswer": "否定した場合の回答", "followUpKey": "n3" },
            { "kind": "evade", "expectedAnswer": "はぐらかした場合の回答", "followUpKey": "n4" }
          ]
        }
      ]
    }
  ]
}
`.trim();

const CHAIN_RULES = `
【作り方】
- 単発の質問（nodes が1つ）と、**質問を重ねて詰める連鎖**（起点 → 回答に応じた次の質問 → … → 結論）の両方を作る
- 連鎖では、各質問に認める（admit）／否定する（deny）／はぐらかす（evade）の分岐を用意し、
  どう答えられても goal に向かって追及が続くようにする。1つの連鎖は最大3段・7ノードまで
- followUpKey は同じ連鎖の中の key だけを指す。循環させない。終端は followUpKey を省略
- 質問は「はい／いいえ」か短い答えで返せる形にする（質疑は8分しかない）
- modelAnswer は、この立論を守る側が言うべき模範回答。相手の狙いをかわしつつ立論と矛盾しないこと
- 逆質問（質問に質問で返す）を模範回答にしないこと（審査で減点されます）
`.trim();

export function crossExamParagraphPrompt(ctx: {
  resolution: string;
  caseText: string;
  paragraphLabel: string;
  paragraphText: string;
  attackPoints: AttackPoint[];
  numberIssues: string[];
  categories: string[];
  existingQuestions: string[];
  count: string;
}): string {
  return `
政策ディベートの質疑を設計します。次の立論の、指定した段落を突く質疑を作ってください。
作った質疑は「相手側から見れば攻める質疑」「立論側から見れば受ける質疑と回答準備」として両面で使います。

論題: ${ctx.resolution}

立論（全体）:
${ctx.caseText}

突く段落: ${ctx.paragraphLabel}
${ctx.paragraphText}

${ATTACK_POINT_GUIDE}

この段落で**必ず1つ以上**作る攻撃点: ${ctx.attackPoints.map((a) => `${a}（${ATTACK_POINT_LABELS[a]}）`).join("、")}
${
  ctx.numberIssues.length > 0
    ? `\nこの段落の数字には次の弱点が見つかっています。**numbers の質疑で必ず突いてください**:\n${ctx.numberIssues.map((n) => `- ${n}`).join("\n")}\n`
    : ""
}
${
  ctx.existingQuestions.length > 0
    ? `\n既にある質問（**同じ趣旨の質問は作らない**）:\n${ctx.existingQuestions.map((q) => `- ${q}`).join("\n")}\n`
    : ""
}
分量: ${ctx.count}

${CHAIN_RULES}

${categoryInstruction(ctx.categories)}

${CHAIN_OUTPUT}
`.trim();
}

export function closingPrompt(ctx: {
  resolution: string;
  sideLabel: string;
  opponentSideLabel: string;
  caseText: string;
  chains: { chainId: string; paragraph: string; goal: string; question: string; admit: string; deny: string }[];
  weaknesses: string[];
}): string {
  return `
最終弁論（1分・約320字）の雛形を、この立論について2通り作ってください。
最終弁論は「質疑を踏まえる」ことが求められ、主張の繰り返しや新しい論点は減点されます。
そのため、質疑の結果を差し込む**空欄つきの枠**と、主な経路ごとの**記入例**を作ります。

論題: ${ctx.resolution}

この立論（${ctx.sideLabel}）:
${ctx.caseText}

この立論に対する主な質疑の連鎖（相手側が攻める流れ）:
${ctx.chains
  .map(
    (c) =>
      `- [${c.chainId}] ${c.paragraph}／狙い: ${c.goal}\n  起点の質問: ${c.question}\n  認めた場合: ${c.admit}\n  否定した場合: ${c.deny}`,
  )
  .join("\n")}

この立論の弱点:
${ctx.weaknesses.map((w) => `- ${w}`).join("\n") || "- （特になし）"}

作るもの:
1. own（${ctx.sideLabel}＝この立論で戦うチームの最終弁論）
   質疑で立論の柱が守られたこと、相手の攻撃が当たらなかった理由、相手立論との比較を、空欄に差し込む形にする
2. opponent（${ctx.opponentSideLabel}＝この立論と戦うチームの最終弁論）
   質疑で相手が認めたこと・答えられなかったことを空欄に差し込み、それが相手立論のどこを崩すかを示す形にする

【厳守】
- frame は約320字（1分）。空欄は【①相手が認めたこと】のように【番号＋何を書くか】で示す。空欄は3〜5個
- blanks には空欄ごとの説明と、何を書けばよいかのヒント
- examples は、上の連鎖の主な経路（認めた場合・否定した場合など）ごとに3〜4個。空欄を埋めた完成文で、各300〜340字
  chainId には対応する連鎖の [ ] 内の値を入れる
- 新しい論点を持ち込まないこと。立論の文言の繰り返しにしないこと
- 数値を新しく書かないこと

出力するJSON:
{
  "own": {
    "frame": "…【①…】…【②…】…",
    "blanks": [ { "key": "①", "label": "…", "hint": "…" } ],
    "examples": [ { "pathLabel": "相手が(1)の前提を認めた場合", "chainId": "…", "text": "…" } ]
  },
  "opponent": { "frame": "…", "blanks": [ … ], "examples": [ … ] }
}
`.trim();
}

export function strategyPrompt(ctx: {
  resolution: string;
  sideLabel: string;
  caseText: string;
  numberFindings: string[];
  topChains: { paragraph: string; goal: string; priority: number }[];
  materialNotes: string[];
}): string {
  return `
次の立論の「特徴」と「この立論で戦うときの方針」を、ゼミ生が試合前に読んで使える形でまとめてください。

論題: ${ctx.resolution}
立場: ${ctx.sideLabel}

立論:
${ctx.caseText}

数字の検査で見つかった点:
${ctx.numberFindings.map((f) => `- ${f}`).join("\n") || "- （なし）"}

資料についての注意:
${ctx.materialNotes.map((f) => `- ${f}`).join("\n") || "- （なし）"}

相手に突かれやすい質疑（優先度の高い順）:
${ctx.topChains.map((c) => `- ${c.paragraph}: ${c.goal}（優先度${c.priority}）`).join("\n") || "- （なし）"}

出力するJSON:
{
  "summary": "この立論の特徴を2〜3文で（どんな枠組みで、何を柱に戦う立論か）",
  "strengths": ["柱になる論点・強み（3〜5個）"],
  "weaknesses": [ { "point": "突かれやすい箇所", "why": "なぜ弱いか・どう突かれるか" } ],
  "defend": ["質疑で守るところ（どう答えれば崩れないか）"],
  "neverConcede": ["譲ってはいけないこと（認めると立論が崩れる点）"],
  "winningPath": "最終弁論で何を勝ち筋にするか（2〜3文）",
  "howToAttack": ["相手としてこの立論と戦うときの攻め筋（3〜5個）"]
}
`.trim();
}
