/**
 * 印刷画面（v6 要件 F12）。ブラウザの「印刷 → PDFに保存」で PDF になる
 *
 * ?variant={立論} で立論1本分を出す。種類: 立論／参考資料／質疑フローチャート／最終弁論の雛形。
 * AIが作ったもので未確認のものは、紙面にも必ず表示する（§1 制約5）。
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowchartPrint } from "@/components/flowchart/flowchart-print";
import type { Perspective } from "@/components/flowchart/flowchart-view";
import { formatNumber } from "@/domain/statistics";
import type { ClosingPerspective, StatisticData } from "@/domain/types";
import { statisticChartSvg } from "@/lib/export/chart-svg";
import {
  buildExportData,
  EXPORT_KIND_LABELS,
  type AiLabel,
  type ExportData,
  type ExportKind,
  type ExportSource,
} from "@/lib/export/data";
import { requireSession } from "@/lib/session";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function isKind(kind: string): kind is ExportKind {
  return kind in EXPORT_KIND_LABELS;
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

      {kind === "case" && <CaseSheet data={data} />}
      {kind === "sources" && <SourcesSheet data={data} />}
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

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="print-block my-3 border-2 border-black p-2 text-sm font-bold">{children}</p>;
}

// ── 立論 ─────────────────────────────────────────────────
function CaseSheet({ data }: { data: ExportData }) {
  const c = data.debateCase;
  return (
    <article>
      <SheetHeader data={data} kind="立論" label={data.caseAiLabel} />
      {data.caseAiLabel?.needsCheck && (
        <Notice>
          【AI生成（未確認）】この立論はAIが作成し、まだ人が確認していません。資料の中身と照らして確認してから使ってください。
        </Notice>
      )}

      {c.sections.length === 0 ? (
        // 構造化できなかった登録立論は原文のまま（書き換えない）
        <div className="whitespace-pre-wrap">{c.fullText}</div>
      ) : (
        <>
          <h2 className="mt-5 mb-2 font-bold">Ⅰ. 主張</h2>
          <p className="pl-4">{c.claim}</p>

          <h2 className="mt-5 mb-2 font-bold">Ⅱ. 理由</h2>
          {c.sections.map((section, i) => (
            <section key={section.id} className="mb-4">
              <h3 className="mb-1 font-bold">
                {i + 1}. {section.title}
              </h3>
              {section.subsections.map((sub, j) => (
                <div key={sub.id} className="mb-3 pl-4">
                  {(section.subsections.length > 1 || sub.title !== section.title) && (
                    <p className="font-bold">
                      （{j + 1}）{sub.title}
                    </p>
                  )}
                  <p className="pl-4">{sub.claim}</p>
                  {sub.warrant && <p className="pl-4">{sub.warrant}</p>}
                  {sub.impact && <p className="pl-4">{sub.impact}</p>}
                </div>
              ))}
            </section>
          ))}

          <h2 className="mt-5 mb-2 font-bold">Ⅲ. 結論</h2>
          <p className="pl-4">{c.conclusion}</p>
        </>
      )}

      <p className="mt-6 text-right text-xs">
        読み上げ時間の目安：{data.speech.label}（{data.speech.chars}字）
      </p>
    </article>
  );
}

// ── 参考資料 ─────────────────────────────────────────────
function SourcesSheet({ data }: { data: ExportData }) {
  const needs = data.sources.filter((s) => s.aiLabel?.needsCheck);
  return (
    <article>
      <SheetHeader data={data} kind="参考資料" />
      {needs.length > 0 && (
        <Notice>
          【要確認】資料{needs.map((s) => s.number).join("・")}
          は、未確認または未完成です。見出し横の表示を確認し、出典の実物と照らしてから使ってください。
        </Notice>
      )}
      {data.sources.length === 0 && <p>（資料がありません）</p>}
      {data.sources.map((s) => (
        <SourceEntry key={s.number} s={s} />
      ))}
    </article>
  );
}

function SourceEntry({ s }: { s: ExportSource }) {
  return (
    <section className="mt-6">
      <h2 className="font-bold">
        【資料{s.number}】
        <AiMark label={s.aiLabel} />
      </h2>
      {s.status === "procedure" ? (
        <ProcedureEntry s={s} />
      ) : (
        <>
          <p className="font-bold">{s.provesWhat}</p>
          {s.citation && <p>{s.citation}</p>}
          {s.url && <p className="break-all text-sm">{s.url}</p>}
          {s.lastCheckedLabel && <p>（最終確認日：{s.lastCheckedLabel}）</p>}
          {s.quote && (
            <p className="mt-2 whitespace-pre-wrap">
              「{s.quote}」{s.modificationNote ?? ""}
            </p>
          )}
          {s.statistic && <StatisticEntry stat={s.statistic} />}
          {!s.withinAllowedSources && (
            <p className="mt-1 text-sm">
              ※新聞・民間調査などの資料です。信頼性を突かれやすい点に注意してください。
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ProcedureEntry({ s }: { s: ExportSource }) {
  const p = s.procedure;
  return (
    <div className="print-block border-2 border-dashed border-black p-3">
      <p className="mb-2 font-bold">この資料は未完成です（作成手順）</p>
      <dl className="text-sm [&_dd]:mb-2 [&_dd]:pl-4 [&_dt]:font-bold">
        <dt>何を証明する資料か</dt>
        <dd>{p?.provesWhat || s.provesWhat}</dd>
        {p?.reason && (
          <>
            <dt>自動で完成できなかった理由</dt>
            <dd>{p.reason}</dd>
          </>
        )}
        {p && p.searchKeywords.length > 0 && (
          <>
            <dt>検索に使う言葉</dt>
            <dd>{p.searchKeywords.join("　／　")}</dd>
          </>
        )}
        {p && p.whereToLook.length > 0 && (
          <>
            <dt>探す場所</dt>
            <dd>
              <ul>
                {p.whereToLook.map((w, i) => (
                  <li key={i} className="break-all">
                    ・{w.label}　{w.url}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {p?.whatToExtract && (
          <>
            <dt>見つけたら抜き出すもの</dt>
            <dd>{p.whatToExtract}</dd>
          </>
        )}
        {p?.statisticSteps && p.statisticSteps.length > 0 && (
          <>
            <dt>統計の作り方</dt>
            <dd>
              <ol className="list-decimal pl-5">
                {p.statisticSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function StatisticEntry({ stat }: { stat: StatisticData }) {
  const cellCls = "border border-black px-2 py-1 text-left align-top";
  return (
    <div className="mt-3 text-sm">
      {stat.table.columns.length > 0 && (
        <table className="print-block mb-3 w-full border-collapse">
          <thead>
            <tr>
              {stat.table.columns.map((c, i) => (
                <th key={i} className={`${cellCls} bg-gray-100`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stat.table.rows.map((r, i) => (
              <tr key={i}>
                {stat.table.columns.map((_, j) => (
                  <td key={j} className={cellCls}>
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stat.chart && stat.chart.points.length > 0 && (
        <div
          className="print-block mx-auto mb-3 max-w-[140mm] [&_svg]:h-auto [&_svg]:w-full"
          role="img"
          aria-label={stat.chart.title}
          // 自前の純粋関数が文字を全てエスケープして組み立てた SVG
          dangerouslySetInnerHTML={{ __html: statisticChartSvg(stat.chart) }}
        />
      )}
      {stat.inputs.length > 0 && (
        <div className="print-block mb-2">
          <p className="font-bold">元の数値と出典</p>
          <ul className="pl-4">
            {stat.inputs.map((i) => (
              <li key={i.key} className="break-all">
                ・{i.label}：{formatNumber(i.value, i.unit)}（{i.statName}「{i.tableTitle}」{i.year}
                {i.tableId ? `、表番号 ${i.tableId}` : ""}）{i.url ? `　${i.url}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {stat.results.length > 0 && (
        <div className="print-block mb-2">
          <p className="font-bold">計算過程</p>
          <ul className="pl-4">
            {stat.results.map((r) => (
              <li key={r.key}>
                ・{r.label}：{r.expression}
              </li>
            ))}
          </ul>
        </div>
      )}
      {stat.comparability.length > 0 && (
        <table className="print-block w-full border-collapse">
          <caption className="text-left font-bold">比較の前提の検査</caption>
          <thead>
            <tr>
              <th className={`${cellCls} bg-gray-100`}>観点</th>
              <th className={`${cellCls} bg-gray-100`}>判定</th>
              <th className={`${cellCls} bg-gray-100`}>内容</th>
            </tr>
          </thead>
          <tbody>
            {stat.comparability.map((c, i) => (
              <tr key={i}>
                <td className={cellCls}>{c.aspect}</td>
                <td className={`${cellCls} font-bold`}>
                  {c.ok === true ? "○" : c.ok === false ? "NG" : "要確認"}
                </td>
                <td className={cellCls}>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
