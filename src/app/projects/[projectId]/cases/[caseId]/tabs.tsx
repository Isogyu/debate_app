/**
 * 立論詳細のタブ（資料・質疑・最終弁論・特徴と戦い方・数字の検査）
 * どれも表示だけのサーバーコンポーネント。操作は forms.tsx のクライアント部品で行う。
 */

import type {
  caseStrategies,
  closingTemplates,
  crossExamNodes,
  numberFindings,
  sourceMaterials,
} from "@/db/schema";
import { VerifyToggle } from "@/components/verify-toggle";
import { ChainSelectButton } from "@/components/chain-select-button";
import { statisticChartSvg } from "@/lib/export/chart-svg";
import { formatNumber } from "@/domain/statistics";
import { countSpeechChars } from "@/domain/speech";
import {
  ATTACK_POINT_LABELS,
  BRANCH_KIND_LABELS,
  NUMBER_ASPECT_LABELS,
  SOURCE_TYPE_LABELS,
  type ClosingPerspective,
  type SourceRequirement,
  type SourceType,
} from "@/domain/types";
import { CopyMaterialForm, MaterialForm, MoreQuestionsButton } from "./forms";

type Material = typeof sourceMaterials.$inferSelect;
type QNode = typeof crossExamNodes.$inferSelect;
type Finding = typeof numberFindings.$inferSelect;

function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

/** 資料の状態の表示（§1 #5）。登録資料には AI の表示を付けない */
function materialLabel(m: Material): { verified: boolean; label: string } {
  if (m.status === "procedure") return { verified: false, label: "作成手順（未完成）" };
  if (m.status === "verified") return { verified: true, label: "確認済" };
  if (m.origin === "copied") return { verified: false, label: "コピー（未確認）" };
  if (m.origin === "manual") return { verified: false, label: "手入力（未確認）" };
  if (m.origin === "uploaded") return { verified: true, label: "登録資料" };
  return { verified: false, label: "AI取得（未確認）" };
}

// ── 資料 ─────────────────────────────────────────────
export function SourcesTab({
  projectId,
  variantId,
  refs,
  materials,
  archived,
  copyTargets,
  verifiedBy,
}: {
  verifiedBy: Record<string, { who: string; at: string }>;
  projectId: string;
  variantId: string;
  refs: SourceRequirement[];
  materials: Map<string, Material>;
  archived: boolean;
  copyTargets: { id: string; label: string }[];
}) {
  if (refs.length === 0) {
    return <p className="text-[var(--muted)]">この立論には資料がありません。</p>;
  }
  const procedureCount = refs.filter((r) => materials.get(r.materialId)?.status === "procedure").length;
  return (
    <div className="space-y-5">
      {procedureCount > 0 && (
        <p className="rounded border border-[var(--line)] bg-[var(--line)]/20 p-3 text-sm">
          {procedureCount}件の資料は自動で完成できませんでした。各資料の「作成手順」に沿って探し、
          「見つけた資料を入力する」から入れてください。
        </p>
      )}
      {refs.map((ref) => {
        const m = materials.get(ref.materialId);
        if (!m) return null;
        const label = materialLabel(m);
        return (
          <article key={ref.id} id={`ref-${ref.number}`} className="scroll-mt-4 rounded border border-[var(--line)] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <b>【資料{ref.number}】</b>
              <span className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs">
                {SOURCE_TYPE_LABELS[m.sourceType as SourceType] ?? m.sourceType}
              </span>
              {m.origin === "uploaded" && m.status !== "procedure" ? (
                <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs">登録資料</span>
              ) : !archived && m.status !== "procedure" ? (
                <VerifyToggle
                  target="material"
                  id={m.id}
                  projectId={projectId}
                  variantId={variantId}
                  verified={m.status === "verified"}
                  label={label.label}
                  by={verifiedBy[`material:${m.id}`]}
                />
              ) : (
                <span className="rounded border border-[var(--neg)] px-2 py-0.5 text-xs text-[var(--neg)]">
                  {label.label}
                </span>
              )}
              {m.origin === "uploaded" && !m.withinAllowedSources && (
                <span className="rounded border border-[#b45309] px-2 py-0.5 text-xs text-[#b45309]">
                  信頼性を突かれやすい資料
                </span>
              )}
            </div>
            <p className="mb-2 font-bold">{m.provesWhat}</p>

            {m.status !== "procedure" && (
              <div className="space-y-2 text-sm">
                {m.citation && <p className="whitespace-pre-wrap">{m.citation}</p>}
                {m.url && (
                  <p className="break-all">
                    <a href={m.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                      {m.url}
                    </a>
                  </p>
                )}
                {m.lastCheckedAt && <p>（最終確認日：{formatDate(m.lastCheckedAt)}）</p>}
                {m.origin === "copied" && isStale(m.lastCheckedAt) && (
                  <p className="rounded bg-[#b45309]/10 p-2 text-[#b45309]">
                    過去テーマからコピーした資料で、最終確認日から時間がたっています。
                    出典を開いて内容が変わっていないか確認し、最終確認日を更新してください（§3.5）。
                  </p>
                )}
                {m.statistic ? (
                  <StatisticView statistic={m.statistic} />
                ) : (
                  m.quote && (
                    <blockquote className="whitespace-pre-wrap border-l-4 border-[var(--line)] pl-3 leading-7">
                      {m.quote}
                    </blockquote>
                  )
                )}
              </div>
            )}

            {m.status === "procedure" && m.procedure && (
              <div className="rounded bg-[var(--line)]/20 p-3 text-sm">
                <p className="mb-2 font-bold">作成手順</p>
                {m.procedure.reason && (
                  <p className="mb-2 text-[var(--muted)]">自動で完成できなかった理由: {m.procedure.reason}</p>
                )}
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    <b>何を証明する資料か:</b> {m.procedure.provesWhat}
                  </li>
                  {m.procedure.searchKeywords.length > 0 && (
                    <li>
                      <b>検索語:</b> {m.procedure.searchKeywords.join("　")}
                    </li>
                  )}
                  {m.procedure.whereToLook.length > 0 && (
                    <li>
                      <b>探す場所:</b>
                      <ul className="mt-1 space-y-1">
                        {m.procedure.whereToLook.map((w) => (
                          <li key={w.url}>
                            <a href={w.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                              {w.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                  <li>
                    <b>見つけたら抜き出すもの:</b> {m.procedure.whatToExtract}
                  </li>
                  {m.procedure.statisticSteps && m.procedure.statisticSteps.length > 0 && (
                    <li>
                      <b>統計の作り方:</b>
                      <ol className="mt-1 list-[lower-alpha] space-y-1 pl-5">
                        {m.procedure.statisticSteps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </li>
                  )}
                  <li>出典（発行元・題名・URL）と最終確認日を控え、下のボタンから入力する</li>
                </ol>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {!archived && (m.status === "procedure" || m.origin !== "uploaded") && (
                <MaterialForm materialId={m.id} projectId={projectId} variantId={variantId} initial={m} />
              )}
              {archived && m.status !== "procedure" && (
                <CopyMaterialForm materialId={m.id} targets={copyTargets} />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StatisticView({ statistic }: { statistic: NonNullable<Material["statistic"]> }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {statistic.table.columns.map((c) => (
                <th key={c} className="border border-[var(--line)] bg-[var(--line)]/30 p-2 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statistic.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-[var(--line)] p-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statistic.chart && (
        <div
          className="overflow-x-auto rounded border border-[var(--line)] bg-white p-2 [&_svg]:h-auto [&_svg]:max-w-full"
          // SVG はこちらのコードが組み立てたもの（文字は escapeXml 済み）
          dangerouslySetInnerHTML={{ __html: statisticChartSvg(statistic.chart) }}
        />
      )}
      <div>
        <p className="font-bold">元の数値と出典</p>
        <ul className="list-disc pl-5">
          {statistic.inputs.map((i) => (
            <li key={i.key}>
              {i.label}：{formatNumber(i.value, i.unit)}（{i.year}）— {i.statName}／表のセル: {i.locator}
            </li>
          ))}
        </ul>
      </div>
      {statistic.results.length > 0 && (
        <div>
          <p className="font-bold">計算過程</p>
          <ul className="list-disc pl-5">
            {statistic.results.map((r) => (
              <li key={r.key}>{r.expression}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="font-bold">比較の前提</p>
        <ul className="pl-1">
          {statistic.comparability.map((c, i) => (
            <li key={i}>
              {c.ok === true ? "○" : c.ok === false ? "✗" : "要確認"}　{c.aspect}: {c.note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── 数字の検査 ─────────────────────────────────────────
export function FindingsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <section className="mb-6 rounded border border-[var(--line)] p-4 text-sm">
        <h2 className="mb-1 font-bold">数字の検査</h2>
        <p className="text-[var(--muted)]">指摘はありません。</p>
      </section>
    );
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <section className="mb-6 rounded border border-[var(--line)] p-4">
      <h2 className="mb-2 font-bold">数字の検査（{findings.length}件）</h2>
      <ul className="space-y-2 text-sm">
        {sorted.map((f) => (
          <li key={f.id} className="rounded bg-[var(--line)]/20 p-2">
            <span
              className={`mr-2 rounded px-1.5 py-0.5 text-xs text-white ${f.severity === "high" ? "bg-[var(--neg)]" : f.severity === "medium" ? "bg-[#b45309]" : "bg-[var(--muted)]"}`}
            >
              {f.severity === "high" ? "重要" : f.severity === "medium" ? "注意" : "参考"}
            </span>
            <b>{NUMBER_ASPECT_LABELS[f.aspect]}</b>
            <span className="ml-2 text-[var(--muted)]">{f.location}</span>
            {f.value && <span className="ml-2">「{f.value}」</span>}
            <p className="mt-1">{f.message}</p>
            {f.resolution && <p className="mt-1 text-[var(--aff)]">対応済み: {f.resolution}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 質疑 ─────────────────────────────────────────────
export function QuestionsTab({
  projectId,
  variantId,
  nodes,
  paragraphs,
  view,
  readOnly,
  baseHref,
}: {
  projectId: string;
  variantId: string;
  nodes: QNode[];
  paragraphs: { claimId: string; label: string }[];
  view: "paragraph" | "selected";
  readOnly: boolean;
  baseHref: string;
}) {
  const chains = new Map<string, QNode[]>();
  for (const n of nodes) chains.set(n.chainId, [...(chains.get(n.chainId) ?? []), n]);
  for (const list of chains.values()) list.sort((a, b) => a.chainOrder - b.chainOrder);
  const roots = [...chains.values()].map((l) => l[0]);
  const selected = roots
    .filter((r) => r.setOrder != null)
    .sort((a, b) => (a.setOrder ?? 0) - (b.setOrder ?? 0));

  const tabs = [
    ["paragraph", "すべての質疑（立論の箇所別）"],
    ["selected", `使う質疑（${selected.length}本）`],
  ] as const;

  const renderChain = (root: QNode, canMove = false, isLast = false) => (
    <ChainCard
      key={root.chainId}
      nodes={chains.get(root.chainId)!}
      select={
        readOnly ? null : (
          <ChainSelectButton
            projectId={projectId}
            variantId={variantId}
            chainId={root.chainId}
            order={root.setOrder}
            canMove={canMove}
            isLast={isLast}
          />
        )
      }
    />
  );

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        質問は{nodes.length}問（連鎖{roots.filter((r) => chains.get(r.chainId)!.length > 1).length}本）。
        相手側から見れば「攻める質疑」、この立論の側から見れば「受ける質疑と回答準備」です。
        試合で使うものを「この質疑を使う」で選ぶと、「使う質疑」とフローチャートでその順に並びます。
      </p>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="表示">
        {tabs.map(([key, label]) => (
          <a
            key={key}
            href={`${baseHref}&view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={`min-h-9 rounded px-3 py-1.5 text-sm ${view === key ? "bg-[var(--accent)] text-white" : "border border-[var(--line)]"}`}
          >
            {label}
          </a>
        ))}
      </nav>

      {view === "paragraph" &&
        paragraphs.map((p) => {
          const list = roots
            .filter((r) => r.targetClaimId === p.claimId)
            // 練習で詰まった質問は、同じおすすめ度の中で前に出す（§4.3）
            .sort((a, b) => b.priority - a.priority || b.stuckCount - a.stuckCount);
          return (
            <section key={p.claimId} className="mb-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold">{p.label}（{list.length}本）</h3>
                {!readOnly && <MoreQuestionsButton variantId={variantId} claimId={p.claimId} />}
              </div>
              <div className="space-y-3">{list.map((r) => renderChain(r))}</div>
            </section>
          );
        })}

      {view === "selected" && (
        <div className="space-y-3">
          {selected.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
              まだ選んでいません。「すべての質疑」で、試合で使う質疑の「この質疑を使う」を押してください。
            </p>
          ) : (
            selected.map((r, i) => renderChain(r, true, i === selected.length - 1))
          )}
        </div>
      )}
    </div>
  );
}

function ChainCard({ nodes, select }: { nodes: QNode[]; select: React.ReactNode }) {
  const root = nodes[0];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="rounded border border-[var(--line)] p-3">
    {/* ボタンは summary の外に置く（summary の中だと押したときに開閉も起きる） */}
    {select && <div className="mb-2">{select}</div>}
    <details open={nodes.length === 1}>
      <summary className="cursor-pointer list-none">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-[var(--line)] px-1.5 py-0.5">{ATTACK_POINT_LABELS[root.attackPoint]}</span>
          <span className="text-[var(--muted)]">おすすめ度 {"★".repeat(root.priority)}</span>
          {nodes.length > 1 && <span className="text-[var(--muted)]">連鎖 {nodes.length}問</span>}
          {root.origin === "practice" && <span className="rounded border border-[var(--line)] px-1.5 py-0.5">練習から追加</span>}
          {root.stuckCount > 0 && <span className="text-[var(--neg)]">練習で詰まった {root.stuckCount}回</span>}
          <span className="text-[var(--muted)]">{root.targetParagraph}</span>
        </div>
        <p className="font-bold">Q. {root.question}</p>
        {root.goal && <p className="mt-1 text-sm">引き出したい結論: {root.goal}</p>}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        {nodes.map((n) => (
          <div key={n.id} className="rounded bg-[var(--line)]/15 p-2">
            {n.chainOrder > 0 && <p className="font-bold">Q. {n.question}</p>}
            {n.purpose && <p className="text-[var(--muted)]">ねらい: {n.purpose}</p>}
            {n.modelAnswer && (
              <p className="mt-1">
                <b>模範回答（守る側）:</b> {n.modelAnswer}
              </p>
            )}
            {n.branches.length > 0 && (
              <ul className="mt-1 space-y-1">
                {n.branches.map((b, i) => {
                  const next = b.followUpNodeId ? byId.get(b.followUpNodeId) : undefined;
                  return (
                    <li key={i}>
                      <span className="mr-1 rounded border border-[var(--line)] px-1 text-xs">{BRANCH_KIND_LABELS[b.kind]}</span>
                      {b.expectedAnswer}
                      {next && <span className="text-[var(--muted)]"> → 次: {next.question}</span>}
                      {b.exposedWeakness && <span className="block text-xs text-[var(--neg)]">突ける点: {b.exposedWeakness}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
    </div>
  );
}

// ── 最終弁論の雛形 ─────────────────────────────────────
export function ClosingTab({ closing }: { closing: typeof closingTemplates.$inferSelect | undefined }) {
  if (!closing) return <p className="text-[var(--muted)]">最終弁論の雛形はまだできていません。</p>;
  return (
    <div className="space-y-8">
      <ClosingSection title="この立論で戦うチームの最終弁論" p={closing.own} />
      <ClosingSection title="この立論と戦うチーム（相手側）の最終弁論" p={closing.opponent} />
    </div>
  );
}

function ClosingSection({ title, p }: { title: string; p: ClosingPerspective }) {
  return (
    <section>
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      <p className="mb-2 text-sm text-[var(--muted)]">
        1分≒約320字。空欄に質疑の結果を入れます。主張の繰り返しや新しい論点は減点されます（要項10）。
      </p>
      <div className="mb-3 whitespace-pre-wrap rounded border-2 border-[var(--line)] p-4 leading-8">{p.frame}</div>
      <table className="mb-4 w-full border-collapse text-sm">
        <tbody>
          {p.blanks.map((b) => (
            <tr key={b.key}>
              <th className="w-10 border border-[var(--line)] p-2 align-top">{b.key}</th>
              <td className="border border-[var(--line)] p-2">
                <b>{b.label}</b>
                {b.hint && <span className="block text-[var(--muted)]">{b.hint}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mb-2 font-bold">記入例</p>
      <div className="space-y-3">
        {p.examples.map((e, i) => (
          <details key={i} className="rounded border border-[var(--line)] p-3">
            <summary className="cursor-pointer text-sm font-bold">
              {e.pathLabel}
              <ClosingLength text={e.text} />
            </summary>
            <p className="mt-2 whitespace-pre-wrap leading-7">{e.text}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** 記入例の読み上げ字数。1分≒320字（最終弁論は1分・30秒以上余っても減点） */
function ClosingLength({ text }: { text: string }) {
  const chars = countSpeechChars(text);
  const tooLong = chars > 330;
  const tooShort = chars < 160;
  return (
    <span
      className="ml-2 text-xs font-normal"
      style={{ color: tooLong || tooShort ? "var(--neg)" : "var(--muted)" }}
    >
      （約{chars}字{tooLong ? "・1分を超える恐れ" : tooShort ? "・30秒以上余る恐れ" : ""}）
    </span>
  );
}

// ── 特徴と戦い方 ───────────────────────────────────────
function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 font-bold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

export function StrategyTab({ strategy }: { strategy: typeof caseStrategies.$inferSelect | undefined }) {
  if (!strategy) return <p className="text-[var(--muted)]">特徴と戦い方はまだできていません。</p>;
  const s = strategy.data;
  return (
    <div className="space-y-5 leading-7">
      <p className="rounded bg-[var(--line)]/20 p-3">{s.summary}</p>
      <div className="grid gap-5 md:grid-cols-2">
        <List title="強み・柱になる論点" items={s.strengths} />
        <section>
          <h3 className="mb-1 font-bold">弱点・突かれやすい箇所</h3>
          <ul className="list-disc space-y-1 pl-5">
            {s.weaknesses.map((w, i) => (
              <li key={i}>
                <b>{w.point}</b>
                <span className="block text-sm text-[var(--muted)]">{w.why}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <h3 className="border-b border-[var(--line)] pb-1 text-lg font-bold">この立論で戦うとき</h3>
      <div className="grid gap-5 md:grid-cols-2">
        <List title="質疑で守るところ" items={s.defend} />
        <List title="譲ってはいけないこと" items={s.neverConcede} />
      </div>
      <section>
        <h3 className="mb-1 font-bold">最終弁論の勝ち筋</h3>
        <p>{s.winningPath}</p>
      </section>
      <h3 className="border-b border-[var(--line)] pb-1 text-lg font-bold">相手としてこの立論と戦うとき</h3>
      <List title="攻め筋" items={s.howToAttack} />
    </div>
  );
}

/** 最終確認日が古いか（90日以上前、または不明） */
function isStale(date: string | null): boolean {
  if (!date) return true;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > 90 * 24 * 60 * 60 * 1000;
}
