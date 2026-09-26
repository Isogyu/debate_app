/**
 * 質疑シミュレーターのプロンプト（v6 要件 F11・§4.3・§4.4）
 *
 * AI は常に「相手」を演じる。
 *  - attack  … 練習者が質問し、AI が相手の立論を守って答える
 *  - defense … AI が練習者の立論に質問する。生成済みの質疑（使う質疑・連鎖）を優先して使う
 *
 * 生成済みの質疑は DB の ID ではなく短いキー（q1…／c1…）で見せ、
 * どれを使ったかをキーで返させる（domain/practice.ts で ID に戻す）。
 */

import {
  ATTACK_POINT_LABELS,
  BRANCH_KIND_LABELS,
  type PracticeMode,
  type Side,
} from "@/domain/types";
import type { KeyedChain } from "@/domain/practice";
import { sideLabel } from "./prompts";

const ATTACK_POINT_HINT = Object.entries(ATTACK_POINT_LABELS)
  .map(([k, v]) => `${k}=${v}`)
  .join(" / ");

export const SIMULATOR_FEEDBACK_SYSTEM =
  "あなたは日本の大学の政策ディベート（税法ゼミの大会）の指導者です。講評は学生に伝わる平易な日本語で書きます。出力はJSONのみを返してください。";

export interface SimulatorCase {
  side: Side;
  text: string;
}

/** 連鎖をプロンプト用の文字列にする。分岐ごとの次の質問もキーで示す */
export function formatChains(chains: KeyedChain[], opts: { withModelAnswer: boolean }): string {
  if (chains.length === 0) return "（生成済みの質疑はありません）";
  return chains
    .map((c) => {
      const head = `■ 連鎖${c.key}${c.inEightMinuteSet ? "【使う質疑】" : ""}｜${c.paragraph || "段落指定なし"}｜引き出したい結論: ${c.goal || "（未設定）"}`;
      const idToKey = new Map(c.nodes.map((n) => [n.node.id, n.key]));
      const lines = c.nodes.map(({ key, node }) => {
        const branches = node.branches
          .map((b) => {
            const next = b.followUpNodeId ? idToKey.get(b.followUpNodeId) : undefined;
            return `    - ${BRANCH_KIND_LABELS[b.kind]}「${b.expectedAnswer}」${next ? ` → 次は ${next}` : ""}`;
          })
          .join("\n");
        const model = opts.withModelAnswer && node.modelAnswer ? `\n    模範回答: ${node.modelAnswer}` : "";
        return `  ${key}: ${node.question}${model}${branches ? `\n${branches}` : ""}`;
      });
      return [head, ...lines].join("\n");
    })
    .join("\n");
}

export function simulatorSystem(ctx: {
  resolution: string;
  mode: PracticeMode;
  /** AIが演じる相手の立論 */
  aiCase: SimulatorCase;
  /** 練習者が守る立論 */
  userCase: SimulatorCase;
  /** defense: 練習者の立論に向けた生成済みの質疑 / attack: AIの立論に向けた質疑（模範回答を参考にする） */
  chains: KeyedChain[];
}): string {
  const common = `
論題: ${ctx.resolution}

あなた（AI）は${sideLabel(ctx.aiCase.side)}のディベーターです。立脚する立論:
${ctx.aiCase.text}

相手（練習者）は${sideLabel(ctx.userCase.side)}です。相手の立論:
${ctx.userCase.text}
`.trim();

  if (ctx.mode === "attack") {
    return `
${common}

いまは相手（練習者）の質疑の時間です。あなたは質問に答える側です。

【守ること】
- 聞かれたことに答えること。質問に答えずに話をそらし続けない（要項7で減点される）
- 質問に質問で返さないこと（逆質問は減点対象）。質問の意味があいまいなときの「確認の質問」だけは可
- 自分の立論から外れないこと。立論にない新しい主張を持ち出さない
- 1回の発言は2〜3文まで。本番の質疑は短いやり取りの積み重ねです
- 苦しい点は、本番の相手のように条件を付けて限定したり、はぐらかしたりしてよい。
  ただし一度で完全に折れないこと。追及が重なって逃げ場がなくなったときは、認めるべきことは認める
- 練習相手として振る舞い、解説や助言はしないこと（講評は最後に別に行う）

あなたの立論に向けて想定されている質問と、準備していた模範回答（参考。答え方をそろえるために使う）:
${formatChains(ctx.chains, { withModelAnswer: true })}

出力は次のJSONのみ:
{ "reply": "あなたの回答", "usedKey": null }
`.trim();
  }

  return `
${common}

いまはあなた（AI）の質疑の時間です。相手（練習者）の立論に質問します。

【質問の選び方】
- 下の「準備済みの質疑」を優先して使うこと。【使う質疑】（練習者が試合で使うと選んだもの）の連鎖を上から順に使うのが基本
- 連鎖は、相手の答えがどの分岐（認める／否定する／はぐらかす）に近いかを見て、その分岐の「次は qN」へ進む
- 連鎖の「引き出したい結論」に届いたら、次の連鎖へ移る
- 準備済みの質問を使ったときは、そのキー（例: "q3"）を usedKey に入れる。言い回しは自然に直してよい
- 相手の答えが想定外で、準備済みの質問では追えないときは、新しい質問をしてよい（usedKey は null）
- 同じ質問を繰り返さない

【守ること】
- 質問は一度に1つだけ。短く、「はい／いいえ」か短い答えで返せる形にする
- 相手の答えを受けてから次を出す。解説や助言はしない（講評は最後に別に行う）
- 相手が質問に答えていないときは、同じ趣旨を短く言い直して答えを求めてよい

準備済みの質疑（相手の立論に向けたもの）:
${formatChains(ctx.chains, { withModelAnswer: false })}

出力は次のJSONのみ:
{ "reply": "あなたの質問", "usedKey": "q1 または null" }
`.trim();
}

/** defense の最初の一手。AI から質問を切り出す */
export function simulatorOpeningPrompt(): string {
  return `
質疑を始めてください。最初の質問を1つだけ出してください。
準備済みの質疑があれば【使う質疑】の最初の連鎖（なければいちばん上の連鎖）の起点（いちばん上の質問）から始めてください。

出力は次のJSONのみ:
{ "reply": "最初の質問", "usedKey": "使ったキー または null" }
`.trim();
}

export function simulatorReplyPrompt(
  mode: PracticeMode,
  history: { speaker: "user" | "ai"; text: string; key?: string }[],
  userText: string,
): string {
  const transcript = history
    .map((t) =>
      t.speaker === "user" ? `相手: ${t.text}` : `あなた${t.key ? `（${t.key}）` : ""}: ${t.text}`,
    )
    .join("\n");

  const ask =
    mode === "attack"
      ? "この質問に答えてください。"
      : "この答えを受けて、次の質問を1つ出してください。準備済みの連鎖の続きがあればそれを使ってください。";

  return `
これまでのやり取り:
${transcript || "（まだありません）"}

相手の発言: ${userText}

${ask}

出力は次のJSONのみ:
{ "reply": "あなたの発言", "usedKey": ${mode === "attack" ? "null" : '"使ったキー または null"'} }
`.trim();
}

export interface FeedbackTurn {
  speaker: "user" | "ai";
  text: string;
  /** AIが準備済みの質疑を使ったときのキー */
  key?: string;
  /** 練習者の発言の推定読み上げ秒数（コードで計算） */
  seconds?: number;
}

/**
 * 講評。テキストで判定できる観点だけを見る（要件 §4.4）。
 * さえぎり・沈黙・声は、テキスト練習では分からないので評価させない
 * （入力に要した時間は発話の沈黙と一致しない）。
 */
export function simulatorFeedbackPrompt(ctx: {
  resolution: string;
  mode: PracticeMode;
  userCase: SimulatorCase;
  aiCase: SimulatorCase;
  turns: FeedbackTurn[];
  /** 照合に使う連鎖。attack: 相手の立論向け（練習者が使えた台本）／defense: 練習者の立論向け */
  chains: KeyedChain[];
  /** 長すぎる目安（秒）。コードの判定と同じ値 */
  longTurnSeconds: number;
  /** defense: 同趣旨の判定に使う、練習者の立論向けの既存の質問すべて */
  existingQuestions: string[];
  /** 練習者の立論の段落名（新しい質問の paragraph に使わせる） */
  paragraphLabels: string[];
  /** 最終弁論の雛形の枠（あれば、この枠で記入例を作る） */
  closingFrame?: string;
}): string {
  const userRole = ctx.mode === "attack" ? "質問" : "回答";
  const transcript = ctx.turns
    .map((t, i) => {
      if (t.speaker === "user") {
        return `[${i + 1}] 練習者（${userRole}・推定${t.seconds ?? "?"}秒）: ${t.text}`;
      }
      return `[${i + 1}] 相手AI${t.key ? `（準備済み ${t.key}）` : ""}: ${t.text}`;
    })
    .join("\n");

  const focus =
    ctx.mode === "attack"
      ? `評価の観点（練習者は質問する側）:
1. 質問の狙いが明確か。何を認めさせようとしたかが伝わるか
2. 相手の逃げ（はぐらかし・条件付け）を許さず詰められたか。同じ質問を繰り返していないか
3. 引き出した答えを、自分の立論の主張や最終弁論に結びつけられる形で押さえたか
4. 質問の形になっているか。自分の主張を長々と述べる「演説」になっていないか
5. 1回の発言の長さ（推定秒数を付けてある。質問は${ctx.longTurnSeconds}秒を超えると長い。8分の質疑で10往復以上回すため）
6. 準備済みの質疑（下の連鎖）との照合: どの連鎖に沿って質問したか、引き出したい結論まで到達したか、
   想定外の答えにどう対応したか`
      : `評価の観点（練習者は答える側）:
1. 自分の立論と矛盾しない回答か。墓穴を掘る譲歩（立論の柱を自分から崩す答え）をしていないか
2. 質問に答えているか。答えずに話をそらしていないか（要項7）。
   質問に質問で返す逆質問をしていないか（ただし質問の趣旨を確かめる確認の質問は可）
3. 答えにくい点をごまかさず、条件を付けて限定する・争点を移すなど、立論を守る対応ができたか
4. 1回の発言の長さ（推定秒数を付けてある。回答は${ctx.longTurnSeconds}秒を超えると長い。相手の持ち時間を潰す長話は印象が悪い）
5. 準備済みの質疑（下の連鎖）との照合: 相手AIが使った連鎖で、相手に「引き出したい結論」まで到達されたか
   （到達された＝守り切れなかった）、模範回答と比べてどうだったか`;

  const defenseOutputs =
    ctx.mode === "defense"
      ? `
- stuckKeys: 相手AIが準備済みの質問（キー付き）をしたとき、練習者が答えに詰まった・
  答えられなかった・墓穴を掘った質問のキー。該当がなければ []
- newQuestions: 相手AIがした質問のうち、準備済みの質疑に**ない**もので、今後の練習に残す価値があるもの。
  下の「既存の質問」と同趣旨のものは入れない。各項目に
  question（質問文。本番で読める短さ）、modelAnswer（練習者の立論を守る模範回答。2文以内。逆質問にしない）、
  paragraph（練習者の立論のどの段落を突く質問か。下の「段落名」から1つをそのまま写す。当てはまらなければ ""）、
  attackPoint（${ATTACK_POINT_HINT} のどれか。英語のキーで）を入れる。なければ []

既存の質問（練習者の立論向け。同趣旨の判定に使う）:
${ctx.existingQuestions.length ? ctx.existingQuestions.map((q) => `- ${q}`).join("\n") : "（なし）"}

段落名:
${ctx.paragraphLabels.length ? ctx.paragraphLabels.map((l) => `- ${l}`).join("\n") : "（なし）"}
`
      : `
- stuckKeys と newQuestions は、この練習（練習者が質問する側）では使わないので [] にする
`;

  const closing = ctx.closingFrame
    ? `次の最終弁論の雛形の枠の【】を、この練習で実際に出た答えで埋めた記入例にする:
${ctx.closingFrame}`
    : "「質疑で相手は○○を認めた。したがって…」の形で、この練習で実際に出た答えを使って組み立てる";

  return `
次は政策ディベートの質疑練習の記録です（テキストで入力したもの）。練習者の${userRole}を講評してください。

論題: ${ctx.resolution}

練習者の立論（${sideLabel(ctx.userCase.side)}）:
${ctx.userCase.text}

相手AIが演じた立論（${sideLabel(ctx.aiCase.side)}）:
${ctx.aiCase.text}

${focus}

【講評しない観点】次はテキストの記録からは判定できないので、**一切触れないこと**:
- 相手の発言をさえぎったか（要項6）
- 20秒以上の沈黙・活発度（要項12）。入力にかかった時間は発話の沈黙とは違う
- 声の大きさ・聞き取りやすさ（要項9）

準備済みの質疑（キー付き）:
${formatChains(ctx.chains, { withModelAnswer: true })}

記録（[番号] は発言の番号）:
${transcript}

講評の方針:
- strengths（よかった点）を必ず先に、1つ以上書く。練習を続けてもらうことが第一
- weaknesses（直す点）は、該当する発言を「[番号]『引用』」の形で示す
- suggestions には、実際にそのまま言える言い換えの例文を入れる（「もっと鋭く」のような抽象的な助言は書かない）
- summary は全体の講評を2〜3文で
- テーマそのものへの賛否は述べない。評価するのは質疑の運び方

出力する項目:
- chains: 準備済みの連鎖のうち、この練習で**実際に使われた**もの（${ctx.mode === "attack" ? "練習者が同じ趣旨の質問をした" : "相手AIが使った"}連鎖）だけ。
  各項目は { "key": "c1", "reached": 引き出したい結論まで到達したか, "note": "どこで止まったか・想定外の答えへの対応など1〜2文" }。
  使われた連鎖がなければ []
${defenseOutputs}
- closingExample: この練習の結果から作る最終弁論の記入例（約320字＝1分）。練習者の立場で書く。
  ${closing}
  主張の繰り返しや新しい論点を入れない（要項10で減点される）。質疑で出なかった事実を作らない

出力は次のJSONのみ:
{
  "strengths": ["よかった点"],
  "weaknesses": ["直す点（該当発言を引用）"],
  "suggestions": ["そのまま言える言い換え例"],
  "summary": "総評",
  "chains": [{ "key": "c1", "reached": true, "note": "" }],
  "stuckKeys": [],
  "newQuestions": [],
  "closingExample": "最終弁論の記入例"
}
`.trim();
}
