/**
 * 質疑フローチャート（印刷・PDF用の静的な図、v6 要件 §5・F12）
 *
 * 連鎖ごとにページを分け、図の下に主経路の台本を付ける。
 * 白黒印刷でも区別できるよう、色だけでなく枠線の種類と「認める」などの文字で示す。
 * 図は inline SVG（tspan で折り返し）。foreignObject は印刷で崩れるブラウザがあるため使わない。
 */

import { mainPath } from "@/domain/cross-exam";
import { ATTACK_POINT_LABELS, BRANCH_KIND_LABELS, type BranchKind } from "@/domain/types";
import {
  BOX_PADDING,
  HEADER_HEIGHT,
  SUB_FONT_SIZE,
  SUB_LINE_HEIGHT,
  TEXT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  charsPerLine,
  edgePath,
  groupChains,
  layoutChain,
  wrapText,
  type BoxKind,
  type Layout,
  type LayoutBox,
} from "@/lib/flowchart-layout";
// 型だけ使う（値を読むとクライアント部品の参照になってしまう）
import type { FlowNode, Perspective } from "./flowchart-view";

/** 白黒でも見分けられる枠線。色は補助 */
const PRINT_STYLES: Record<
  BoxKind,
  { label: string; stroke: string; width: number; dash?: string; rx: number; fill: string }
> = {
  question: { label: "質問", stroke: "#1d4ed8", width: 2, rx: 2, fill: "#ffffff" },
  admit: { label: BRANCH_KIND_LABELS.admit, stroke: "#15803d", width: 1.5, rx: 8, fill: "#ffffff" },
  deny: { label: BRANCH_KIND_LABELS.deny, stroke: "#c2410c", width: 1.5, dash: "7 4", rx: 8, fill: "#ffffff" },
  evade: { label: BRANCH_KIND_LABELS.evade, stroke: "#a16207", width: 1.5, dash: "2 3", rx: 8, fill: "#ffffff" },
  goal: { label: "引き出したい結論", stroke: "#000000", width: 3, rx: 14, fill: "#f3f3f3" },
};

function SvgBox({ box }: { box: LayoutBox }) {
  const s = PRINT_STYLES[box.kind];
  const x = box.x + BOX_PADDING;
  const main = wrapText(box.text, charsPerLine(TEXT_FONT_SIZE));
  const sub = box.subText ? wrapText(box.subText, charsPerLine(SUB_FONT_SIZE)) : [];
  const mainTop = box.y + BOX_PADDING + HEADER_HEIGHT;
  const subTop = mainTop + main.length * TEXT_LINE_HEIGHT + 6;
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={s.rx}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={s.width}
        strokeDasharray={s.dash}
      />
      <text x={x} y={box.y + BOX_PADDING + 12} fontSize={11} fontWeight="bold" fill={s.stroke}>
        {s.label}
      </text>
      <text fontSize={TEXT_FONT_SIZE} fill="#000">
        {main.map((line, i) => (
          <tspan key={i} x={x} y={mainTop + (i + 1) * TEXT_LINE_HEIGHT - 5}>
            {line}
          </tspan>
        ))}
      </text>
      {box.subText && (
        <>
          <line
            x1={box.x + 6}
            x2={box.x + box.width - 6}
            y1={subTop - 3}
            y2={subTop - 3}
            stroke="#999"
            strokeDasharray="2 2"
          />
          <text fontSize={SUB_FONT_SIZE} fill="#333">
            <tspan x={x} y={subTop + SUB_LINE_HEIGHT - 4} fontWeight="bold">
              {box.subLabel}
            </tspan>
            {sub.map((line, i) => (
              <tspan key={i} x={x} y={subTop + (i + 2) * SUB_LINE_HEIGHT - 4}>
                {line}
              </tspan>
            ))}
          </text>
        </>
      )}
    </g>
  );
}

function ChainSvg({ layout, markerId, label }: { layout: Layout; markerId: string; label: string }) {
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={label}
      // 縦に長い連鎖でも1ページに収める（縦横比は保ったまま縮む）
      style={{ maxHeight: "150mm", display: "block" }}
      fontFamily='"Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#333" />
        </marker>
      </defs>
      {layout.edges.map((e) => (
        <path
          key={e.id}
          d={edgePath(e.points)}
          fill="none"
          stroke="#333"
          strokeWidth={1.2}
          strokeDasharray={e.dashed ? "5 4" : undefined}
          markerEnd={`url(#${markerId})`}
        />
      ))}
      {layout.boxes.map((b) => (
        <SvgBox key={b.id} box={b} />
      ))}
    </svg>
  );
}

interface PrintLine {
  speaker: string;
  kind?: BranchKind;
  text: string;
  note?: string;
}

/** 主経路の台本: 質問 → 次へ進む回答 → … → 最後は「認める」回答 → 結論 */
function mainScript(nodes: FlowNode[], chainId: string, perspective: Perspective): PrintLine[] {
  const path = mainPath(nodes, chainId);
  const lines: PrintLine[] = [];
  path.forEach((n, i) => {
    lines.push({
      speaker: "質問",
      text: n.question,
      note:
        perspective === "defense"
          ? n.modelAnswer && `模範回答：${n.modelAnswer}`
          : n.purpose && `ねらい：${n.purpose}`,
    });
    const next = path[i + 1];
    const branch = next
      ? n.branches.find((b) => b.followUpNodeId === next.id)
      : (n.branches.find((b) => b.kind === "admit" && !b.followUpNodeId) ??
        n.branches.find((b) => b.kind === "admit") ??
        n.branches[0]);
    if (branch) {
      lines.push({
        speaker: "回答",
        kind: branch.kind,
        text: branch.expectedAnswer,
        note:
          perspective === "attack" && branch.exposedWeakness
            ? `突ける点：${branch.exposedWeakness}`
            : undefined,
      });
    }
  });
  const goal = path[0]?.goal;
  if (goal) lines.push({ speaker: "結論", text: goal });
  return lines;
}

export async function FlowchartPrint({
  nodes,
  title,
  perspective = "attack",
}: {
  nodes: FlowNode[];
  title: string;
  /** 下段に「ねらい」を出すか「模範回答」を出すか */
  perspective?: Perspective;
}) {
  const chains = groupChains(nodes, perspective);
  // 印刷は上→下。分岐が横に並び、A4 の幅に収まりやすい
  const layouts = await Promise.all(
    chains.map((c) =>
      layoutChain(c.nodes, {
        subText: perspective === "defense" ? "modelAnswer" : "purpose",
        direction: "DOWN",
      }),
    ),
  );

  if (chains.length === 0) {
    return (
      <div className="print-sheet">
        <h1 className="text-xl font-bold">{title}</h1>
        <p>質疑はまだありません。</p>
      </div>
    );
  }

  return (
    <div className="print-sheet">
      {chains.map((c, i) => {
        const { root } = c;
        const script = mainScript(c.nodes, c.chainId, perspective);
        return (
          <section key={c.chainId} className={i > 0 ? "print-page-break pt-6" : undefined}>
            {i === 0 && <h1 className="mb-2 text-xl font-bold">{title}</h1>}
            <h2 className="text-base font-bold">
              {i + 1}. {root.question}
            </h2>
            <dl className="mb-2 flex flex-wrap gap-x-4 text-xs">
              <div className="flex gap-1">
                <dt>段落：</dt>
                <dd>{root.targetParagraph}</dd>
              </div>
              <div className="flex gap-1">
                <dt>攻撃点：</dt>
                <dd>{ATTACK_POINT_LABELS[root.attackPoint]}</dd>
              </div>
              <div className="flex gap-1">
                <dt>おすすめ度：</dt>
                <dd>{root.priority}／5</dd>
              </div>
              <div className="flex gap-1">
                <dt>使う質疑：</dt>
                <dd>{typeof root.setOrder === "number" ? `${root.setOrder}番目` : "—"}</dd>
              </div>
              {root.goal && (
                <div className="flex basis-full gap-1">
                  <dt className="font-bold">引き出したい結論：</dt>
                  <dd>{root.goal}</dd>
                </div>
              )}
            </dl>

            <ChainSvg
              layout={layouts[i]}
              markerId={`fc-arrow-${i}`}
              label={`${root.question} の分岐図`}
            />
            <p className="mt-1 text-[9pt]">
              枠線の見方：質問＝四角・太線／認める＝角丸・実線／否定する＝角丸・破線／はぐらかす＝角丸・点線／結論＝太い角丸
            </p>

            <h3 className="mt-3 text-sm font-bold">台本（主な流れ）</h3>
            <ol className="text-sm">
              {script.map((l, j) => (
                <li key={j} className="print-block py-0.5">
                  <span className="font-bold">
                    {l.speaker === "結論" ? "【引き出したい結論】" : `${l.speaker}${l.kind ? `（${BRANCH_KIND_LABELS[l.kind]}）` : ""}：`}
                  </span>
                  {l.text}
                  {l.note && <div className="pl-4 text-xs">{l.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
