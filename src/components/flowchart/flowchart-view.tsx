"use client";

/**
 * 質疑フローチャート（画面・操作型、v6 要件 §5）
 *
 * 同じ質疑データを「攻める側」「守る側」の両面で見せる（§4.1）。
 * 図は連鎖ごとのカードに分け、それぞれ拡大・縮小・折り畳みができる。
 * 1枚の大きな図にしないのは、30〜40問を一度に出すとスマホで迷子になるため。
 */

import "@xyflow/react/dist/style.css";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { mainPath, scriptTo } from "@/domain/cross-exam";
import {
  ATTACK_POINT_LABELS,
  BRANCH_KIND_LABELS,
  type BranchKind,
  type CrossExamNode,
} from "@/domain/types";
import {
  answerBoxId,
  edgePath,
  goalBoxId,
  groupChains,
  layoutChain,
  questionBoxId,
  type BoxKind,
  type ChainGroup,
  type Layout,
  type LayoutBox,
} from "@/lib/flowchart-layout";

/** サーバーから渡せる（シリアライズできる）質疑ノード */
export type FlowNode = Pick<
  CrossExamNode,
  | "id"
  | "chainId"
  | "chainOrder"
  | "targetParagraph"
  | "attackPoint"
  | "question"
  | "purpose"
  | "modelAnswer"
  | "goal"
  | "priority"
  | "origin"
  | "stuckCount"
  | "branches"
> & {
  /** DB からは null で来ることがある */
  setOrder?: number | null;
};

export type Perspective = "attack" | "defense";

// ── 色分け ────────────────────────────────────────────
// 色だけに頼らないよう、箱の上に必ず種類の文字（質問／認める…）も出す。
export const BOX_STYLES: Record<BoxKind, { label: string; border: string; bg: string }> = {
  question: { label: "質問", border: "var(--accent)", bg: "#eff6ff" },
  admit: { label: BRANCH_KIND_LABELS.admit, border: "var(--aff)", bg: "#f0fdf4" },
  deny: { label: BRANCH_KIND_LABELS.deny, border: "var(--neg)", bg: "#fff7ed" },
  evade: { label: BRANCH_KIND_LABELS.evade, border: "#a16207", bg: "#fefce8" },
  goal: { label: "引き出したい結論", border: "#7c3aed", bg: "#f5f3ff" },
};

const LEGEND_ORDER: BoxKind[] = ["question", "admit", "deny", "evade", "goal"];

export function FlowchartLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="色の見方">
      {LEGEND_ORDER.map((k) => (
        <li key={k} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-3 w-4 rounded-sm border-2"
            style={{ borderColor: BOX_STYLES[k].border, background: BOX_STYLES[k].bg }}
          />
          {BOX_STYLES[k].label}
        </li>
      ))}
    </ul>
  );
}

// ── 台本 ──────────────────────────────────────────────

interface ViewLine {
  speaker: "質問" | "回答" | "結論";
  text: string;
  kind?: BranchKind;
  note?: { label: string; text: string };
}

interface Selection {
  chainId: string;
  box: Pick<LayoutBox, "id" | "kind" | "nodeId" | "branchIndex">;
}

/**
 * 押された箱までの台本を組み立てる。
 * 質問の箱 → 起点からその質問まで。回答の箱 → その回答（と続きの質問）まで。
 * 結論の箱 → 主経路をたどって結論まで。
 * あわせて、図で強調する箱の id も返す。
 */
function buildScript(
  nodes: FlowNode[],
  sel: Selection,
  perspective: Perspective,
): { lines: ViewLine[]; boxIds: Set<string> } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines: ViewLine[] = [];
  const boxIds = new Set<string>();

  const pushQuestion = (n: FlowNode) => {
    lines.push({
      speaker: "質問",
      text: n.question,
      note:
        perspective === "defense"
          ? n.modelAnswer
            ? { label: "模範回答", text: n.modelAnswer }
            : undefined
          : n.purpose
            ? { label: "ねらい", text: n.purpose }
            : undefined,
    });
    boxIds.add(questionBoxId(n.id));
  };
  const pushAnswer = (n: FlowNode, i: number) => {
    const b = n.branches[i];
    if (!b) return;
    lines.push({
      speaker: "回答",
      text: b.expectedAnswer,
      kind: b.kind,
      note:
        perspective === "attack" && b.exposedWeakness
          ? { label: "突ける点", text: b.exposedWeakness }
          : undefined,
    });
    boxIds.add(answerBoxId(n.id, i));
  };
  // scriptTo の結果を、ねらい・模範回答つきの行に置き換える
  const pushPathTo = (targetId: string) => {
    const script = scriptTo(nodes, targetId);
    script.forEach((line, idx) => {
      const n = byId.get(line.nodeId);
      if (!n) return;
      if (line.speaker === "質問") {
        pushQuestion(n);
      } else {
        const nextId = script[idx + 1]?.nodeId;
        const i = n.branches.findIndex((b) => b.followUpNodeId === nextId);
        pushAnswer(n, i >= 0 ? i : 0);
      }
    });
  };

  const { box } = sel;
  if (box.kind === "question") {
    pushPathTo(box.nodeId);
  } else if (box.kind === "goal") {
    const path = mainPath(nodes, sel.chainId);
    const last = path.at(-1);
    if (last) {
      pushPathTo(last.id);
      const i = last.branches.findIndex((b) => b.kind === "admit" && !b.followUpNodeId);
      const j = i >= 0 ? i : last.branches.findIndex((b) => b.kind === "admit");
      if (j >= 0) pushAnswer(last, j);
    }
    const goal = path[0]?.goal;
    if (goal) lines.push({ speaker: "結論", text: goal });
    boxIds.add(goalBoxId(sel.chainId));
  } else {
    const n = byId.get(box.nodeId);
    if (n && box.branchIndex != null) {
      pushPathTo(n.id);
      pushAnswer(n, box.branchIndex);
      const next = n.branches[box.branchIndex]?.followUpNodeId;
      const nextNode = next ? byId.get(next) : undefined;
      if (nextNode) pushQuestion(nextNode);
    }
  }
  return { lines, boxIds };
}

function ScriptPanel({
  lines,
  onClose,
}: {
  lines: ViewLine[] | null;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="台本"
      aria-live="polite"
      className="rounded border border-[var(--line)] bg-white p-3 text-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-bold">台本</h4>
        {lines && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--line)] px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            閉じる
          </button>
        )}
      </div>
      {!lines ? (
        <p className="text-[var(--muted)]">
          図の箱を押すと、最初の質問からそこまでのやりとりが会話の形で読めます。
        </p>
      ) : (
        <ol className="space-y-2">
          {lines.map((l, i) => {
            const style =
              l.speaker === "質問"
                ? BOX_STYLES.question
                : l.speaker === "結論"
                  ? BOX_STYLES.goal
                  : BOX_STYLES[l.kind ?? "admit"];
            return (
              <li key={i} className="rounded border-l-4 pl-2" style={{ borderColor: style.border }}>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-bold">{l.speaker === "結論" ? "引き出したい結論" : l.speaker}</span>
                  {l.kind && (
                    <span
                      className="rounded px-1.5 text-white"
                      style={{ background: BOX_STYLES[l.kind].border }}
                    >
                      {BRANCH_KIND_LABELS[l.kind]}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{l.text}</p>
                {l.note && (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    <span className="font-bold">{l.note.label}：</span>
                    {l.note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ── React Flow の部品 ─────────────────────────────────

interface BoxData extends Record<string, unknown> {
  box: LayoutBox;
  active: boolean;
  onPath: boolean;
}

/** 箱が押されたときの通知。data に関数を入れず、文脈で渡す */
const SelectContext = createContext<(box: LayoutBox) => void>(() => {});

function BoxNode({ data }: NodeProps<Node<BoxData, "box">>) {
  const onSelect = useContext(SelectContext);
  const { box, active, onPath } = data;
  const style = BOX_STYLES[box.kind];
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <button
        type="button"
        onClick={() => onSelect(box)}
        aria-pressed={active}
        aria-label={`${style.label}：${box.text}。押すと台本を表示`}
        className="block w-full rounded-md border-2 p-[10px] text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
        style={{
          minHeight: box.height,
          borderColor: style.border,
          background: style.bg,
          boxShadow: active
            ? `0 0 0 3px ${style.border}`
            : onPath
              ? `0 0 0 2px ${style.border}55`
              : undefined,
          borderStyle: box.kind === "goal" ? "double" : "solid",
          borderWidth: box.kind === "goal" ? 4 : 2,
        }}
      >
        <span className="block h-[18px] text-[11px] font-bold leading-[18px]" style={{ color: style.border }}>
          {style.label}
        </span>
        <span className="block whitespace-pre-wrap break-all text-[13px] leading-[19px] text-[var(--foreground)]">
          {box.text}
        </span>
        {box.subText && (
          <span className="mt-1.5 block whitespace-pre-wrap break-all border-t border-dashed border-[var(--line)] pt-1 text-[11px] leading-4 text-[var(--muted)]">
            <span className="block font-bold">{box.subLabel}</span>
            {box.subText}
          </span>
        )}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </>
  );
}

interface ElkEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  dashed?: boolean;
}

/** ELK が計算した直交の経路をそのまま描く（React Flow の自動経路は使わない） */
function ElkEdge({ id, data, markerEnd }: EdgeProps<Edge<ElkEdgeData, "elk">>) {
  const points = data?.points ?? [];
  if (points.length < 2) return null;
  return (
    <BaseEdge
      id={id}
      path={edgePath(points)}
      markerEnd={markerEnd}
      style={{ stroke: "#6b7280", strokeWidth: 1.5, strokeDasharray: data?.dashed ? "6 4" : undefined }}
    />
  );
}

// 描画のたびに作り直すと React Flow が警告するので、モジュールの外側で固定する
const nodeTypes = { box: BoxNode };
const edgeTypes = { elk: ElkEdge };

function ZoomButtons() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btn =
    "rounded border border-[var(--line)] bg-white px-2 py-1 text-xs shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
  return (
    <Panel position="top-right" className="flex gap-1">
      <button type="button" className={btn} onClick={() => zoomIn()} aria-label="拡大">
        ＋ 拡大
      </button>
      <button type="button" className={btn} onClick={() => zoomOut()} aria-label="縮小">
        − 縮小
      </button>
      <button type="button" className={btn} onClick={() => fitView({ padding: 0.1 })} aria-label="全体を表示">
        全体
      </button>
    </Panel>
  );
}

function ChainCanvas({
  chainNodes,
  perspective,
  activeBoxId,
  pathBoxIds,
  onSelect,
}: {
  chainNodes: FlowNode[];
  perspective: Perspective;
  activeBoxId: string | null;
  pathBoxIds: Set<string>;
  onSelect: (box: LayoutBox) => void;
}) {
  const [layout, setLayout] = useState<{ key: string; value: Layout } | null>(null);
  const [error, setError] = useState(false);
  const key = `${perspective}:${chainNodes.map((n) => n.id).join(",")}`;

  useEffect(() => {
    let cancelled = false;
    layoutChain(chainNodes, { subText: perspective === "defense" ? "modelAnswer" : "purpose" })
      .then((value) => {
        if (!cancelled) setLayout({ key, value });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chainNodes, perspective, key]);

  const current = layout?.key === key ? layout.value : null;

  const rfNodes = useMemo<Node<BoxData, "box">[]>(
    () =>
      (current?.boxes ?? []).map((b) => ({
        id: b.id,
        type: "box",
        position: { x: b.x, y: b.y },
        width: b.width,
        data: { box: b, active: b.id === activeBoxId, onPath: pathBoxIds.has(b.id) },
        draggable: false,
        connectable: false,
        // 選択もドラッグも切っていると React Flow が箱のクリックを受け付けなくなる。
        // 箱の中のボタンで台本を開くので、クリックは通す
        style: { pointerEvents: "all" as const },
      })),
    [current, activeBoxId, pathBoxIds],
  );
  const rfEdges = useMemo<Edge<ElkEdgeData, "elk">[]>(
    () =>
      (current?.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "elk",
        data: { points: e.points, dashed: e.dashed },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
      })),
    [current],
  );

  if (error) {
    return <p className="p-4 text-sm text-[var(--neg)]">図を並べられませんでした。ページを読み込み直してください。</p>;
  }
  if (!current) {
    return <p className="p-4 text-sm text-[var(--muted)]">図を並べています…</p>;
  }

  // 小さい連鎖で余白だらけにならないよう、図の高さに合わせる（上限あり）
  const height = Math.min(Math.max(current.height + 60, 220), 520);
  return (
    <SelectContext.Provider value={onSelect}>
      <div
        className="w-full overflow-hidden rounded border border-[var(--line)] bg-white"
        style={{ height, maxHeight: "65vh" }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          // ページのスクロールを奪わない。拡大・縮小はボタンとピンチで行う
          zoomOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
        >
          <ZoomButtons />
        </ReactFlow>
      </div>
    </SelectContext.Provider>
  );
}

// ── 連鎖のカード ──────────────────────────────────────

function ChainCard({
  chain,
  index,
  perspective,
  expanded,
  onToggle,
  selection,
  onSelect,
  onClear,
}: {
  chain: ChainGroup<FlowNode>;
  index: number;
  perspective: Perspective;
  expanded: boolean;
  onToggle: () => void;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  onClear: () => void;
}) {
  const { root, nodes, chainId } = chain;
  const mine = selection?.chainId === chainId ? selection : null;
  const script = useMemo(
    () => (mine ? buildScript(nodes, mine, perspective) : null),
    [mine, nodes, perspective],
  );
  const emptySet = useMemo(() => new Set<string>(), []);
  const bodyId = `chain-body-${chainId}`;
  const single = nodes.length === 1;

  return (
    <article className="rounded-lg border border-[var(--line)] bg-white">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--line)] p-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            {typeof root.setOrder === "number" && (
              <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 font-bold text-white">
                8分セット {root.setOrder}番目
              </span>
            )}
            <span className="rounded border border-[var(--line)] px-1.5 py-0.5">{root.targetParagraph}</span>
            <span className="rounded border border-[var(--line)] px-1.5 py-0.5">
              {ATTACK_POINT_LABELS[root.attackPoint]}
            </span>
            <span className="text-[var(--muted)]">
              優先度 {"★".repeat(Math.max(0, Math.min(5, root.priority)))}
              <span className="sr-only">（5段階中{root.priority}）</span>
            </span>
            <span className="text-[var(--muted)]">{single ? "単発の質問" : `${nodes.length}問の連鎖`}</span>
            {root.origin === "practice" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">練習から追加</span>
            )}
            {nodes.some((n) => n.stuckCount > 0) && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800">
                練習で詰まった {nodes.reduce((s, n) => s + n.stuckCount, 0)}回
              </span>
            )}
          </div>
          <h3 className="font-bold">
            <span className="text-[var(--muted)]">{index + 1}. </span>
            {root.question}
          </h3>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="shrink-0 rounded border border-[var(--line)] px-3 py-1 text-sm hover:bg-gray-50"
        >
          {expanded ? "たたむ" : "図を開く"}
        </button>
      </header>

      <div id={bodyId} className="p-3">
        {expanded ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
            <ChainCanvas
              chainNodes={nodes}
              perspective={perspective}
              activeBoxId={mine?.box.id ?? null}
              pathBoxIds={script?.boxIds ?? emptySet}
              onSelect={(box) => onSelect({ chainId, box })}
            />
            <ScriptPanel lines={script?.lines ?? null} onClose={onClear} />
          </div>
        ) : (
          // たたんだ状態: 起点の質問と、引き出したい結論だけ
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-stretch">
            <CollapsedBox kind="question" text={root.question} />
            {perspective === "defense" && root.modelAnswer && (
              <CollapsedBox kind="admit" label="模範回答" text={root.modelAnswer} />
            )}
            {root.goal && (
              <>
                <span aria-hidden className="self-center text-[var(--muted)]">
                  <span className="hidden sm:inline">→</span>
                  <span className="sm:hidden">↓</span>
                </span>
                <CollapsedBox kind="goal" text={root.goal} />
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function CollapsedBox({ kind, text, label }: { kind: BoxKind; text: string; label?: string }) {
  const s = BOX_STYLES[kind];
  return (
    <div className="flex-1 rounded-md border-2 p-2" style={{ borderColor: s.border, background: s.bg }}>
      <div className="text-[11px] font-bold" style={{ color: s.border }}>
        {label ?? s.label}
      </div>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

// ── 画面全体 ──────────────────────────────────────────

export function FlowchartView({
  nodes,
  perspective: initialPerspective = "attack",
}: {
  nodes: FlowNode[];
  perspective?: Perspective;
}) {
  const [perspective, setPerspective] = useState<Perspective>(initialPerspective);
  const [paragraph, setParagraph] = useState("");
  const [setOnly, setSetOnly] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const allChains = useMemo(() => groupChains(nodes, perspective), [nodes, perspective]);

  // 最初に開いておく連鎖: 8分セット。なければ先頭の3つ
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const chains = groupChains(nodes, "attack");
    const set = chains.filter((c) => typeof c.root.setOrder === "number");
    return new Set((set.length > 0 ? set : chains.slice(0, 3)).map((c) => c.chainId));
  });

  const paragraphs = useMemo(() => {
    const seen: string[] = [];
    for (const c of groupChains(nodes, "attack")) {
      if (c.root.targetParagraph && !seen.includes(c.root.targetParagraph)) {
        seen.push(c.root.targetParagraph);
      }
    }
    // 段落番号順に並べる（"1（2）…" のような表記を数字として比べる）
    return seen.sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
  }, [nodes]);

  const chains = allChains.filter(
    (c) =>
      (!paragraph || c.root.targetParagraph === paragraph) &&
      (!setOnly || typeof c.root.setOrder === "number"),
  );
  const hasSet = allChains.some((c) => typeof c.root.setOrder === "number");

  const toggle = (chainId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });

  if (nodes.length === 0) {
    return <p className="text-sm text-[var(--muted)]">この立論の質疑はまだありません。</p>;
  }

  const tab = (p: Perspective, label: string, hint: string) => (
    <button
      type="button"
      aria-pressed={perspective === p}
      onClick={() => setPerspective(p)}
      title={hint}
      className={`px-3 py-1.5 text-sm ${
        perspective === p ? "bg-[var(--accent)] font-bold text-white" : "bg-white hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-[var(--line)] bg-gray-50 p-3 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="見る立場" className="inline-flex overflow-hidden rounded border border-[var(--line)]">
            {tab("attack", "攻める側で見る", "質問のねらいと、相手の答えから突ける点を強調します")}
            {tab("defense", "守る側で見る", "各質問への模範回答を強調し、突かれやすい順に並べます")}
          </div>
          <label className="flex items-center gap-1 text-sm">
            段落
            <select
              value={paragraph}
              onChange={(e) => setParagraph(e.target.value)}
              className="rounded border border-[var(--line)] bg-white px-2 py-1"
            >
              <option value="">すべて</option>
              {paragraphs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-1 text-sm ${hasSet ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={setOnly}
              disabled={!hasSet}
              onChange={(e) => setSetOnly(e.target.checked)}
            />
            8分セットだけ
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setExpanded(new Set(chains.map((c) => c.chainId)))}
              className="rounded border border-[var(--line)] bg-white px-2 py-1 text-xs hover:bg-gray-50"
            >
              すべて開く
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="rounded border border-[var(--line)] bg-white px-2 py-1 text-xs hover:bg-gray-50"
            >
              すべてたたむ
            </button>
          </div>
        </div>
        <FlowchartLegend />
        <p className="text-xs text-[var(--muted)]">
          {perspective === "attack"
            ? "相手の立論を詰める順（8分セット → 優先度の高い順）に並んでいます。箱を押すと、そこまでの台本が出ます。"
            : "突かれやすい順（優先度の高い順）に並んでいます。質問の箱の下に模範回答を出しています。"}
        </p>
      </div>

      {chains.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">条件に合う質疑がありません。絞り込みを外してください。</p>
      ) : (
        <div className="space-y-4">
          {chains.map((c, i) => (
            <ChainCard
              key={c.chainId}
              chain={c}
              index={i}
              perspective={perspective}
              expanded={expanded.has(c.chainId)}
              onToggle={() => toggle(c.chainId)}
              selection={selection}
              onSelect={setSelection}
              onClear={() => setSelection(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
