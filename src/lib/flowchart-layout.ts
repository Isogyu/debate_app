/**
 * 質疑フローチャートの配置計算（v6 要件 §5）
 *
 * 画面（React Flow）と印刷（静的SVG）で同じ配置を使う。
 * 手で座標を決めると分岐が重なるので、配置は ELK（layered）に任せる。
 * サーバー・ブラウザ・テストのどこからでも呼べるよう、DOM や React には依存しない。
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { BranchKind, CrossExamBranch } from "../domain/types.ts";

export type BoxKind = "question" | BranchKind | "goal";

/** 配置に必要な最小限のノード情報（CrossExamNode の部分集合） */
export interface LayoutSourceNode {
  id: string;
  chainId: string;
  chainOrder: number;
  question: string;
  purpose?: string;
  modelAnswer?: string;
  goal?: string;
  branches: CrossExamBranch[];
}

export interface LayoutBox {
  id: string;
  kind: BoxKind;
  text: string;
  /** 箱の下段に小さく出す補足（ねらい・模範回答・突ける点など） */
  subText?: string;
  /** 補足の見出し（「ねらい」「模範回答」など） */
  subLabel?: string;
  /** 元の質問ノード。回答の箱は、その回答が属する質問ノード */
  nodeId: string;
  /** 回答の箱なら、質問ノードの branches 内の位置 */
  branchIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** 始点・曲がり角・終点（ELK の直交配線） */
  points: { x: number; y: number }[];
  /** 起点から結論へ直接つなぐ仮の線（認める回答が1つもない連鎖） */
  dashed?: boolean;
}

export interface Layout {
  chainId: string;
  boxes: LayoutBox[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** 箱の下段に何を出すか。攻める側は「ねらい」、守る側は「模範回答」 */
export type SubTextMode = "purpose" | "modelAnswer" | "none";

export interface LayoutOptions {
  subText?: SubTextMode;
  /** 画面は左→右（分岐が縦に並ぶ）。印刷は上→下にすると A4 の幅に収まりやすい */
  direction?: "RIGHT" | "DOWN";
}

// ── 箱の寸法 ──────────────────────────────────────────
// 画面と印刷で同じ値を使う。文字の大きさを変えるならここを変える。
export const BOX_WIDTH = 220;
export const BOX_PADDING = 10;
export const HEADER_HEIGHT = 18;
export const TEXT_FONT_SIZE = 13;
export const TEXT_LINE_HEIGHT = 19;
export const SUB_FONT_SIZE = 11;
export const SUB_LINE_HEIGHT = 16;
/** 本文と補足の間 */
const SECTION_GAP = 6;

/** 1行に入る全角文字数。幅から逆算する（220px なら15字前後） */
export function charsPerLine(fontSize: number, width = BOX_WIDTH): number {
  return Math.max(4, Math.floor((width - BOX_PADDING * 2) / fontSize));
}

/**
 * 日本語の折り返し。ブラウザの計測は印刷SVGやサーバーでは使えないので、
 * 全角1・半角0.55 の幅で見積もって行に分ける。
 * 句読点が行頭に来ないよう、はみ出す句読点は前の行に残す（ぶら下げ）。
 */
export function wrapText(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    let units = 0;
    for (const ch of Array.from(para)) {
      const w = /[ -~\u00a0-\u00ff\uff61-\uff9f]/.test(ch) ? 0.55 : 1;
      if (units + w > maxUnits && line && !/^[、。，．）」』！？]$/.test(ch)) {
        lines.push(line);
        line = "";
        units = 0;
      }
      line += ch;
      units += w;
    }
    lines.push(line);
  }
  return lines;
}

function estimateHeight(text: string, subText?: string): number {
  const main = wrapText(text, charsPerLine(TEXT_FONT_SIZE)).length;
  let h = BOX_PADDING * 2 + HEADER_HEIGHT + main * TEXT_LINE_HEIGHT;
  if (subText) {
    // 補足の見出し1行ぶんも足す
    const sub = wrapText(subText, charsPerLine(SUB_FONT_SIZE)).length + 1;
    h += SECTION_GAP + sub * SUB_LINE_HEIGHT;
  }
  return Math.ceil(h);
}

export const questionBoxId = (nodeId: string) => `q:${nodeId}`;
export const answerBoxId = (nodeId: string, i: number) => `a:${nodeId}:${i}`;
export const goalBoxId = (chainId: string) => `goal:${chainId}`;

export interface ChainGraph {
  graph: ElkNode;
  /** 座標が入る前の箱（x, y は 0） */
  boxes: LayoutBox[];
  dashedEdges: Set<string>;
  chainId: string;
}

/**
 * 1つの連鎖を ELK のグラフにする（座標計算の前段、テスト用に分けている）。
 * 質問 → 回答（分岐ごとの箱）→ 次の質問 … → 引き出したい結論。
 * 続きの質問がない回答は、そこで止まる「行き止まりの回答」の箱になる。
 */
export function buildChainGraph(
  nodes: LayoutSourceNode[],
  options: LayoutOptions = {},
): ChainGraph {
  const mode = options.subText ?? "purpose";
  const sorted = [...nodes].sort((a, b) => a.chainOrder - b.chainOrder);
  const root = sorted[0];
  const chainId = root?.chainId ?? "";
  const ids = new Set(sorted.map((n) => n.id));

  const boxes: LayoutBox[] = [];
  const edges: ElkExtendedEdge[] = [];
  const dashedEdges = new Set<string>();
  const terminalAdmits: string[] = [];

  const addBox = (b: Omit<LayoutBox, "x" | "y" | "height">) => {
    boxes.push({ ...b, x: 0, y: 0, height: estimateHeight(b.text, b.subText) });
  };
  const addEdge = (source: string, target: string) => {
    edges.push({ id: `e:${source}->${target}`, sources: [source], targets: [target] });
    return `e:${source}->${target}`;
  };

  for (const n of sorted) {
    const qid = questionBoxId(n.id);
    const sub =
      mode === "purpose"
        ? n.purpose
          ? { subText: n.purpose, subLabel: "ねらい" }
          : {}
        : mode === "modelAnswer"
          ? n.modelAnswer
            ? { subText: n.modelAnswer, subLabel: "模範回答" }
            : {}
          : {};
    addBox({ id: qid, kind: "question", text: n.question, nodeId: n.id, width: BOX_WIDTH, ...sub });

    n.branches.forEach((b, i) => {
      const aid = answerBoxId(n.id, i);
      // 守る側の見え方では「突ける点」は出さない（自分の弱点は模範回答で受ける）
      const weak =
        mode === "purpose" && b.exposedWeakness
          ? { subText: b.exposedWeakness, subLabel: "突ける点" }
          : {};
      addBox({
        id: aid,
        kind: b.kind,
        text: b.expectedAnswer,
        nodeId: n.id,
        branchIndex: i,
        width: BOX_WIDTH,
        ...weak,
      });
      addEdge(qid, aid);
      // 連鎖の外や存在しないノードを指す続きは、行き止まり扱いにする
      if (b.followUpNodeId && ids.has(b.followUpNodeId)) {
        addEdge(aid, questionBoxId(b.followUpNodeId));
      } else if (b.kind === "admit") {
        terminalAdmits.push(aid);
      }
    });
  }

  const goal = root?.goal ?? sorted.find((n) => n.goal)?.goal;
  if (root && goal) {
    const gid = goalBoxId(chainId);
    addBox({ id: gid, kind: "goal", text: goal, nodeId: root.id, width: BOX_WIDTH });
    if (terminalAdmits.length > 0) {
      for (const a of terminalAdmits) addEdge(a, gid);
    } else {
      dashedEdges.add(addEdge(questionBoxId(root.id), gid));
    }
  }

  const graph: ElkNode = {
    id: `chain:${chainId}`,
    layoutOptions: {
      "elk.algorithm": "layered",
      // 既定は左から右へ。分岐が縦に並ぶので、幅固定の日本語の箱でも読みやすい
      "elk.direction": options.direction ?? "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.nodeNode": "20",
      "elk.spacing.edgeNode": "14",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=12,left=12,bottom=12,right=12]",
    },
    children: boxes.map((b) => ({ id: b.id, width: b.width, height: b.height })),
    edges,
  };
  return { graph, boxes, dashedEdges, chainId };
}

let elk: InstanceType<typeof ELK> | null = null;

/** 1つの連鎖（同じ chainId のノード群）を配置する */
export async function layoutChain(
  nodes: LayoutSourceNode[],
  options: LayoutOptions = {},
): Promise<Layout> {
  const { graph, boxes, dashedEdges, chainId } = buildChainGraph(nodes, options);
  if (boxes.length === 0) return { chainId, boxes: [], edges: [], width: 0, height: 0 };

  elk ??= new ELK();
  const result = await elk.layout(graph);

  const pos = new Map((result.children ?? []).map((c) => [c.id, c]));
  const placed = boxes.map((b) => {
    const p = pos.get(b.id);
    return { ...b, x: p?.x ?? 0, y: p?.y ?? 0 };
  });

  const edges: LayoutEdge[] = (result.edges ?? []).map((e) => {
    const s = (e as ElkExtendedEdge).sections?.[0];
    const points = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : [];
    const edge: LayoutEdge = {
      id: e.id,
      source: (e as ElkExtendedEdge).sources[0],
      target: (e as ElkExtendedEdge).targets[0],
      points: points.map(({ x, y }) => ({ x, y })),
    };
    if (dashedEdges.has(e.id)) edge.dashed = true;
    return edge;
  });

  return {
    chainId,
    boxes: placed,
    edges,
    width: Math.ceil(result.width ?? 0),
    height: Math.ceil(result.height ?? 0),
  };
}

/** 折れ線の SVG path（画面・印刷の両方で使う） */
export function edgePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

// ── 連鎖のまとめ・並べ替え（画面と印刷で共通） ─────────────────

export interface ChainSortable extends LayoutSourceNode {
  priority: number;
  setOrder?: number | null;
}

export interface ChainGroup<T extends ChainSortable> {
  chainId: string;
  /** 起点（chainOrder が最小のノード）。段落・優先度・結論はここに入る */
  root: T;
  nodes: T[];
}

const hasSetOrder = (n: { setOrder?: number | null }) =>
  typeof n.setOrder === "number";

/**
 * ノードを連鎖ごとにまとめて並べる。
 * 攻める側: 実際の8分で使う順（8分セット → 優先度の高い順）。
 * 守る側: 突かれやすい順（優先度の高い順 → 8分セットの順）。
 * 同順位は元の並び（立論の段落順）を保つ。
 */
export function groupChains<T extends ChainSortable>(
  nodes: T[],
  order: "attack" | "defense" = "attack",
): ChainGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const n of nodes) {
    const list = map.get(n.chainId);
    if (list) list.push(n);
    else map.set(n.chainId, [n]);
  }
  const groups = [...map.entries()].map(([chainId, list]) => {
    const sorted = [...list].sort((a, b) => a.chainOrder - b.chainOrder);
    return { chainId, root: sorted[0], nodes: sorted };
  });

  const bySet = (a: ChainGroup<T>, b: ChainGroup<T>) => {
    const sa = hasSetOrder(a.root) ? (a.root.setOrder as number) : Infinity;
    const sb = hasSetOrder(b.root) ? (b.root.setOrder as number) : Infinity;
    return sa === sb ? 0 : sa - sb;
  };
  const byPriority = (a: ChainGroup<T>, b: ChainGroup<T>) =>
    b.root.priority - a.root.priority;

  return groups.sort((a, b) =>
    order === "attack"
      ? bySet(a, b) || byPriority(a, b)
      : byPriority(a, b) || bySet(a, b),
  );
}
