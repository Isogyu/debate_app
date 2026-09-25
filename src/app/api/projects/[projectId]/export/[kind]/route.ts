/**
 * Word のダウンロード（v6 要件 F12）
 *
 * GET /api/projects/{テーマ}/export/{case|sources}?variant={立論}
 * PDF はここでは作らない。印刷画面＋印刷CSSでブラウザの「PDFに保存」を使う
 * （サーバーに Chromium を持ち込まないため。§1 制約7）。
 */

import { NextResponse, type NextRequest } from "next/server";
import { buildExportData } from "@/lib/export/data";
import { buildCaseDocx, buildSourcesDocx, exportFileName } from "@/lib/export/docx";
import { currentUserId, log } from "@/lib/session";

const KINDS = { case: "立論", sources: "参考資料" } as const;
type WordKind = keyof typeof KINDS;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string; kind: string }> },
) {
  // ダウンロードはリンクから直接開かれるので、画面遷移ではなく 401 で返す
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const { projectId, kind } = await ctx.params;
  if (!(kind in KINDS)) {
    return NextResponse.json({ error: "出力できない種類が指定されました。" }, { status: 400 });
  }
  const variantId = request.nextUrl.searchParams.get("variant");
  if (!variantId) {
    return NextResponse.json({ error: "出力する立論を選んでください。" }, { status: 400 });
  }

  const data = await buildExportData(variantId, { projectId });
  if (!data) {
    return NextResponse.json({ error: "テーマまたは立論が見つかりませんでした。" }, { status: 404 });
  }

  const wordKind = kind as WordKind;
  const buffer = wordKind === "case" ? await buildCaseDocx(data) : await buildSourcesDocx(data);

  await log(userId, "export", `${wordKind}:${variantId}`, projectId, `${KINDS[wordKind]}をWordで出力`);

  const name = exportFileName(data, wordKind);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // 日本語ファイル名は RFC 5987 で渡す。そのまま入れると文字化けする
      "Content-Disposition": `attachment; filename="export.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
