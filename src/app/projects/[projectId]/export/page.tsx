/**
 * エクスポート画面（DESIGN.md §12 EXP）
 *
 * Word＝ダウンロード、PDF＝印刷ビュー、という違いを画面で明示する。
 * 「なぜPDFだけ別画面なのか」が分からないと迷うため。
 */

import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { caseVariants, projects } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { buildExportData } from "@/lib/export/data";
import { VariantPicker } from "./variant-picker";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { projectId } = await params;
  const { variant } = await searchParams;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) notFound();

  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));
  const data = await buildExportData(projectId, variant);

  const current =
    variants.find((v) => v.id === variant) ??
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide) ??
    variants[0];

  const q = current ? `?variant=${current.id}` : "";
  const unresolved = data?.sources.filter((s) => !s.citation).length ?? 0;

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

        {!data || variants.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
            出力できる立論がまだありません。
          </p>
        ) : (
          <>
            {variants.length > 1 && (
              <VariantPicker
                projectId={projectId}
                currentId={current!.id}
                options={variants.map((v) => ({
                  id: v.id,
                  label: `${v.side === "affirmative" ? "肯定側" : "否定側"} ${v.framework} / ${v.approach}`,
                }))}
              />
            )}

            {data.warnings.length > 0 && (
              <p className="mb-4 rounded border-2 border-[var(--neg)] p-3 text-sm">
                {data.warnings.join(" / ")}
              </p>
            )}

            {unresolved > 0 && (
              <p className="mb-5 rounded border border-[var(--line)] p-3 text-sm">
                出典が未登録の資料が <b>{unresolved}件</b> あります。
                参考資料には「出典：＿＿＿」の空欄で出力されます。
              </p>
            )}

            <section className="mb-6">
              <h2 className="mb-1 text-lg font-bold">Word（.docx）</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                実フォーマットのまま出力します。ダウンロードしてWordで開いてください。
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={`/api/projects/${projectId}/export/case${q}`}
                  className="rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
                >
                  立論をダウンロード
                </a>
                <a
                  href={`/api/projects/${projectId}/export/sources${q}`}
                  className="rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
                >
                  参考資料をダウンロード
                </a>
              </div>
            </section>

            <section className="mb-6">
              <h2 className="mb-1 text-lg font-bold">PDF・印刷</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                印刷用の画面を開き、ブラウザの印刷から「PDFに保存」を選びます。
                紙に印刷する場合もこちらです。
              </p>
              <div className="flex flex-wrap gap-3">
                {[
                  { kind: "case", label: "立論" },
                  { kind: "sources", label: "参考資料" },
                  { kind: "blocks", label: "ブロック集（本番用）" },
                ].map((item) => (
                  <Link
                    key={item.kind}
                    href={`/projects/${projectId}/print/${item.kind}${q}`}
                    className="rounded border-2 border-[var(--accent)] px-5 py-3 font-bold text-[var(--accent)]"
                  >
                    {item.label}を印刷
                  </Link>
                ))}
              </div>
            </section>

            <p className="text-sm text-[var(--muted)]">
              ※ブロック集は争点カテゴリごとに改ページされ、紙でめくって引ける構成で出力されます。
            </p>
          </>
        )}
      </main>
    </>
  );
}
