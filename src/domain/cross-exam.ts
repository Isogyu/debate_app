/**
 * 質疑の網羅検査・8分セット・台本（v6 要件 §4・§5）
 *
 * 網羅はプロンプト頼みにしない。段落×攻撃点の表をコードで持ち、抜けを数える。
 * 8分セットは、発言の字数から読み上げ時間を見積もってコードで選ぶ。
 */

import { countSpeechChars, DEFAULT_CHARS_PER_MINUTE } from "./speech.ts";
import type { AttackPoint, BranchKind, CrossExamNode } from "./types";

export interface ParagraphRef {
  claimId: string;
  label: string;
  /** 立論内の並び順 */
  order: number;
}

export interface Gap {
  claimId: string;
  label: string;
  attackPoint: AttackPoint;
}

/**
 * 段落 × 攻撃点のうち、質問が1つもないマス。
 * 「数字の使い方」は、その段落に数字の弱点が見つかった場合だけ必須にする
 * （数字を使っていない段落に数字の質問は作れない）。
 */
export function coverageGaps(
  paragraphs: ParagraphRef[],
  nodes: Pick<CrossExamNode, "targetClaimId" | "attackPoint">[],
  paragraphsWithNumberIssues: Set<string>,
): Gap[] {
  const covered = new Set(
    nodes.map((n) => `${n.targetClaimId ?? ""}::${n.attackPoint}`),
  );
  const gaps: Gap[] = [];
  const required: AttackPoint[] = ["premise", "evidence", "causality", "impact"];
  for (const p of paragraphs) {
    const points = paragraphsWithNumberIssues.has(p.claimId)
      ? [...required, "numbers" as const]
      : required;
    for (const ap of points) {
      if (!covered.has(`${p.claimId}::${ap}`)) {
        gaps.push({ claimId: p.claimId, label: p.label, attackPoint: ap });
      }
    }
  }
  return gaps;
}

type NodeLike = Pick<
  CrossExamNode,
  "id" | "chainId" | "chainOrder" | "question" | "branches"
>;

/** 連鎖の起点ノード */
export function chainRoot<T extends NodeLike>(nodes: T[], chainId: string): T | undefined {
  return nodes
    .filter((n) => n.chainId === chainId)
    .sort((a, b) => a.chainOrder - b.chainOrder)[0];
}

/**
 * 連鎖の「主経路」。起点から、各ノードで最初に用意された分岐を辿る。
 * 8分セットの時間見積もりと、印刷時の代表的な台本に使う。
 */
export function mainPath<T extends NodeLike>(nodes: T[], chainId: string): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current = chainRoot(nodes, chainId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    const next = current.branches.find((b) => b.followUpNodeId)?.followUpNodeId;
    current = next ? byId.get(next) : undefined;
  }
  return path;
}

/** 1往復あたりの間（問いと答えの切り替え・考える時間） */
const TURN_OVERHEAD_SECONDS = 6;

/** 連鎖を主経路どおりに進めたときの所要時間（秒） */
export function estimateChainSeconds<T extends NodeLike>(
  nodes: T[],
  chainId: string,
  charsPerMinute = DEFAULT_CHARS_PER_MINUTE,
): number {
  let seconds = 0;
  for (const n of mainPath(nodes, chainId)) {
    const answer = n.branches[0]?.expectedAnswer ?? "";
    const chars = countSpeechChars(n.question) + countSpeechChars(answer);
    seconds += (chars / charsPerMinute) * 60 + TURN_OVERHEAD_SECONDS;
  }
  return Math.round(seconds);
}

/** 8分のうち、実際に質問に使える時間の目安（冒頭の確認や予備を除く） */
export const EIGHT_MINUTE_BUDGET_SECONDS = 7 * 60 + 30;

export interface ChainSummary {
  chainId: string;
  priority: number;
  stuckCount: number;
  paragraphOrder: number;
  seconds: number;
}

/**
 * 8分セットを選ぶ（§4.2）。
 * 優先度（＋練習で詰まった回数）の高い連鎖から、時間の予算に収まるだけ採る。
 * 並びは立論の段落順（相手の立論を頭から順に詰める流れにする）。
 */
export function selectEightMinuteSet(
  chains: ChainSummary[],
  budget = EIGHT_MINUTE_BUDGET_SECONDS,
): Map<string, number> {
  const ranked = [...chains].sort(
    (a, b) =>
      b.priority + Math.min(b.stuckCount, 3) * 0.5 -
        (a.priority + Math.min(a.stuckCount, 3) * 0.5) ||
      a.paragraphOrder - b.paragraphOrder,
  );
  const picked: ChainSummary[] = [];
  let used = 0;
  for (const c of ranked) {
    if (used + c.seconds > budget) continue;
    picked.push(c);
    used += c.seconds;
  }
  picked.sort((a, b) => a.paragraphOrder - b.paragraphOrder || b.priority - a.priority);
  return new Map(picked.map((c, i) => [c.chainId, i + 1]));
}

export interface ScriptLine {
  speaker: "質問" | "回答";
  text: string;
  kind?: BranchKind;
  nodeId: string;
}

/**
 * 分岐図のノードを押したときの台本（§5）。
 * 起点からそのノードまでの経路を会話形式で並べる。
 * どの分岐を通って来たか（認める／否定する／はぐらかす）も示す。
 */
export function scriptTo<T extends NodeLike>(nodes: T[], targetId: string): ScriptLine[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, { nodeId: string; branchIndex: number }>();
  for (const n of nodes) {
    n.branches.forEach((b, i) => {
      if (b.followUpNodeId && !parent.has(b.followUpNodeId)) {
        parent.set(b.followUpNodeId, { nodeId: n.id, branchIndex: i });
      }
    });
  }

  const chain: { node: T; viaBranch?: number }[] = [];
  const seen = new Set<string>();
  let id: string | undefined = targetId;
  let via: number | undefined;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = byId.get(id);
    if (!node) break;
    chain.unshift({ node, viaBranch: via });
    const p = parent.get(id);
    via = p?.branchIndex;
    id = p?.nodeId;
  }

  const lines: ScriptLine[] = [];
  chain.forEach(({ node }, i) => {
    lines.push({ speaker: "質問", text: node.question, nodeId: node.id });
    const next = chain[i + 1];
    if (next) {
      // 次のノードへ進んだ分岐の回答を挟む
      const branch = node.branches.find((b) => b.followUpNodeId === next.node.id);
      if (branch) {
        lines.push({
          speaker: "回答",
          text: branch.expectedAnswer,
          kind: branch.kind,
          nodeId: node.id,
        });
      }
    }
  });
  return lines;
}

/** 質問文を比べるための正規化（同趣旨の重複を弾く一次判定） */
export function questionKey(q: string): string {
  return q
    .normalize("NFKC")
    .replace(/[\s、。？?！!「」『』（）()]/g, "")
    .slice(0, 40);
}
