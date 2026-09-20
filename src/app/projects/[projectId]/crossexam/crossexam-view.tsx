"use client";

/**
 * 質疑フロー画面（DESIGN.md §7 CX）
 *
 * 練習で繰り返し使う画面。「攻める質疑」と「受ける質疑」の両方向を持つ。
 * 練習モードでは想定回答を実際に選んで分岐を辿り、本番の流れを体感する。
 */

import { useState } from "react";

export interface CxBranch {
  expectedAnswer: string;
  followUpNodeId?: string;
  exposedWeakness?: string;
}

export interface CxNode {
  id: string;
  direction: "attack" | "defense";
  question: string;
  purpose: string;
  categoryIds: string[];
  branches: CxBranch[];
}

export function CrossExamView({
  nodes,
  categoryNames,
}: {
  nodes: CxNode[];
  categoryNames: Record<string, string>;
}) {
  const [direction, setDirection] = useState<"attack" | "defense">("attack");
  const [practice, setPractice] = useState(false);

  const visible = nodes.filter((n) => n.direction === direction);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--line)] pb-4">
        <div className="flex gap-1">
          <button
            onClick={() => setDirection("attack")}
            className={`rounded px-4 py-2 font-bold ${
              direction === "attack"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)]"
            }`}
          >
            相手に質問する
          </button>
          <button
            onClick={() => setDirection("defense")}
            className={`rounded px-4 py-2 font-bold ${
              direction === "defense"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)]"
            }`}
          >
            相手から質問される
          </button>
        </div>
        <button
          onClick={() => setPractice(!practice)}
          className="ml-auto rounded border border-[var(--line)] px-3 py-2 text-sm"
        >
          {practice ? "一覧で見る" : "練習モード"}
        </button>
      </div>

      <p className="mb-4 text-sm text-[var(--muted)]">
        {direction === "attack"
          ? "相手の立論の弱点を突くための質問です。想定回答ごとに次の一手が用意されています。"
          : "自分の立論に対して来そうな質問と、その答え方の準備です。"}
      </p>

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
          この方向の質疑はまだ生成されていません。
        </p>
      ) : practice ? (
        <PracticeMode nodes={visible} allNodes={nodes} />
      ) : (
        <ul className="space-y-4">
          {visible.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              allNodes={nodes}
              categoryNames={categoryNames}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeCard({
  node,
  allNodes,
  categoryNames,
}: {
  node: CxNode;
  allNodes: CxNode[];
  categoryNames: Record<string, string>;
}) {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  return (
    <li className="rounded border border-[var(--line)] p-4">
      <div className="mb-2 flex flex-wrap gap-2">
        {node.categoryIds.map((id) => (
          <span key={id} className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs">
            {categoryNames[id] ?? "?"}
          </span>
        ))}
      </div>
      <p className="font-bold">Q: {node.question}</p>
      {node.purpose && (
        <p className="mt-1 text-sm text-[var(--muted)]">意図: {node.purpose}</p>
      )}

      {node.branches.length > 0 && (
        <ul className="mt-3 space-y-2">
          {node.branches.map((b, i) => (
            <li key={i} className="border-l-2 border-[var(--line)] pl-3 text-sm">
              <p>
                <b>相手「{b.expectedAnswer}」</b>
              </p>
              {b.exposedWeakness && (
                <p className="text-[var(--muted)]">→ 露呈する弱点: {b.exposedWeakness}</p>
              )}
              {b.followUpNodeId && byId.get(b.followUpNodeId) && (
                <p className="text-[var(--accent)]">
                  → 次の質問: {byId.get(b.followUpNodeId)!.question}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 練習モード。想定回答をクリックして分岐を辿る。
 * 本番は口頭なので、頭の中で分岐を追える状態にしておくのが目的。
 */
function PracticeMode({
  nodes,
  allNodes,
}: {
  nodes: CxNode[];
  allNodes: CxNode[];
}) {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const [currentId, setCurrentId] = useState<string>(nodes[0].id);
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);

  const current = byId.get(currentId);
  const restart = () => {
    setCurrentId(nodes[0].id);
    setHistory([]);
  };

  return (
    <div>
      {history.length > 0 && (
        <ol className="mb-4 space-y-2">
          {history.map((h, i) => (
            <li key={i} className="rounded bg-[var(--line)]/30 p-3 text-sm">
              <p>Q: {h.question}</p>
              <p className="text-[var(--muted)]">A: {h.answer}</p>
            </li>
          ))}
        </ol>
      )}

      {current ? (
        <div className="rounded border-2 border-[var(--accent)] p-4">
          <p className="mb-1 text-lg font-bold">Q: {current.question}</p>
          {current.purpose && (
            <p className="mb-3 text-sm text-[var(--muted)]">意図: {current.purpose}</p>
          )}
          <p className="mb-2 text-sm">相手はどう答えそうですか？</p>
          <ul className="space-y-2">
            {current.branches.map((b, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setHistory([
                      ...history,
                      { question: current.question, answer: b.expectedAnswer },
                    ]);
                    if (b.followUpNodeId && byId.has(b.followUpNodeId)) {
                      setCurrentId(b.followUpNodeId);
                    } else {
                      setCurrentId("");
                    }
                  }}
                  className="w-full rounded border border-[var(--line)] p-3 text-left"
                >
                  「{b.expectedAnswer}」
                  {b.exposedWeakness && (
                    <span className="mt-1 block text-sm text-[var(--muted)]">
                      → {b.exposedWeakness}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {current.branches.length === 0 && (
              <li className="text-sm text-[var(--muted)]">
                この質問に想定回答が登録されていません。
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="rounded border border-[var(--line)] p-6 text-center">
          <p className="mb-3">ここで質疑は終わりです。</p>
          <button
            onClick={restart}
            className="rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
          >
            最初からやり直す
          </button>
        </div>
      )}

      {current && history.length > 0 && (
        <button
          onClick={restart}
          className="mt-4 rounded border border-[var(--line)] px-4 py-2 text-sm"
        >
          最初からやり直す
        </button>
      )}
    </div>
  );
}
