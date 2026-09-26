"use client";

/**
 * 練習画面の切り替え（タイマー／読み上げ練習／質疑シミュレーター）
 */

import Link from "next/link";
import { useState } from "react";
import { SpeechTimer } from "@/components/speech-timer";
import { SpeechMeter } from "@/components/speech-meter";
import { Pacemaker } from "@/components/pacemaker";
import {
  CASE_ORIGIN_LABELS,
  SIDE_LABELS,
  type CaseOrigin,
  type DebateCase,
  type Side,
} from "@/domain/types";

export interface PracticeCase {
  id: string;
  side: Side;
  origin: CaseOrigin;
  label: string;
  debateCase: DebateCase;
}

const TABS = [
  { key: "timer", label: "タイマー" },
  { key: "reading", label: "読み上げ練習" },
  { key: "simulator", label: "質疑シミュレーター" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function PracticeClient({ projectId, cases }: { projectId: string; cases: PracticeCase[] }) {
  const [tab, setTab] = useState<TabKey>("timer");
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const selected = cases.find((c) => c.id === caseId);

  return (
    <div>
      <div role="tablist" className="mb-5 flex flex-wrap gap-2 border-b border-[var(--line)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 rounded px-4 font-bold ${
              tab === t.key ? "bg-[var(--accent)] text-white" : "border border-[var(--line)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "timer" && (
        <div>
          <p className="mb-3 text-sm text-[var(--muted)]">
            立論5分・質疑8分・最終弁論1分。試合中は「全画面で使う」にすると、遠くからでも残り時間と合図が見えます。
          </p>
          <SpeechTimer />
        </div>
      )}

      {tab === "reading" && (
        <div>
          {cases.length === 0 ? (
            <p className="rounded border-2 border-[var(--line)] p-6 text-center">
              本文ができている立論がまだありません。
              <Link href={`/projects/${projectId}`} className="mt-2 block text-[var(--accent)] underline">
                テーマの画面で立論を登録・生成する
              </Link>
            </p>
          ) : (
            <>
              <label className="mb-4 block">
                <span className="mb-1 block font-bold">読み上げる立論</span>
                <select
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                  className="min-h-11 w-full rounded border border-[var(--line)] px-2"
                >
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {SIDE_LABELS[c.side]}・{CASE_ORIGIN_LABELS[c.origin]}｜{c.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                // 立論を替えたら、測った速さやペースメーカーの経過もリセットする
                <div key={selected.id}>
                  <SpeechMeter text={selected.debateCase.fullText} />
                  <p className="mb-2 text-sm text-[var(--muted)]">
                    原稿を表示し、経過時間から「いまここまで来ているべき」位置を光らせます。
                    音声認識は使いません（誤った指示で早口になると減点されるため）。
                  </p>
                  <Pacemaker debateCase={selected.debateCase} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "simulator" && (
        <Link
          href={`/projects/${projectId}/simulator`}
          className="block rounded border-2 border-[var(--accent)] p-5 hover:bg-[var(--accent)]/5"
        >
          <span className="block text-lg font-bold text-[var(--accent)]">質疑シミュレーターを開く</span>
          <span className="mt-1 block text-sm text-[var(--muted)]">
            自分が守る立論と、AIが演じる相手の立論を選んで、質疑をテキストで練習します。
            終わると講評が出て、詰まった質問は質疑一覧で優先度が上がります。
          </span>
        </Link>
      )}
    </div>
  );
}
