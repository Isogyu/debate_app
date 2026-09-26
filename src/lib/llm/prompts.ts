/**
 * 生成プロンプト: 共通部分と立論（v6 要件 §1・§3）
 *
 * 守らせる原則（v6 で改訂）:
 *  - 引用文・出典・条文・統計値を AI が「想像で」書かない。
 *    実在を確かめる作業はすべてコードが行い、AI には選択と構成だけをさせる
 *  - 立論本文に具体的な数値を書かせない。数値は取得した統計からコードで差し込む（§1-9）
 *  - 情報源はホワイトリストのIDから選ばせる
 */

import { whitelistForPrompt } from "@/domain/source-whitelist";
import {
  minAcceptableChars,
  speechBudgetChars,
  speechBudgetGuide,
} from "@/domain/speech";
import { exemplarFor } from "@/domain/exemplars";
import type { Side } from "@/domain/types";

export function sideLabel(side: Side): string {
  return side === "affirmative" ? "賛成側（肯定側）" : "反対側（否定側）";
}

const NEVER_FABRICATE = `
【厳守】捏造の禁止
- 実在の書籍・論文・統計・議事録の「引用文」や「出典」を自分で書いてはいけません。
  引用と出典は、アプリが公的な情報源から取得した本文から機械的に作ります。
- 法令の条文を書いてはいけません。法令名と条番号のみ示してください（条文は e-Gov から取得します）。
- 統計の数値（件数・割合・金額・倍率など）を自分で書いてはいけません。
  数値は、アプリが e-Stat から取得した値をコードで計算して差し込みます。
- 情報源は次のIDから選んでください。リストにないIDを作ってはいけません。
${whitelistForPrompt()}
`.trim();

export const SYSTEM_BASE = `
あなたは日本の大学の政策ディベート（競技ディベート）の指導者です。
法的・政策的な論証を、審査員に伝わる構造で組み立てます。

${NEVER_FABRICATE}
`.trim();

/** 実物の立論フォーマットをモデルに教える */
export const CASE_FORMAT_GUIDE = `
立論は次の構造に従います。

Ⅰ. 主張 … 論題に対する結論を一文で述べる（例:「所得税法56条および57条を廃止するべきである。」）
Ⅱ. 理由
  1. 評価基準フレームに基づく問題点または利点（フレームワーク名を見出しに含める）
     フレームワークの定義とその法的根拠を示したうえで、
     （1）（2）（3）… と評価基準ごとに「基準の定義 → 制度への適用評価 → 小結論」の順で論じる
  2. 第2ブロック。次のいずれかの型をとる
     - 環境変化型（賛成側で多い）: 社会変化・制度整備により「今こそ変えるべき」時宜性を論証する
     - 比較衡量型（反対側で多い）: 現行制度の利点と、変更によって得られる利益を比較衡量する
Ⅲ. 結論 … 以上より、と主張を繰り返す
  ※実物には「Ⅳ 再主張」と書くチームもあるが、このアプリでは
    **「Ⅲ. 結論」に統一**する。見出しを勝手に変えないこと

【厳守】見出しの書き方
見出しに番号を付けないでください（「1.」「Ⅱ-1.」「（1）」などを含めない）。
番号は表示・出力の側で自動的に付きます。
  悪い例: "Ⅱ-1. 租税公平主義から見た問題点" / "（1）担税力に即した課税"
  良い例: "租税公平主義から見た問題点" / "担税力に即した課税"

【厳守】資料参照の書き方
資料が必要な箇所には、**本文（claim）の中に** 【資料{slot}参照】と実際に書き込んだうえで、
その slot を refSlots に宣言してください。宣言だけして本文に書かないのは誤りです。
  例: claim に「…必要経費を控除している【資料s1参照】。」と書き、
      refSlots に { "slot": "s1", "provesWhat": "…", "kind": "govt_doc" } を入れる

【厳守】数値を書かない
統計値・割合・件数・金額を本文に書かないでください。
数値で示したい箇所は「家族従業者の割合は制定当時から大きく減少している【資料s2参照】」のように
**数値なしの文**で書き、refSlots の kind を "statistic" にしてください。
数値はアプリが取得した統計から、あとで本文に差し込みます。
`.trim();

/**
 * お手本の提示（few-shot）。真似させるのは構成・密度・分量だけ。
 */
function exemplarInstruction(side: Side, resolution: string): string {
  const ex = exemplarFor(side);
  return `
【お手本】
次は、実際の試合で使われた${side === "affirmative" ? "肯定" : "否定"}側の立論です。
生成物ではなく本物です。

--- ここからお手本 ---
${ex.text}
--- ここまでお手本 ---

このお手本から**真似るもの**:
- 構成の運び方（原則の提示 → 基準の定義 → 制度への当てはめ → 小結論）
- 一文の長さと密度。冗長な言い換えをせず、一文で一つのことを言う
- 分量。このお手本は読み上げ${ex.speechChars}字で、5分に収まる実例です

このお手本から**真似てはいけないもの**:
- 論点と内容。お手本は「${ex.resolution}」という**別の論題**のものです
- 「${resolution}」に固有の争点を、自分で考えて組み立ててください
- お手本の中の数値。お手本は人が資料から書いたものです。あなたは数値を書きません
`.trim();
}

export function analysisPrompt(resolution: string): string {
  return `
次の論題を分析してください。

論題: ${resolution}

出力するJSON:
{
  "policyChange": "この政策が変えるものを一文で",
  "statusQuo": "現状の制度を一文で",
  "relatedLaws": [{ "name": "法令名", "article": "第N条" }],
  "stakeholders": ["影響を受ける主体"],
  "coreIssues": ["この論題の中心的な争点"],
  "categories": [{ "name": "争点カテゴリ名", "description": "説明" }],
  "frameworks": {
    "affirmative": { "name": "枠組み名", "basisLaw": "根拠法令", "criteria": ["基準1","基準2"] },
    "negative":    { "name": "枠組み名", "basisLaw": "根拠法令", "criteria": ["基準1","基準2"] }
  }
}

注意:
- 賛成側と反対側で「異なる評価基準の枠組み」を採ることがあります。それぞれに最も有利な枠組みを選んでください。
- **criteria は短い語**にしてください（2〜8文字程度の名詞）。
- categories は質疑の整理軸になります。4〜8件、互いに重複しない粒度で。
`.trim();
}

export interface OutlineContext {
  resolution: string;
  side: Side;
  frameworkName: string;
  criteria: string[];
  secondBlockType: "environment" | "comparison";
  /** 同じ側に既にある立論。これと枠組み・構成を変える（§3.3 追加生成） */
  existing: { framework: string; approach: string; claim: string; headings: string[] }[];
}

export function caseOutlinePrompt(ctx: OutlineContext): string {
  const existingNote =
    ctx.existing.length === 0
      ? ""
      : `
【厳守】別の切り口にすること
この側には既に次の立論があります。**評価基準の枠組みか、第2ブロックの型か、柱にする論点**を変え、
同じ立論の言い換えにならないようにしてください。
${ctx.existing
  .map(
    (e, i) =>
      `${i + 1}本目: 枠組み「${e.framework}」／切り口「${e.approach}」／見出し: ${e.headings.join("・")}`,
  )
  .join("\n")}
`;

  return `
${CASE_FORMAT_GUIDE}

論題: ${ctx.resolution}
立場: ${sideLabel(ctx.side)}
推奨する評価基準の枠組み: ${ctx.frameworkName}
評価基準: ${ctx.criteria.join("、")}
第2ブロックの型の既定: ${ctx.secondBlockType === "environment" ? "環境変化型" : "比較衡量型"}
${existingNote}
${exemplarInstruction(ctx.side, ctx.resolution)}

この条件で立論の骨子だけを出力してください（本文はまだ書かない）。

【厳守】分量の制約から逆算すること
立論は読み上げ5分で、超過しても30秒以上余っても減点されます。全体で${speechBudgetChars()}字以内です。
そのため**小見出しは全体で4〜6個まで**にしてください。

出力するJSON:
{
  "side": "${ctx.side}",
  "framework": "枠組み名",
  "approach": "この立論の切り口を短く（例: 環境変化型・DX重視）",
  "valuePremise": "価値前提を一文で",
  "claim": "Ⅰ.主張の一文",
  "sections": [
    { "title": "Ⅱ-1の見出し（枠組み名を含める）", "type": "criteria", "subsectionTitles": ["（1）の見出し","（2）の見出し"] },
    { "title": "Ⅱ-2の見出し", "type": "environment|comparison", "subsectionTitles": ["..."] }
  ],
  "conclusion": "Ⅲ.結論の一文"
}
`.trim();
}

/** 争点カテゴリは質疑の整理軸。一覧を渡さないとLLMが勝手な名前を作る */
export function categoryInstruction(categories: string[]): string {
  return `
【厳守】争点カテゴリ
categoryNames は次の一覧から**そのままの表記で**選んでください。
${categories.map((c) => `- ${c}`).join("\n")}`.trim();
}

export function caseBodyPrompt(
  outlineJson: string,
  resolution: string,
  categories: string[],
  subsectionCount: number,
  side: Side,
): string {
  return `
${CASE_FORMAT_GUIDE}

論題: ${resolution}

${exemplarInstruction(side, resolution)}

次の骨子に沿って、立論の本文を書いてください。

${outlineJson}

${speechBudgetGuide(subsectionCount)}

${categoryInstruction(categories)}

各サブセクションについて:
- claim: その段落の主張（実際にスピーチで読み上げる文章。論述体で）
- warrant: なぜそう言えるかの理由づけ
- causalChain: 因果の連鎖を段階ごとに配列で（準備用のメモ。読み上げない）
- impact: それが論題の判断にどう効くか
※ claim・warrant・impact は**読み上げる原稿そのもの**です。3つ合わせて上の目安の字数に収めてください
- categoryNames: 関係する争点カテゴリ名
- refSlots: 本文中で【資料{slot}参照】と書いた箇所を宣言する。slot は "s1" "s2" … の形。
            provesWhat には「その資料が証明すべき命題」、kind には資料の種類
            （law|precedent|statistic|paper|govt_doc|diet_record）を書く

出力するJSON:
{
  "sections": [
    {
      "title": "...", "type": "criteria",
      "subsections": [
        { "title": "...", "claim": "...", "warrant": "...",
          "causalChain": ["...","..."], "impact": "...",
          "categoryNames": ["..."],
          "refSlots": [{ "slot": "s1", "provesWhat": "...", "kind": "statistic" }] }
      ]
    }
  ]
}
`.trim();
}

/**
 * 字数の自動調整（§3.3）。
 * 早口・遅口で合わせるのは減点対象なので、文章の量そのものを直させる。
 */
export function lengthAdjustPrompt(
  paragraphsJson: string,
  currentChars: number,
  direction: "shorten" | "lengthen",
): string {
  const min = minAcceptableChars();
  const max = speechBudgetChars();
  const target = Math.round((min + max) / 2) + 20;
  const delta = Math.abs(target - currentChars);
  return `
立論の読み上げ字数が${direction === "shorten" ? "多すぎ" : "少なすぎ"}ます。
現在 ${currentChars}字。適正は ${min + 1}〜${max}字（4分30秒超〜5分以内）で、目標は約${target}字です。
**全体で約${delta}字${direction === "shorten" ? "削って" : "足して"}**ください。

${
  direction === "shorten"
    ? "削り方: 同じことの言い換え・前置き・接続の重複を落とす。論点が多すぎる段落は、弱い理由を1つ捨てる。"
    : "足し方: 因果を一段ずつ書き足す（AだからB、BだからC）。新しい論点は足さない。"
}

【厳守】
- 【資料N参照】の表記は、位置を大きく変えずにそのまま残すこと。新しい資料番号を作らないこと
- 数値（統計値・割合・件数・金額）を新しく書かないこと
- 見出しは変えないこと

現在の段落（id ごとに claim・warrant・impact を返してください）:
${paragraphsJson}

出力するJSON:
{ "paragraphs": [ { "id": "段落のid", "claim": "...", "warrant": "...", "impact": "..." } ] }
`.trim();
}

/**
 * 数値の差し込み（§1-9「出典の明記」）。
 * 使ってよい数値の一覧を渡し、それ以外の数値を書かせない。書いたかはコードで検査する。
 */
export function insertNumbersPrompt(
  paragraphJson: string,
  allowedNumbers: { refNumber: number; label: string; text: string }[],
  unsourced: string[],
): string {
  return `
立論の1段落を、数値の扱いについてだけ直してください。論旨と長さ（±1割）は変えません。

段落:
${paragraphJson}

${
  unsourced.length > 0
    ? `【厳守】次の数値には出典がありません。**本文から取り除いてください**（数値なしの表現にする）:\n${unsourced.map((u) => `- ${u}`).join("\n")}\n`
    : ""
}
${
  allowedNumbers.length > 0
    ? `使ってよい数値（取得した統計からコードで計算したもの）。効果的なら、対応する【資料N参照】の近くで使ってください:
${allowedNumbers.map((a) => `- 【資料${a.refNumber}参照】${a.label}: ${a.text}`).join("\n")}
`
    : ""
}
【厳守】
- 上の「使ってよい数値」以外の数値を書かないこと（表記も変えない。${"「約」などを付けるのは可"}）
- 【資料N参照】の表記はそのまま残すこと

出力するJSON:
{ "claim": "...", "warrant": "...", "impact": "..." }
`.trim();
}

export interface RegenerateClaimContext {
  resolution: string;
  side: Side;
  framework: string;
  sectionTitle: string;
  claimTitle: string;
  current: string;
  allowedRefNumbers: number[];
}

export function regenerateClaimPrompt(ctx: RegenerateClaimContext): string {
  const refs = ctx.allowedRefNumbers.length
    ? ctx.allowedRefNumbers.map((n) => `【資料${n}参照】`).join("、")
    : "（この段落では資料を参照しません）";

  return `
立論の一部分だけを書き直してください。ほかの部分には手を触れません。

論題: ${ctx.resolution}
立場: ${sideLabel(ctx.side)}
評価基準の枠組み: ${ctx.framework}
このブロックの見出し: ${ctx.sectionTitle}
書き直す段落の見出し: ${ctx.claimTitle}

現在の本文:
${ctx.current}

【厳守】長さ
書き直したあとの claim・warrant・impact の合計を、**現在の本文と同じかそれ以下**にしてください。

【厳守】資料参照・数値
この段落で使ってよいマーカーは次のものだけです: ${refs}
- 新しい資料番号を作ってはいけません。
- 現在の本文にない数値を書いてはいけません。

出力するJSON:
{
  "claim": "書き直した本文（スピーチで読み上げる論述体）",
  "warrant": "なぜそう言えるかの理由づけ",
  "causalChain": ["因果の段階を一段ずつ"],
  "impact": "論題の判断にどう効くか"
}
`.trim();
}

/** 登録立論の構造化（§3.2）。本文は書き換えず、区切りの行番号だけを返させる */
export function importStructurePrompt(numberedText: string): string {
  return `
次は、ディベートの立論原稿を1行ずつ番号付きで並べたものです。
Ⅰ主張／Ⅱ理由（ブロック見出しと（1）（2）…の段落）／Ⅲ結論 の区切りを、**行番号だけで**答えてください。
本文を書き写したり要約したりしないでください。

${numberedText}

ルール:
- 行番号は左端の数字（0始まり）です。範囲は両端を含みます
- claim: Ⅰ主張の本文の行範囲（見出し行を含めてもよい）
- sections: Ⅱ理由の中の「1.」「2.」などのブロック。titleLine はブロック見出しの行
  - intro: ブロック見出しと最初の（1）の間に導入の文があれば、その行範囲。なければ null
  - subsections: ブロック内の段落。（1）（2）の見出しがあればその行を titleLine に、
    本文の行範囲を body に。見出しのない段落しかない場合は、ブロック見出しの行を titleLine にし、
    ブロックの本文全体を1つの段落として body にする
  - type: criteria（評価基準による論証）/ environment（環境変化型）/ comparison（比較衡量型）/ other
- conclusion: Ⅲ結論（Ⅳ再主張と書かれていてもこれ）の本文の行範囲

出力するJSON:
{
  "claim": [開始行, 終了行],
  "sections": [
    { "titleLine": 行, "type": "criteria", "intro": [開始行, 終了行] または null, "subsections": [ { "titleLine": 行, "body": [開始行, 終了行] } ] }
  ],
  "conclusion": [開始行, 終了行]
}
`.trim();
}
