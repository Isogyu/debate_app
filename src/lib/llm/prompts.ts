/**
 * 生成プロンプト（REQUIREMENTS.md §2 実フォーマット / §8 生成パイプライン）
 *
 * 守らせる原則:
 *  - 実資料の引用文・出典は生成しない。資料要件（命題・探し方）だけを出させる
 *  - 条文全文は生成しない。法令名と条番号だけ
 *  - 情報源はホワイトリストのIDから選ばせる
 */

import { whitelistForPrompt } from "@/domain/source-whitelist";
import { speechBudgetGuide } from "@/domain/speech";
import { exemplarFor } from "@/domain/exemplars";
import type { Side } from "@/domain/types";

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

【厳守】見出しの書き方
見出しに番号を付けないでください（「1.」「Ⅱ-1.」「（1）」などを含めない）。
番号は表示・出力の側で自動的に付きます。見出しに書くと「1. Ⅱ-1. …」のように二重になります。
  悪い例: "Ⅱ-1. 租税公平主義から見た問題点" / "（1）担税力に即した課税"
  良い例: "租税公平主義から見た問題点" / "担税力に即した課税"

【厳守】資料参照の書き方
資料が必要な箇所には、**本文（claim）の中に** 【資料{slot}参照】と実際に書き込んだうえで、
その slot を refSlots に宣言してください。宣言だけして本文に書かないのは誤りです。
  例: claim に「…必要経費を控除している【資料s1参照】。」と書き、
      refSlots に { "slot": "s1", "provesWhat": "…" } を入れる
`.trim();

/**
 * お手本の提示（few-shot）。
 *
 * 大事なのは「内容を真似させない」こと。お手本は別の論題のものなので、
 * 論点まで引きずられると的外れな立論になる。
 * 真似させるのは構成・密度・分量の3つだけだと明示する。
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
- お手本に出てくる法令・学説・用語を、関係ないのに持ち込まないこと
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
- 肯定側と否定側で「異なる評価基準の枠組み」を採ることがあります。それぞれに最も有利な枠組みを選んでください。
  （例: 肯定側=租税公平主義「担税力/公平/中立性」、否定側=税の基本原則「公平/中立/簡素」）
- **criteria は短い語**にしてください（2〜8文字程度の名詞）。立論の見出しと比較衡量表にそのまま使うためです。
  悪い例: "婚姻の自由と氏の自己決定権が実質的に保障されているか"
  良い例: "自己決定権" / "実質的平等" / "権利侵害の有無"
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

${exemplarInstruction(ctx.side, ctx.resolution)}

この条件で立論の骨子だけを出力してください（本文はまだ書かない）。

【厳守】分量の制約から逆算すること
立論は読み上げ5分で、超過すると減点されます。全体で1,600字以内です。
そのため**小見出しは全体で4〜6個まで**にしてください。
7個以上にすると、1つあたり200字を切って論証が成立しません。
論点は絞り込み、弱いものは捨ててください。

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

/**
 * 争点カテゴリは全成果物の共通軸（§14）。
 * 一覧を渡さないとLLMが勝手な名前を作り、IDに解決できず結びつきが切れる。
 * 実際にブロック集のカテゴリが全件空になったため、必ずこれを添える。
 */
function categoryInstruction(categories: string[]): string {
  return `
【厳守】争点カテゴリ
categoryNames は次の一覧から**そのままの表記で**選んでください。
一覧にない名前を作ってはいけません（成果物どうしの結びつきが切れます）。
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
- claim: その段落の主張（実際にスピーチで読み上げる文章。です・ます調ではなく論述体で）
- warrant: なぜそう言えるかの理由づけ
- causalChain: 因果の連鎖を段階ごとに配列で（飛躍させず、一段ずつ）
- impact: それが論題の判断にどう効くか

※ claim・warrant・impact は**読み上げる原稿そのもの**です。3つ合わせて
  上の目安の字数に収めてください。causalChain は読み上げず、
  準備用のメモなので字数に数えません
- categoryNames: 関係する争点カテゴリ名
- refSlots: 本文中で【資料{slot}参照】と書いた箇所を宣言する。
            slot は "s1" "s2" … の形。provesWhat には「その資料が証明すべき命題」を書く
            **claim の文字列の中に【資料{slot}参照】を必ず含めること。**
            宣言だけして本文に書かないと、立論と参考資料の対応が切れます

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

出力するJSON（slot は上のリストで渡されたものを**そのままの文字列で**返してください。
勝手に "s1" のような別の形に変えると、どの資料の情報か分からなくなります）:
{
  "requirements": [
    {
      "slot": "（上のリストで渡された slot をそのまま）",
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
  categories: string[],
): string {
  const role =
    direction === "attack"
      ? "相手の立論の弱点を突く質疑を設計してください。"
      : "自分の立論に対して相手から来そうな質問と、その回答準備を設計してください。";
  return `
${role}

対象の立論:
${opponentCaseText}

${categoryInstruction(categories)}

質疑は「想定回答ごとに次の質問が変わる」分岐構造で作ります。
どう答えられても追及が続くように、各回答に対する次の一手を用意してください。

分量の目安（本番の質疑時間は限られています。網羅より鋭さを優先してください）:
- 起点となる質問は3〜4個
- 各質問の想定回答は2個まで
- 追及は2段まで（起点 → 追及 → 追及）
- 全体で10ノードを超えないこと

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

export function rebuttalPrompt(
  opponentCaseText: string,
  categories: string[],
): string {
  return `
相手の立論を「前提・根拠・因果・効果」の4つの攻撃点に分解して、反駁を組み立ててください。

- premise（前提）: 相手が当然視している前提を疑う
- evidence（根拠）: 資料の射程・古さ・代表性を突く
- causality（因果）: 「AだからB」の飛躍を突く
- impact（効果）: 仮に正しくても論題の判断を変えないと示す

相手の立論:
${opponentCaseText}

${categoryInstruction(categories)}

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

export function blocksPrompt(
  rebuttalsJson: string,
  categories: string[],
): string {
  return `
本番の試合中に引くための「ブロック集」を作ります。
相手が何か言ってきたとき、争点カテゴリから2タップで返しに辿り着ける形にします。

用意した反駁:
${rebuttalsJson}

${categoryInstruction(categories)}
※ブロックのカテゴリは、本番中に相手の主張を分類して引くための見出しです。
　必ず1つ以上付けてください。付いていないと本番モードから辿り着けません。

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

【厳守】長さ
立論は読み上げ5分で、超過すると減点されます。
書き直したあとの claim・warrant・impact の合計を、**現在の本文と同じかそれ以下**に
してください。詳しくしようとして長くしないこと。

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

// ── 質疑シミュレーター（U9 / DESIGN §11） ──────────────

export interface SimulatorContext {
  resolution: string;
  /** AIが演じる側 */
  aiSide: "affirmative" | "negative";
  /** AIが守る（または攻める根拠にする）立論 */
  caseText: string;
  mode: "attack" | "defense";
}

/**
 * AIに一貫した立場を保たせる。
 * 本番の相手は自分の立論から外れた譲歩をしないので、
 * 簡単に折れる相手だと練習にならない。
 */
export function simulatorSystem(ctx: SimulatorContext): string {
  const side = ctx.aiSide === "affirmative" ? "肯定側" : "否定側";
  const role =
    ctx.mode === "attack"
      ? `あなたは${side}のディベーターです。相手（練習者）からの質疑に答えます。`
      : `あなたは${side}のディベーターです。相手（練習者）の立論に対して質疑を行います。`;

  return `
${role}

論題: ${ctx.resolution}

あなたが立脚する立論:
${ctx.caseText}

【守ること】
- 上の立論から外れないこと。自分の立場を簡単に捨てない
- 1回の発言は2〜3文まで。本番の質疑は短いやり取りの積み重ねです
- 答えに詰まる場面では、本番で実際に起きるように、話をそらしたり
  条件を付けて限定したりして粘ること。すぐに負けを認めないこと
- ただし明らかに破綻した主張は無理に守らず、争点を移すこと
- 練習相手として振る舞い、解説や助言はしないこと（それは最後のフィードバックで行う）
${
  ctx.mode === "defense"
    ? "- 質問は一度に1つだけ。相手の答えを受けてから次を出すこと"
    : "- 聞かれたことに答えること。質問に質問で返さないこと"
}

出力は次のJSONのみ:
{ "reply": "あなたの発言" }
`.trim();
}

/** defenseモードの最初の一手。練習者に答えさせるところから始める */
export function simulatorOpeningPrompt(userCaseText: string): string {
  return `
相手（練習者）の立論は次のとおりです。

${userCaseText}

この立論の弱点を突く質疑を始めてください。最初の質問を1つだけ出してください。
いきなり核心を突かず、前提を確認するところから入ると本番に近くなります。

出力は次のJSONのみ:
{ "reply": "最初の質問" }
`.trim();
}

export function simulatorReplyPrompt(
  history: { speaker: "user" | "ai"; text: string }[],
  userText: string,
): string {
  const transcript = history
    .map((t) => `${t.speaker === "user" ? "相手" : "あなた"}: ${t.text}`)
    .join("\n");

  return `
これまでのやり取り:
${transcript || "（まだありません）"}

相手の発言: ${userText}

これに応答してください。

出力は次のJSONのみ:
{ "reply": "あなたの発言" }
`.trim();
}

/**
 * 終了後のフィードバック。
 * 練習は続けてもらうことが第一なので、必ずよかった点から入る。
 */
export function simulatorFeedbackPrompt(
  mode: "attack" | "defense",
  transcript: string,
): string {
  const focus =
    mode === "attack"
      ? `評価の観点（質問する側）:
- 質問の狙いが明確だったか。何を認めさせようとしたかが伝わるか
- 相手の逃げを許さず追及できたか。同じ質問を繰り返していないか
- 答えを引き出したあと、それを自分の主張に結びつけられたか
- 1つの質問が長すぎないか（本番では時間を失う）`
      : `評価の観点（答える側）:
- 自分の立論と矛盾しない答えができていたか
- 墓穴を掘る譲歩をしていないか
- 答えられない点をごまかさず、争点を移せていたか
- 答えが長すぎて時間を浪費していないか`;

  return `
次は政策ディベートの質疑練習の記録です。練習者の${
    mode === "attack" ? "質問" : "回答"
  }を講評してください。

${focus}

記録:
${transcript}

講評の方針:
- 必ず「よかった点」から書くこと。練習を続けてもらうことが第一です
- 指摘は具体的に。どの発言のどこが問題かを引用して示すこと
- suggestions には、実際に使える言い換えの例文を入れること
  （「もっと鋭く」のような抽象的な助言は書かない）

出力は次のJSONのみ:
{
  "strengths": ["よかった点"],
  "weaknesses": ["次に直すとよい点"],
  "suggestions": ["こう言い換えるとよい、という具体例"],
  "summary": "全体の講評を2〜3文で"
}
`.trim();
}
