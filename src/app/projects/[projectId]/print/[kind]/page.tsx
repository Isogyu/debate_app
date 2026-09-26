/**
 * 印刷画面（v6 要件 F12）。ブラウザの「印刷 → PDFに保存」で PDF になる
 *
 * ?variant={立論} で立論1本分を出す。種類: 質疑フローチャート／最終弁論の雛形。
 * 立論と参考資料は Word（実物と同じ書式）で出力するため、印刷画面は持たない。
 * AIが作ったもので未確認のものは、紙面にも必ず表示する（§1 制約5）。
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowchartPrint } from "@/components/flowchart/flowchart-print";
import type { Perspective } from "@/components/flowchart/flowchart-view";
import type { ClosingPerspective } from "@/domain/types";
import {
  buildExportData,
  type AiLabel,
  type ExportData,
  type ExportKind,
} from "@/lib/export/data";
import { requireSession } from "@/lib/session";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** 印刷できるのは、質疑フローチャートと最終弁論の雛形だけ（立論・参考資料は Word で出力する） */
type PrintKind = Extract<ExportKind, "flowchart" | "closing">;
function isKind(kind: string): kind is PrintKind {
  return kind === "flowchart" || kind === "closing";
}

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; kind: string }>;
  searchParams: Promise<{ variant?: string; perspective?: string }>;
}) {
  await requireSession();
  const { projectId, kind } = await params;
  const { variant, perspective } = await searchParams;
  if (!isKind(kind) || !variant) notFound();

  const data = await buildExportData(variant, { projectId });
  if (!data) notFound();

  const q = `?variant=${encodeURIComponent(variant)}`;
  const view: Perspective = perspective === "defense" ? "defense" : "attack";

  return (
    <main className="print-sheet px-4 py-8">
      <div className="no-print mb-6 rounded border border-[var(--line)] p-4">
        <p className="mb-2 text-sm">
          この画面を印刷すると、そのままPDFとして保存できます。
          印刷画面の「送信先」で<b>「PDFに保存」</b>を選んでください。
        </p>
        {kind === "flowchart" && (
          <p className="mb-2 text-sm">
            表示の向き：{" "}
            <Link
              href={`/projects/${projectId}/print/flowchart${q}&perspective=attack`}
              className={view === "attack" ? "font-bold underline" : "underline"}
            >
              この立論と戦うチーム用（質問のねらい）
            </Link>
            {" ／ "}
            <Link
              href={`/projects/${projectId}/print/flowchart${q}&perspective=defense`}
              className={view === "defense" ? "font-bold underline" : "underline"}
            >
              この立論で戦うチーム用（模範回答）
            </Link>
          </p>
        )}
        {data.warnings.length > 0 && (
          <ul className="mb-3 list-disc rounded border-2 border-[var(--neg)] p-2 pl-6 text-sm">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <PrintButton />
          <Link href={`/projects/${projectId}/export${q}`} className="text-sm underline">
            エクスポート画面に戻る
          </Link>
        </div>
      </div>

      {kind === "flowchart" && <FlowchartSheet data={data} perspective={view} />}
      {kind === "closing" && <ClosingSheet data={data} />}
    </main>
  );
}

// ── 共通 ─────────────────────────────────────────────────
/** 未確認は黒枠＋太字。白黒印刷でも見落とさないようにする */
function AiMark({ label }: { label: AiLabel | null }) {
  if (!label) return null;
  return (
    <span
      className={`ml-2 inline-block rounded px-1.5 text-xs align-middle ${
        label.needsCheck ? "border-2 border-black font-bold" : "border border-black"
      }`}
    >
      {label.text}
    </span>
  );
}

function SheetHeader({ data, kind, label }: { data: ExportData; kind: string; label?: AiLabel | null }) {
  return (
    <header className="mb-5">
      <h1 className="text-lg font-bold">
        {data.themeTitle}　{data.sideLabel}
        {kind}
        <AiMark label={label ?? null} />
      </h1>
      <p className="text-sm">論題：{data.resolution}</p>
      <p className="text-sm">
        立論：{data.label}（{data.originLabel}）
      </p>
    </header>
  );
}

// ── 質疑フローチャート ───────────────────────────────────
function FlowchartSheet({ data, perspective }: { data: ExportData; perspective: Perspective }) {
  const who = perspective === "defense" ? "この立論で戦うチーム用" : "この立論と戦うチーム用";
  return (
    <>
      <p className="mb-2 text-sm">
        {data.themeTitle}　{data.sideLabel}「{data.label}」（{data.originLabel}）／{who}
        <AiMark label={data.questionsAiLabel} />
      </p>
      <FlowchartPrint
        nodes={data.questions}
        title={`質疑フローチャート（${data.sideLabel}「${data.label}」）`}
        perspective={perspective}
      />
    </>
  );
}

// ── 最終弁論の雛形 ───────────────────────────────────────
function ClosingSheet({ data }: { data: ExportData }) {
  if (!data.closing) {
    return (
      <article>
        <SheetHeader data={data} kind="最終弁論の雛形" />
        <p>最終弁論の雛形はまだ作られていません。</p>
      </article>
    );
  }
  const parts: { title: string; p: ClosingPerspective; winningPath?: string }[] = [
    {
      title: "この立論で戦うチーム用",
      p: data.closing.own,
      winningPath: data.strategy?.winningPath,
    },
    { title: "この立論と戦うチーム用", p: data.closing.opponent },
  ];
  return (
    <article>
      {parts.map((part, i) => (
        <section key={part.title} className={i > 0 ? "print-page-break pt-2" : undefined}>
          <SheetHeader data={data} kind="最終弁論の雛形" label={data.closing!.aiLabel} />
          <h2 className="mb-2 border-b-2 border-black pb-1 text-lg font-bold">{part.title}</h2>
          <p className="mb-2 text-xs">
            1分（約320字）。質疑で出たことを空欄に書き込みます。主張の繰り返し・新しい論点は減点されます。
          </p>
          {part.winningPath && (
            <p className="mb-3 border border-black p-2 text-sm">
              <b>勝ち筋（特徴と戦い方より）：</b>
              {part.winningPath}
            </p>
          )}
          <ClosingFrame p={part.p} />

          <h3 className="mt-5 mb-1 font-bold">空欄に書くこと</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-10 border border-black px-2 py-1">欄</th>
                <th className="border border-black px-2 py-1 text-left">書くこと</th>
                <th className="border border-black px-2 py-1 text-left">ヒント</th>
              </tr>
            </thead>
            <tbody>
              {part.p.blanks.map((b) => (
                <tr key={b.key} className="print-block">
                  <td className="border border-black px-2 py-1 text-center font-bold">{b.key}</td>
                  <td className="border border-black px-2 py-1">{b.label}</td>
                  <td className="border border-black px-2 py-1">{b.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {part.p.examples.length > 0 && (
            <>
              <h3 className="mt-5 mb-1 font-bold">記入例（質疑の流れごと）</h3>
              {part.p.examples.map((ex, j) => (
                <div key={j} className="print-block mb-3 border border-black p-2 text-sm">
                  <p className="font-bold">{ex.pathLabel}</p>
                  <p className="whitespace-pre-wrap">{ex.text}</p>
                </div>
              ))}
            </>
          )}
        </section>
      ))}
    </article>
  );
}

const BLANK_RE = /【([①-⑳])([^】]*)】/g;

/** 枠の【①…】を、試合中に手書きで埋められる広い下線の空欄にする */
function ClosingFrame({ p }: { p: ClosingPerspective }) {
  const labels = new Map(p.blanks.map((b) => [b.key, b.label]));
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of p.frame.matchAll(BLANK_RE)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push(p.frame.slice(last, index));
    const key = m[1];
    const hint = (m[2] || labels.get(key) || "").trim();
    nodes.push(
      <span key={index} className="relative mx-1 inline-block align-bottom" style={{ minWidth: "70mm" }}>
        <span className="absolute left-0 top-0 text-[8pt] leading-none">
          {key}
          {hint}
        </span>
        <span
          className="block border-b-2 border-black"
          style={{ height: "2.4em" }}
          aria-label={`空欄${key}`}
        />
      </span>,
    );
    last = index + m[0].length;
  }
  if (last < p.frame.length) nodes.push(p.frame.slice(last));

  return (
    <div className="print-block border-2 border-black p-3" style={{ lineHeight: 3.2 }}>
      {nodes}
    </div>
  );
}
