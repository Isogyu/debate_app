/**
 * 質疑練習（F11）の純粋な計算部品
 *
 * LLM には DB の ID ではなく短いキー（q1, c1 …）で質疑を見せる。
 * ID は長くて写し間違えやすく、間違えると反映先がずれるため。
 * キーと ID の対応はここで作り、応答を受けたらコード側で引き戻す。
 */

import { countSpeechChars, estimateSeconds, DEFAULT_CHARS_PER_MINUTE } from "./speech.ts";
import type { CrossExamNode, PracticeMode, PracticeTurn } from "./types";

export type KeyedNodeInput = Pick<
  CrossExamNode,
  | "id"
  | "chainId"
  | "chainOrder"
  | "question"
  | "modelAnswer"
  | "purpose"
  | "goal"
  | "priority"
  | "setOrder"
  | "stuckCount"
  | "targetParagraph"
  | "branches"
>;

export interface KeyedNode<T extends KeyedNodeInput = KeyedNodeInput> {
  key: string;
  node: T;
}

export interface KeyedChain<T extends KeyedNodeInput = KeyedNodeInput> {
  key: string;
  chainId: string;
  goal: string;
  paragraph: string;
  inEightMinuteSet: boolean;
  nodes: KeyedNode<T>[];
}

export interface QuestionKeyMap<T extends KeyedNodeInput = KeyedNodeInput> {
  chains: KeyedChain<T>[];
  nodeIdByKey: Map<string, string>;
  keyByNodeId: Map<string, string>;
  chainIdByKey: Map<string, string>;
}

/**
 * 質疑にキーを振る。並びは「8分セット（setOrder 順）→ それ以外（優先度・詰まった回数の高い順）」。
 * プロンプトの上にあるほど AI が使いやすいので、実戦で使う流れを先に置く。
 * maxNodes を超える連鎖は落とす（プロンプトが長すぎると応答が遅く、指示も薄まる）。
 */
export function buildQuestionKeys<T extends KeyedNodeInput>(
  nodes: T[],
  maxNodes = Infinity,
): QuestionKeyMap<T> {
  const byChain = new Map<string, T[]>();
  for (const n of nodes) {
    const list = byChain.get(n.chainId) ?? [];
    list.push(n);
    byChain.set(n.chainId, list);
  }
  const groups = [...byChain.entries()].map(([chainId, members]) => {
    const sorted = [...members].sort((a, b) => a.chainOrder - b.chainOrder);
    const root = sorted[0];
    return {
      chainId,
      members: sorted,
      root,
      setOrder: root.setOrder ?? null,
      priority: root.priority,
      stuck: Math.max(...sorted.map((m) => m.stuckCount)),
    };
  });
  groups.sort((a, b) => {
    const aIn = a.setOrder !== null;
    const bIn = b.setOrder !== null;
    if (aIn !== bIn) return aIn ? -1 : 1;
    if (aIn && bIn) return (a.setOrder as number) - (b.setOrder as number);
    return b.priority - a.priority || b.stuck - a.stuck;
  });

  const out: QuestionKeyMap<T> = {
    chains: [],
    nodeIdByKey: new Map(),
    keyByNodeId: new Map(),
    chainIdByKey: new Map(),
  };
  let q = 0;
  for (const g of groups) {
    if (q + g.members.length > maxNodes) continue;
    const chainKey = `c${out.chains.length + 1}`;
    const keyed: KeyedNode<T>[] = g.members.map((node) => {
      const key = `q${++q}`;
      out.nodeIdByKey.set(key, node.id);
      out.keyByNodeId.set(node.id, key);
      return { key, node };
    });
    out.chainIdByKey.set(chainKey, g.chainId);
    out.chains.push({
      key: chainKey,
      chainId: g.chainId,
      goal: g.root.goal ?? "",
      paragraph: g.root.targetParagraph,
      inEightMinuteSet: g.setOrder !== null,
      nodes: keyed,
    });
  }
  return out;
}

/** LLM が返したキーを ID に戻す。存在しないキー（写し間違い・創作）は捨てる */
export function keysToIds(keys: string[], idByKey: Map<string, string>): string[] {
  const ids = keys
    .map((k) => idByKey.get(k.trim().toLowerCase()))
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/**
 * 1回の発言として長すぎる目安（秒）。
 * 質疑は8分で、8分セットは1往復あたり発言＋6秒の間で見積もっている（cross-exam.ts）。
 * 8分で10往復以上は回したいので、1往復は40秒前後しか使えない。
 *  - 質問: 20秒（約107字）を超えると、1往復の半分以上を質問だけで使う。
 *    質疑は「はい／いいえ」で返せる短い質問を重ねるのが基本
 *  - 回答: 30秒（約160字）を超えると、相手の持ち時間を削る長話になり、
 *    審査員には「質問に答えずに時間を潰している」と映りやすい（要項7）
 */
export const LONG_TURN_SECONDS = { question: 20, answer: 30 } as const;

export interface TurnLength {
  index: number;
  text: string;
  chars: number;
  seconds: number;
  role: "question" | "answer";
  tooLong: boolean;
}

/** 練習者の発言ごとに読み上げ秒数を推定する（講評のプロンプトにも渡す） */
export function userTurnLengths(
  turns: Pick<PracticeTurn, "speaker" | "text">[],
  mode: PracticeMode,
  charsPerMinute = DEFAULT_CHARS_PER_MINUTE,
): TurnLength[] {
  // attack = 練習者が質問する側、defense = 答える側
  const role = mode === "attack" ? "question" : "answer";
  const limit = LONG_TURN_SECONDS[role];
  const out: TurnLength[] = [];
  turns.forEach((t, index) => {
    if (t.speaker !== "user") return;
    const chars = countSpeechChars(t.text);
    const seconds = estimateSeconds(chars, charsPerMinute);
    out.push({ index, text: t.text, chars, seconds, role, tooLong: seconds > limit });
  });
  return out;
}

/** 講評に残す長すぎた発言。画面では冒頭だけ見せる */
export function longTurnsOf(
  lengths: TurnLength[],
  excerptChars = 40,
): { excerpt: string; seconds: number }[] {
  return lengths
    .filter((l) => l.tooLong)
    .map((l) => ({
      excerpt: l.text.length > excerptChars ? `${l.text.slice(0, excerptChars)}…` : l.text,
      seconds: l.seconds,
    }));
}

function normalizeLabel(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s()（）「」・、。]/g, "")
    .toLowerCase();
}

/**
 * LLM が返した段落名を、立論の段落に対応付ける。
 * 完全一致 → 正規化して一致 → 見出し（タイトル）を含む、の順に探す。
 * 見つからなければ undefined（段落なしで保存する。無理に当てはめると質疑一覧で誤った箇所に並ぶ）。
 */
export function matchParagraph<P extends { claimId: string; label: string; title?: string }>(
  label: string,
  paragraphs: P[],
): P | undefined {
  const raw = label.trim();
  if (!raw) return undefined;
  const exact = paragraphs.find((p) => p.label === raw);
  if (exact) return exact;
  const key = normalizeLabel(raw);
  const normalized = paragraphs.find((p) => normalizeLabel(p.label) === key);
  if (normalized) return normalized;
  const byTitle = paragraphs.filter((p) => {
    const t = normalizeLabel(p.title ?? "");
    return t.length >= 2 && key.includes(t);
  });
  // 複数当たるときは曖昧なので当てはめない
  return byTitle.length === 1 ? byTitle[0] : undefined;
}
