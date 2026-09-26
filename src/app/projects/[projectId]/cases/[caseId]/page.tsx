/**
 * 立論詳細（v6 画面構成: タブ＝本文／資料／質疑／フローチャート／最終弁論／特徴と戦い方）
 */

import Link from "next/link";
import { SwitchSideButton } from "@/components/switch-side-button";
import { DeleteCaseButton } from "@/components/delete-case-button";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  caseStrategies,
  caseVariants,
  closingTemplates,
  crossExamNodes,
  generationJobs,
  issueCategories,
  numberFindings,
  projects,
  sourceMaterials,
  uploads,
} from "@/db/schema";
import { Breadcrumb, OriginBadge, SideBadge } from "@/components/chrome";
import { Header } from "@/components/header";
import { JobStatus } from "@/components/job-status";
import { VerifyToggle } from "@/components/verify-toggle";
import { FlowchartView, type FlowNode } from "@/components/flowchart/flowchart-view";
import { SIDE_LABELS } from "@/domain/types";
import { requireSession } from "@/lib/session";
import { loadVariantHistory, type VariantHistory } from "@/lib/history";
import { formatJstDateTime } from "@/domain/jst";
import { toJobView } from "../../theme-view";
import { BodyTab } from "./body-tab";
import { ClosingTab, FindingsPanel, QuestionsTab, SourcesTab, StrategyTab } from "./tabs";

export const dynamic = "force-dynamic";

const TABS = [
  ["body", "本文"],
  ["sources", "資料"],
  ["questions", "質疑と回答"],
  ["flowchart", "フローチャート"],
  ["closing", "最終弁論の雛形"],
  ["strategy", "特徴と戦い方"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; caseId: string }>;
  searchParams: Promise<{ tab?: string; view?: string; notice?: string }>;
}) {
  await requireSession();
  const { projectId, caseId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "body") as Tab;
  const view = sp.view === "selected" ? "selected" : "paragraph";

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const [variant] = await db
    .select()
    .from(caseVariants)
    .where(and(eq(caseVariants.id, caseId), eq(caseVariants.projectId, projectId)));
  if (!project || !variant) notFound();
  const archived = project.status === "archived";

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.variantId, caseId))
    .orderBy(desc(generationJobs.createdAt))
    .limit(1);
  const [upload] = await db.select().from(uploads).where(eq(uploads.variantId, caseId));
  const building = variant.debateCase.sections.length === 0;
  const history = await loadVariantHistory(variant);
  const lastChange = history.entries.find((e) => e.detail !== "確認済にした" && e.detail !== "未確認に戻した");

  const base = `/projects/${projectId}/cases/${caseId}`;
  const title = building ? (variant.origin === "generated" ? "生成中の立論" : "取り込み中の立論") : variant.label;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: title },
          ]}
        />
        {sp.notice && (
          <p role="status" className="mb-4 rounded border-2 border-[var(--aff)] p-3 text-sm">
            {sp.notice.slice(0, 200)}
          </p>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SideBadge side={variant.side} />
          <OriginBadge origin={variant.origin} />
          {variant.origin === "uploaded" && !archived && (
            <SwitchSideButton
              projectId={projectId}
              variantId={variant.id}
              currentLabel={SIDE_LABELS[variant.side]}
            />
          )}
          {variant.origin === "uploaded" && !archived && (
            <DeleteCaseButton projectId={projectId} variantId={variant.id} />
          )}
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        {variant.origin === "generated" && variant.approach && `${variant.framework}／${variant.approach}` !== title && (
          <p className="-mt-2 mb-4 text-sm text-[var(--muted)]">切り口: {variant.framework}／{variant.approach}</p>
        )}

        <HistoryPanel history={history} lastChange={lastChange} />

        {job && (job.status !== "done" || job.steps.some((s) => s.status === "failed")) && (
          <div className="mb-5">
            <JobStatus initial={toJobView(job)} />
          </div>
        )}

        {upload && upload.issues.length > 0 && (
          <section className="mb-5 rounded border-2 border-[#b45309] p-4 text-sm">
            <p className="mb-1 font-bold">取り込みで見つかった点</p>
            <ul className="list-disc space-y-1 pl-5">
              {upload.issues.map((i, k) => (
                <li key={k} className={i.severity === "error" ? "text-[var(--neg)]" : ""}>
                  {i.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        {variant.lengthWarning && (
          <p className="mb-5 rounded border-2 border-[var(--neg)] p-3 text-sm">{variant.lengthWarning}</p>
        )}

        {building ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            {job?.status === "failed" || job?.status === "partial"
              ? "作成に失敗しました。上の「失敗したところからやり直す」を押してください。"
              : "作成中です。できたところから表示します。この画面を開いたままにすると止まらずに進みます。閉じると数分後にサーバーが休止して生成も一時停止し、次にアプリを開いたときに続きから再開します。"}
          </p>
        ) : (
          <>
            <nav className="mb-5 flex flex-wrap gap-x-1 border-b border-[var(--line)]" aria-label="立論の成果物">
              {TABS.map(([key, label]) => (
                <Link
                  key={key}
                  href={`${base}?tab=${key}`}
                  aria-current={tab === key ? "page" : undefined}
                  className={`whitespace-nowrap px-3 py-2 text-sm ${tab === key ? "border-b-2 border-[var(--accent)] font-bold" : "text-[var(--muted)]"}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <TabContent
              tab={tab}
              view={view}
              base={base}
              projectId={projectId}
              archived={archived}
              variant={variant}
              verifiedBy={history.verifiedBy}
            />
          </>
        )}
      </main>
    </>
  );
}

async function TabContent({
  tab,
  view,
  base,
  projectId,
  archived,
  variant,
  verifiedBy,
}: {
  verifiedBy: VariantHistory["verifiedBy"];
  tab: Tab;
  view: "paragraph" | "selected";
  base: string;
  projectId: string;
  archived: boolean;
  variant: typeof caseVariants.$inferSelect;
}) {
  const aiGenerated = variant.origin === "generated";

  if (tab === "body") {
    const [categories, materials, findings] = await Promise.all([
      db.select().from(issueCategories).where(eq(issueCategories.projectId, projectId)),
      db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId)),
      db.select().from(numberFindings).where(eq(numberFindings.variantId, variant.id)),
    ]);
    const provesWhat = new Map(materials.map((m) => [m.id, m.provesWhat]));
    return (
      <>
        {aiGenerated && !archived && (
          <div className="mb-4">
            <VerifyToggle target="case" id={variant.id} projectId={projectId} variantId={variant.id} verified={variant.verified} by={verifiedBy["case"]} />
          </div>
        )}
        <FindingsPanel findings={findings} />
        <BodyTab
          projectId={projectId}
          variant={{
            id: variant.id,
            origin: variant.origin,
            debateCase: variant.debateCase,
            refTitles: Object.fromEntries(variant.sourceRefs.map((r) => [r.number, provesWhat.get(r.materialId) ?? ""])),
          }}
          categoryNames={Object.fromEntries(categories.map((c) => [c.id, c.name]))}
          readOnly={archived}
        />
      </>
    );
  }

  if (tab === "sources") {
    const materials = await db.select().from(sourceMaterials).where(eq(sourceMaterials.projectId, projectId));
    // 過去テーマの資料は、現テーマの立論へコピーできる（§3.5）
    let copyTargets: { id: string; label: string }[] = [];
    if (archived) {
      const [active] = await db.select().from(projects).where(eq(projects.status, "active"));
      if (active) {
        const cases = await db.select().from(caseVariants).where(eq(caseVariants.projectId, active.id));
        copyTargets = cases
          .filter((c) => c.debateCase.sections.length > 0)
          .map((c) => ({ id: c.id, label: `${SIDE_LABELS[c.side]}／${c.label}` }));
      }
    }
    return (
      <>
        {!archived && variant.debateCase.sections.length > 0 && (
          <p className="mb-4">
            <Link
              href={`/projects/${projectId}/upload?variant=${variant.id}`}
              className="inline-flex min-h-11 items-center rounded border border-[var(--accent)] px-4 text-sm font-bold text-[var(--accent)]"
            >
              自作の資料をこの立論に登録する
            </Link>
          </p>
        )}
      <SourcesTab
        projectId={projectId}
        variantId={variant.id}
        refs={variant.sourceRefs}
        materials={new Map(materials.map((m) => [m.id, m]))}
        archived={archived}
        copyTargets={copyTargets}
        verifiedBy={verifiedBy}
      />
      </>
    );
  }

  if (tab === "questions" || tab === "flowchart") {
    const nodes = await db.select().from(crossExamNodes).where(eq(crossExamNodes.targetVariantId, variant.id));
    const toggle = !archived && (
      <div className="mb-4">
        <VerifyToggle target="questions" id={variant.id} projectId={projectId} variantId={variant.id} verified={variant.questionsVerified} by={verifiedBy["questions"]} />
      </div>
    );
    if (nodes.length === 0) {
      return <p className="text-[var(--muted)]">質疑はまだできていません。</p>;
    }
    if (tab === "flowchart") {
      const flowNodes: FlowNode[] = nodes.map((n) => ({
        id: n.id,
        chainId: n.chainId,
        chainOrder: n.chainOrder,
        targetParagraph: n.targetParagraph,
        attackPoint: n.attackPoint,
        question: n.question,
        purpose: n.purpose,
        modelAnswer: n.modelAnswer,
        goal: n.goal ?? undefined,
        priority: n.priority,
        setOrder: n.setOrder,
        origin: n.origin,
        stuckCount: n.stuckCount,
        branches: n.branches,
      }));
      return (
        <>
          {toggle}
          <FlowchartView
            nodes={flowNodes}
            projectId={projectId}
            variantId={variant.id}
            readOnly={archived}
          />
        </>
      );
    }
    const paragraphs: { claimId: string; label: string }[] = [];
    variant.debateCase.sections.forEach((s, i) =>
      s.subsections.forEach((c, j) => paragraphs.push({ claimId: c.id, label: `${i + 1}（${j + 1}）${c.title}` })),
    );
    return (
      <>
        {toggle}
        <QuestionsTab
          projectId={projectId}
          variantId={variant.id}
          nodes={nodes}
          paragraphs={paragraphs}
          view={view}
          readOnly={archived}
          baseHref={`${base}?tab=questions`}
        />
      </>
    );
  }

  if (tab === "closing") {
    const [closing] = await db.select().from(closingTemplates).where(eq(closingTemplates.variantId, variant.id));
    return (
      <>
        {closing && !archived && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <VerifyToggle target="closing" id={variant.id} projectId={projectId} variantId={variant.id} verified={closing.verified} by={verifiedBy["closing"]} />
            <Link href={`/projects/${projectId}/print/closing?variant=${variant.id}`} className="text-sm underline">
              印刷用（手書きで埋める）
            </Link>
          </div>
        )}
        <ClosingTab closing={closing} />
      </>
    );
  }

  const [strategy] = await db.select().from(caseStrategies).where(eq(caseStrategies.variantId, variant.id));
  return (
    <>
      {strategy && !archived && (
        <div className="mb-4">
          <VerifyToggle target="strategy" id={variant.id} projectId={projectId} variantId={variant.id} verified={strategy.verified} by={verifiedBy["strategy"]} />
        </div>
      )}
      <StrategyTab strategy={strategy} />
    </>
  );
}

/** 誰が作り、誰が直したか（ログインの名前で記録している） */
function HistoryPanel({
  history,
  lastChange,
}: {
  history: VariantHistory;
  lastChange: VariantHistory["entries"][number] | undefined;
}) {
  if (history.entries.length === 0 && !history.createdBy) return null;
  return (
    <details className="mb-5 rounded border border-[var(--line)] px-3 py-2 text-sm">
      <summary className="cursor-pointer text-[var(--muted)]">
        {history.createdBy && (
          <>
            作成：<b className="text-[var(--foreground)]">{history.createdBy.who}</b>（{formatJstDateTime(history.createdBy.at)}）
          </>
        )}
        {history.createdBy && lastChange && "　"}
        {lastChange && (
          <>
            最終更新：<b className="text-[var(--foreground)]">{lastChange.who}</b>（{formatJstDateTime(lastChange.at)}）
          </>
        )}
        <span className="ml-2 underline">変更の記録を見る</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {history.entries.map((e, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="text-[var(--muted)]">{formatJstDateTime(e.at)}</span>
            <b>{e.who}</b>
            <span>
              {e.what && e.what !== "立論" ? `${e.what}：` : ""}
              {e.detail}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-[var(--muted)]">
        最近の{history.entries.length}件です。名前はログインのときに入れたものです（自己申告）。
      </p>
    </details>
  );
}
