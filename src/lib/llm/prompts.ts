/**
 * 生成プロンプト（REQUIREMENTS.md §2 実フォーマット / §8 生成パイプライン）
 *
 * 守らせる原則:
 *  - 実資料の引用文・出典は生成しない。資料要件（命題・探し方）だけを出させる
 *  - 条文全文は生成しない。法令名と条番号だけ
 *  - 情報源はホワイトリストのIDから選ばせる
 */

import { whitelistForPrompt } from "@/domain/source-whitelist";

const NEVER_FABRICATE = `
【厳守】捏造の禁止
- 実在の書籍・論文・統計・議事録の「引用文」や「出典」を書いてはいけません。存在しない出典を作ることになります。
- 法令の条文全文を書いてはいけません。法令名と条番号のみ示してください（条文は人が公的サイトから取得します）。
- 情報源は次のIDから選んでください。リストにないIDを作ってはいけません。
${whitelistForPrompt()}
`.trim();

export const SYSTEM_BASE = `
あなたは日本の大学の政策ディベート（競技ディベート）の指導者です。
法的・政策的な論証を、審査員に伝わる構造で組み立てます。

${NEVER_FABRICATE}
`.trim();

/** 実物の立論フォーマット（§2.1）をモデルに教える */
export const CASE_FORMAT_GUIDE = `
立論は次の構造に従います。

Ⅰ. 主張 … 論題に対する結論を一文で述べる（例:「所得税法56条および57条を廃止するべきである。」）
Ⅱ. 理由
  1. 評価基準フレームに基づく問題点または利点（フレームワーク名を見出しに含める）
     フレームワークの定義とその法的根拠を示したうえで、
     （1）（2）（3）… と評価基準ごとに「基準の定義 → 制度への適用評価 → 小結論」の順で論じる
  2. 第2ブロック。次のいずれかの型をとる
     - 環境変化型（肯定側で多い）: 社会変化・制度整備により「今こそ変えるべき」時宜性を論証する
     - 比較衡量型（否定側で多い）: 現行制度の利点と、変更によって得られる利益を比較衡量する
Ⅲ. 結論 … 以上より、と主張を繰り返す

分量は1〜2頁程度。スピーチ時間に収まる密度にしてください。
資料が必要な箇所には本文中に【資料{slot}参照】と書き、その slot を refSlots に宣言してください。
`.trim();

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
- 肯定側と否定側で「異なる評価基準の枠組み」を採ることがあります。それぞれに最も有利な枠組みを選んでください。
  （例: 肯定側=租税公平主義「担税力/公平/中立性」、否定側=税の基本原則「公平/中立/簡素」）
- categories は全成果物の検索軸になります。4〜8件、互いに重複しない粒度で。
`.trim();
}

export interface OutlineContext {
  resolution: string;
  side: "affirmative" | "negative";
  frameworkName: string;
  criteria: string[];
  /** 第2ブロックの型を指定してバリエーションを作る（A1） */
  secondBlockType: "environment" | "comparison";
  approachHint?: string;
}

export function caseOutlinePrompt(ctx: OutlineContext): string {
  return `
${CASE_FORMAT_GUIDE}

論題: ${ctx.resolution}
立場: ${ctx.side === "affirmative" ? "肯定側（実施すべき）" : "否定側（実施すべきでない）"}
使用する評価基準の枠組み: ${ctx.frameworkName}
評価基準: ${ctx.criteria.join("、")}
第2ブロックの型: ${ctx.secondBlockType === "environment" ? "環境変化型" : "比較衡量型"}
${ctx.approachHint ? `切り口の指定: ${ctx.approachHint}` : ""}

この条件で立論の骨子だけを出力してください（本文はまだ書かない）。

出力するJSON:
{
  "side": "${ctx.side}",
  "framework": "枠組み名",
  "approach": "この立論の切り口を短く（例: 環境変化型・DX重視）",
  "valuePremise": "価値前提を一文で",
  "claim": "Ⅰ.主張の一文",
  "sections": [
    { "title": "Ⅱ-1の見出し（枠組み名を含める）", "type": "criteria", "subsectionTitles": ["（1）の見出し","（2）の見出し"] },
    { "title": "Ⅱ-2の見出し", "type": "${ctx.secondBlockType}", "subsectionTitles": ["..."] }
  ],
  "conclusion": "Ⅲ.結論の一文"
}
`.trim();
}

export function caseBodyPrompt(outlineJson: string, resolution: string): string {
  return `
${CASE_FORMAT_GUIDE}

論題: ${resolution}

次の骨子に沿って、立論の本文を書いてください。

${outlineJson}

各サブセクションについて:
- claim: その段落の主張（実際にスピーチで読み上げる文章。です・ます調ではなく論述体で）
- warrant: なぜそう言えるかの理由づけ
- causalChain: 因果の連鎖を段階ごとに配列で（飛躍させず、一段ずつ）
- impact: それが論題の判断にどう効くか
- categoryNames: 関係する争点カテゴリ名
- refSlots: 本文中で【資料{slot}参照】と書いた箇所を宣言する。
            slot は "s1" "s2" … の形。provesWhat には「その資料が証明すべき命題」を書く

出力するJSON:
{
  "sections": [
    {
      "title": "...", "type": "criteria",
      "subsections": [
        { "title": "...", "claim": "...", "warrant": "...",
          "causalChain": ["...","..."], "impact": "...",
          "categoryNames": ["..."],
          "refSlots": [{ "slot": "s1", "provesWhat": "..." }] }
      ]
    }
  ]
}
`.trim();
}

export function sourceRequirementPrompt(slotsJson: string): string {
  return `
立論が必要としている資料について、「どう探せばよいか」を整理してください。
繰り返しますが、引用文や出典そのものは書かないでください。探し方だけです。

必要な資料（本文で宣言された slot）:
${slotsJson}

出力するJSON:
{
  "requirements": [
    {
      "slot": "s1",
      "provesWhat": "この資料が証明する命題（そのまま資料のタイトルになる）",
      "sourceType": "law|precedent|statistic|paper|govt_doc|diet_record|news|book|org_doc|self_made",
      "description": "なぜこの箇所にこの資料が必要かの説明",
      "searchKeywords": ["検索に使う語"],
      "suggestedSourceIds": ["ホワイトリストのID"],
      "formatHint": "quote|chart|table|law_text|self_made",
      "categoryNames": ["争点カテゴリ名"]
    }
  ]
}

注意:
- 自分たちで作る資料（税額シミュレーション表など）が有効な場合は sourceType を self_made にしてください。
- suggestedSourceIds は必ずホワイトリストのIDから選んでください。
`.trim();
}

export function crossExamPrompt(
  opponentCaseText: string,
  direction: "attack" | "defense",
): string {
  const role =
    direction === "attack"
      ? "相手の立論の弱点を突く質疑を設計してください。"
      : "自分の立論に対して相手から来そうな質問と、その回答準備を設計してください。";
  return `
${role}

対象の立論:
${opponentCaseText}

質疑は「想定回答ごとに次の質問が変わる」分岐構造で作ります。
どう答えられても追及が続くように、各回答に対する次の一手を用意してください。

出力するJSON:
{
  "nodes": [
    {
      "key": "q1",
      "direction": "${direction}",
      "question": "質問文（本番でそのまま読める短さで）",
      "purpose": "この質問の意図",
      "categoryNames": ["争点カテゴリ名"],
      "targetClaimTitle": "対象のサブセクション見出し",
      "branches": [
        { "expectedAnswer": "想定される回答", "followUpKey": "q2", "exposedWeakness": "この回答をした場合に露呈する弱点" }
      ]
    }
  ]
}

注意: followUpKey は他のノードの key を指します。循環させないでください。
`.trim();
}

export function rebuttalPrompt(opponentCaseText: string): string {
  return `
相手の立論を「前提・根拠・因果・効果」の4つの攻撃点に分解して、反駁を組み立ててください。

- premise（前提）: 相手が当然視している前提を疑う
- evidence（根拠）: 資料の射程・古さ・代表性を突く
- causality（因果）: 「AだからB」の飛躍を突く
- impact（効果）: 仮に正しくても論題の判断を変えないと示す

相手の立論:
${opponentCaseText}

出力するJSON:
{
  "rebuttals": [
    { "targetClaimTitle": "対象のサブセクション見出し",
      "attackPoint": "premise|evidence|causality|impact",
      "argument": "反駁の本文（本番で読み上げられる長さ）",
      "categoryNames": ["争点カテゴリ名"] }
  ]
}
`.trim();
}

export function blocksPrompt(rebuttalsJson: string): string {
  return `
本番の試合中に引くための「ブロック集」を作ります。
相手が何か言ってきたとき、争点カテゴリから2タップで返しに辿り着ける形にします。

用意した反駁:
${rebuttalsJson}

重要: 複数の想定パターンから似た反駁が出ています。
**同じ趣旨のものは1つのブロックにまとめてください。**
本番の一覧にほぼ同じ返しが並ぶと、探す時間が増えて使い物になりません。

出力するJSON:
{
  "blocks": [
    { "opponentArgument": "相手が言いそうな主張（類型化した代表的な言い回し）",
      "summary": "返しの要点を1〜2文で。本番の一覧カードにこれだけが表示される",
      "categoryNames": ["争点カテゴリ名"],
      "rebuttalArguments": ["このブロックに束ねる反駁の本文（元の文言をそのまま）"] }
  ]
}
`.trim();
}

export function comparisonPrompt(
  affirmativeText: string,
  negativeText: string,
  categories: string[],
): string {
  return `
評価基準ごとに両side の利益・不利益を対比する「比較衡量表」を作ってください。

肯定側の立論:
${affirmativeText}

否定側の立論:
${negativeText}

使える争点カテゴリ: ${categories.join("、")}

出力するJSON:
{
  "criteria": [
    { "name": "評価基準名", "categoryName": "対応する争点カテゴリ名（上のリストから）",
      "affirmative": "肯定側にとっての評価", "negative": "否定側にとっての評価" }
  ],
  "verdictLogic": "どちらを重く見るべきかの判断の軸"
}
`.trim();
}

export interface RegenerateClaimContext {
  resolution: string;
  side: "affirmative" | "negative";
  framework: string;
  sectionTitle: string;
  claimTitle: string;
  current: string;
  /** 本文で使ってよい資料番号。これ以外を書かせない */
  allowedRefNumbers: number[];
}

export function regenerateClaimPrompt(ctx: RegenerateClaimContext): string {
  const refs = ctx.allowedRefNumbers.length
    ? ctx.allowedRefNumbers.map((n) => `【資料${n}参照】`).join("、")
    : "（この段落では資料を参照しません）";

  return `
立論の一部分だけを書き直してください。ほかの部分には手を触れません。

論題: ${ctx.resolution}
立場: ${ctx.side === "affirmative" ? "肯定側" : "否定側"}
評価基準の枠組み: ${ctx.framework}
このブロックの見出し: ${ctx.sectionTitle}
書き直す段落の見出し: ${ctx.claimTitle}

現在の本文:
${ctx.current}

【厳守】資料参照について
この段落で使ってよいマーカーは次のものだけです: ${refs}
- 新しい資料番号を作ってはいけません。資料要件との対応が壊れます。
- 上のマーカーは、本文中の適切な位置にそのままの表記で残してください。

出力するJSON:
{
  "claim": "書き直した本文（スピーチで読み上げる論述体）",
  "warrant": "なぜそう言えるかの理由づけ",
  "causalChain": ["因果の段階を一段ずつ"],
  "impact": "論題の判断にどう効くか"
}
`.trim();
}
