/**
 * エクスポート画面（v6 要件 F12・§9 画面構成）
 *
 * Word＝ダウンロード、PDF＝印刷画面から保存、という違いを画面で明示する。
 * 「なぜPDFだけ別の画面なのか」が分からないと迷うため。
 */

import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, projects } from "@/db/schema";
import { Breadcrumb, Header, SideBadge } from "@/components/chrome";
import { CASE_ORIGIN_LABELS, SIDE_LABELS } from "@/domain/types";
import { buildExportData } from "@/lib/export/data";
import { requireSession } from "@/lib/session";
import { VariantPicker } from "./variant-picker";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  await requireSession();
  const { projectId } = await params;
  const { variant } = await searchParams;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();

  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId))
    .orderBy(asc(caseVariants.side), asc(caseVariants.createdAt));

  const current = variants.find((v) => v.id === variant) ?? variants[0];
  const data = current ? await buildExportData(current.id, { projectId }) : null;
  const q = current ? `?variant=${encodeURIComponent(current.id)}` : "";

  const wordLinks = [
    { kind: "case", label: "立論（Word）" },
    { kind: "sources", label: "参考資料（Word・表とグラフ入り）" },
  ];
  const printLinks = [
    { kind: "case", label: "立論を印刷" },
    { kind: "sources", label: "参考資料を印刷" },
    { kind: "flowchart", label: "質疑フローチャートを印刷" },
    { kind: "closing", label: "最終弁論の雛形を印刷" },
  ];

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: project.title, href: `/projects/${projectId}` },
            { label: "エクスポート" },
          ]}
        />
        <h1 className="mb-5 text-2xl font-bold">エクスポート</h1>

        {!current || !data ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            出力できる立論がまだありません。立論を登録するか、生成してください。
          </p>
        ) : (
          <>
            <VariantPicker
              projectId={projectId}
              currentId={current.id}
              options={variants.map((v) => ({
                id: v.id,
                label: `${SIDE_LABELS[v.side]}・${CASE_ORIGIN_LABELS[v.origin]}｜${v.label}`,
              }))}
            />

            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <SideBadge side={data.side} />
              <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs">
                {data.originLabel}
              </span>
              <span className="font-bold">{data.label}</span>
              <span className="text-[var(--muted)]">
                読み上げ時間の目安：{data.speech.label}（{data.speech.chars}字）
              </span>
            </div>

            {data.warnings.length > 0 && (
              <section className="mb-5 rounded border-2 border-[var(--neg)] p-3 text-sm">
                <h2 className="mb-1 font-bold">出力の前に確認してください</h2>
                <ul className="list-disc pl-5">
                  {data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  このままでも出力できます。未確認・未完成のものは、出力した文書にもそう表示されます。
                </p>
              </section>
            )}

            <section className="mb-6">
              <h2 className="mb-1 text-lg font-bold">Word（.docx）</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                実物と同じ書式で出力します。ダウンロードしてWordで開いてください。
                統計の資料には、表・グラフ・計算の過程が入ります。
              </p>
              <div className="flex flex-wrap gap-3">
                {wordLinks.map((l) => (
                  <a
                    key={l.kind}
                    href={`/api/projects/${projectId}/export/${l.kind}${q}`}
                    className="inline-flex min-h-11 items-center rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </section>

            <section className="mb-6">
              <h2 className="mb-1 text-lg font-bold">印刷・PDF</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                印刷用の画面を開き、ブラウザの印刷から「PDFに保存」を選びます。紙に印刷するときもこちらです。
                最終弁論の雛形は、試合中に手書きで空欄を埋められるように印刷されます。
              </p>
              <div className="flex flex-wrap gap-3">
                {printLinks.map((l) => (
                  <Link
                    key={l.kind}
                    href={`/projects/${projectId}/print/${l.kind}${q}`}
                    className="inline-flex min-h-11 items-center rounded border-2 border-[var(--accent)] px-5 py-3 font-bold text-[var(--accent)]"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
