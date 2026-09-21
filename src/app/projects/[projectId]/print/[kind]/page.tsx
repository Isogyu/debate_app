/**
 * 印刷ビュー（REQUIREMENTS.md §12）
 *
 * これがPDFの実体。ブラウザの「印刷 → PDFとして保存」で
 * 実フォーマットのPDFになる。サーバーにChromiumを持ち込まないための選択。
 */

import { notFound } from "next/navigation";
import { buildExportData, EMPTY_CITATION, SIDE_LABELS, verificationNotice } from "@/lib/export/data";
import type { ExportData } from "@/lib/export/data";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  case: "立論",
  sources: "参考資料",
  blocks: "ブロック集",
};

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; kind: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { projectId, kind } = await params;
  const { variant } = await searchParams;
  if (!(kind in KIND_LABELS)) notFound();

  const data = await buildExportData(projectId, variant);
  if (!data) notFound();

  return (
    <main className="print-sheet px-4 py-8">
      <div className="no-print mb-6 rounded border border-[var(--line)] p-4">
        <p className="mb-3 text-sm">
          この画面を印刷すると、そのままPDFとして保存できます。
          印刷ダイアログの「送信先」で<b>「PDFに保存」</b>を選んでください。
        </p>
        <p className="mb-3 text-sm">
          読み上げ時間の目安: <b>{data.speech.label}</b>（{data.speech.chars}字）
        </p>
        {data.warnings.length > 0 && (
          <p className="mb-3 rounded border-2 border-[var(--neg)] p-2 text-sm">
            {data.warnings.join(" / ")}
          </p>
        )}
        <PrintButton />
      </div>

      {kind === "case" && <CaseSheet data={data} />}
      {kind === "sources" && <SourcesSheet data={data} />}
      {kind === "blocks" && <BlocksSheet data={data} />}

      <p className="mt-8 text-right text-xs italic text-[var(--muted)]">
        {verificationNotice(data.allVerified)}
      </p>
    </main>
  );
}

function SheetHeader({ data, kind }: { data: ExportData; kind: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-lg font-bold">
        {data.teamName || "（チーム名未設定）"}　{SIDE_LABELS[data.side]}側{kind}
      </h1>
      {data.members.length > 0 && <p>{data.members.join("　")}</p>}
    </header>
  );
}

/** 立論（§2.1の構造をそのまま紙に落とす） */
function CaseSheet({ data }: { data: ExportData }) {
  const c = data.debateCase;
  return (
    <article>
      <SheetHeader data={data} kind="立論" />

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
              <p className="font-bold">
                （{j + 1}）{sub.title}
              </p>
              <p className="pl-4">{sub.claim}</p>
              {sub.warrant && <p className="pl-4">{sub.warrant}</p>}
              {sub.impact && <p className="pl-4">{sub.impact}</p>}
            </div>
          ))}
        </section>
      ))}

      <h2 className="mt-5 mb-2 font-bold">Ⅲ. 結論</h2>
      <p className="pl-4">{c.conclusion}</p>
    </article>
  );
}

/** 参考資料（§2.3） */
function SourcesSheet({ data }: { data: ExportData }) {
  // 同じ法令の条文はまとめる
  const lawGroups = new Map<string, typeof data.relatedLaws>();
  for (const law of data.relatedLaws) {
    lawGroups.set(law.name, [...(lawGroups.get(law.name) ?? []), law]);
  }

  return (
    <article>
      <SheetHeader data={data} kind="参考資料" />

      <h2 className="mt-5 mb-2 font-bold">Ⅰ. 関連法令</h2>
      {lawGroups.size === 0 && <p className="pl-4">（関連法令が登録されていません）</p>}
      {[...lawGroups.entries()].map(([name, laws], i) => (
        <section key={name} className="mb-3">
          <h3 className="font-bold">
            {i + 1}. {name}
          </h3>
          {laws.map((law) => (
            <p key={law.id} className="pl-4">
              {law.article}
              {law.fullText ?? (
                <span className="text-[var(--muted)]">
                  （条文未登録：e-Gov法令検索から本文を貼り付けてください）
                </span>
              )}
            </p>
          ))}
        </section>
      ))}

      <h2 className="mt-5 mb-2 font-bold">Ⅱ. 資料</h2>
      {data.sources.length === 0 && <p className="pl-4">（資料が登録されていません）</p>}
      {data.sources.map((s) => (
        <section key={s.number} className="print-block mb-4">
          <h3 className="font-bold">
            {s.number}. {s.provesWhat}
          </h3>
          {s.quote && (
            <p className="pl-4">
              「{s.quote}」{s.modificationNote ?? ""}
            </p>
          )}
          {/* 未登録は空欄で出す。埋め忘れが紙の上で見えるようにする（§12） */}
          <p className="pl-4">{s.citation ?? EMPTY_CITATION}</p>
        </section>
      ))}
    </article>
  );
}

/**
 * ブロック集（§12「カテゴリ見出し付き、紙でパラパラ引ける構成」）
 * 本番中に紙で引くので、カテゴリごとに改頁し、カードは頁またぎで割らない。
 */
function BlocksSheet({ data }: { data: ExportData }) {
  const byCategory = new Map<string, typeof data.blocks>();
  for (const block of data.blocks) {
    for (const name of block.categoryNames.length ? block.categoryNames : ["その他"]) {
      byCategory.set(name, [...(byCategory.get(name) ?? []), block]);
    }
  }

  return (
    <article>
      <SheetHeader data={data} kind="ブロック集" />
      {byCategory.size === 0 && <p>ブロックがまだ生成されていません。</p>}

      {[...byCategory.entries()].map(([category, items]) => (
        <section key={category} className="print-page-break mb-6">
          <h2 className="mb-3 border-b-2 border-black pb-1 text-lg font-bold">
            {category}（{items.length}件）
          </h2>
          {items.map((block, i) => (
            <div
              key={i}
              className="print-block mb-4 border border-[var(--line)] p-3"
            >
              <p className="font-bold">相手: 「{block.opponentArgument}」</p>
              <p className="mt-1">返し: {block.summary}</p>
              {block.rebuttalArguments.map((arg, j) => (
                <p key={j} className="mt-1 pl-4 text-sm">
                  ・{arg}
                </p>
              ))}
              {block.materialNumbers.length > 0 && (
                <p className="mt-1 text-sm">
                  使える資料: {block.materialNumbers.map((n) => `資料${n}`).join("、")}
                </p>
              )}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
