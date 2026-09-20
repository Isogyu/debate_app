/**
 * Word のダウンロード（REQUIREMENTS.md §12）
 *
 * PDFはここでは作らない。印刷ビュー＋印刷CSSでブラウザのPDF保存を使う。
 * サーバーでPDFを作るとDockerイメージにChromiumと日本語フォントが必要になり、
 * 「管理者のPC1台で動く」構成（§6.1）と釣り合わない。
 */

import { NextResponse } from "next/server";
import { buildExportData, SIDE_LABELS } from "@/lib/export/data";
import { buildCaseDocx, buildSourcesDocx } from "@/lib/export/docx";
import { currentUserId, log } from "@/lib/session";

const KINDS = { case: "立論", sources: "参考資料" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; kind: string }> },
) {
  const { projectId, kind } = await params;
  if (!(kind in KINDS)) {
    return NextResponse.json(
      { error: "出力できない種類が指定されました。" },
      { status: 400 },
    );
  }

  const variantId =
    new URL(request.url).searchParams.get("variant") ?? undefined;
  const data = await buildExportData(projectId, variantId);
  if (!data) {
    return NextResponse.json(
      { error: "プロジェクトまたは立論が見つかりませんでした。" },
      { status: 404 },
    );
  }

  const buffer =
    kind === "case" ? await buildCaseDocx(data) : await buildSourcesDocx(data);

  const userId = (await currentUserId()) ?? "unknown";
  await log(userId, "export", kind, projectId, `${KINDS[kind as keyof typeof KINDS]}をWordで出力`);

  const name = `${data.teamName || "ディベート"}_${SIDE_LABELS[data.side]}側${
    KINDS[kind as keyof typeof KINDS]
  }.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // 日本語ファイル名はRFC 5987で渡す。そのまま入れると文字化けする
      "Content-Disposition": `attachment; filename="export.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
