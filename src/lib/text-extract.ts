/**
 * ファイル・ページの本文をテキストにする。
 * 登録（.docx / PDF）と資料取得（HTML / PDF）の両方から使う。
 */

import "server-only";

export interface ExtractedText {
  text: string;
  /** PDF のページ境界（text 内の開始位置） */
  pageOffsets?: number[];
  totalPages?: number;
  title?: string;
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

/** これ未満しか文字が取れないPDFは、スキャン画像だけのPDFとみなす（§3.2） */
const MIN_PDF_CHARS_PER_PAGE = 20;

export async function extractPdfText(
  data: Uint8Array,
  maxPages = 60,
): Promise<ExtractedText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch {
    throw new ExtractError("PDFを開けませんでした。ファイルが壊れていないか確認してください。");
  }
  if (pdf.numPages > maxPages) {
    throw new ExtractError(`PDFのページ数が多すぎます（${pdf.numPages}ページ。上限${maxPages}ページ）。`);
  }
  const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
  const pageOffsets: number[] = [];
  let text = "";
  for (const page of pages) {
    pageOffsets.push(text.length);
    text += page + "\n";
  }
  const meaningful = text.replace(/\s/g, "").length;
  if (meaningful < MIN_PDF_CHARS_PER_PAGE * Math.max(1, totalPages) * 0.5) {
    throw new ExtractError(
      "PDFから文字を読み取れませんでした。スキャン画像だけのPDFは取り込めません（Wordか、文字を選択できるPDFにしてください）。",
    );
  }
  return { text, pageOffsets, totalPages };
}

export async function extractDocxText(data: Uint8Array): Promise<ExtractedText> {
  const mammoth = await import("mammoth");
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    // mammoth は段落ごとに空行を挟む。行番号で区切りを指示するため詰める
    const text = value.replace(/\n{2,}/g, "\n").trim();
    if (!text) throw new ExtractError("Wordファイルに本文が見つかりませんでした。");
    return { text };
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError("Wordファイルを開けませんでした。.docx 形式か確認してください。");
  }
}

export async function extractHtmlText(html: string, url: string): Promise<ExtractedText> {
  const { parseHTML } = await import("linkedom");
  const { Readability } = await import("@mozilla/readability");
  const { document } = parseHTML(html);
  const title = document.querySelector("title")?.textContent?.trim() ?? undefined;
  try {
    // Readability は document を書き換えるので、先に title を取っておく
    const article = new Readability(document as unknown as Document, {
      charThreshold: 200,
    }).parse();
    const text = article?.textContent?.replace(/\n{3,}/g, "\n\n").trim();
    if (text && text.length > 200) return { text, title: article?.title || title };
  } catch {
    // 本文抽出に失敗したら全文のテキストで代用する
  }
  const fallback = parseHTML(html).document;
  for (const el of fallback.querySelectorAll("script,style,nav,header,footer,noscript")) {
    el.remove();
  }
  const text = (fallback.body?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  void url;
  return { text, title };
}

/** アップロードされたファイルの形式判定（拡張子と先頭バイト） */
export function detectUploadKind(
  fileName: string,
  data: Uint8Array,
): "docx" | "pdf" | "txt" | null {
  const lower = fileName.toLowerCase();
  const isPdf = data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46; // %PDF
  const isZip = data[0] === 0x50 && data[1] === 0x4b; // PK
  if (lower.endsWith(".pdf") && isPdf) return "pdf";
  if (lower.endsWith(".docx") && isZip) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

/**
 * 文字化け・数字の羅列になっていないか。
 * 立論・資料は日本語の文章なので、かな・漢字がほとんど無ければ読み取りに失敗している。
 */
export function looksGarbled(text: string): boolean {
  const chars = text.replace(/\s/g, "");
  if (chars.length < 50) return false;
  const japanese = (chars.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
  const replacement = (chars.match(/[\ufffd\u25a1]/g) ?? []).length; // � □
  return japanese / chars.length < 0.3 || replacement / chars.length > 0.05;
}

/**
 * 登録ファイルの読み取り。Word（.docx）だけを受け付ける。
 * PDF は作り方によって文字の並びや字形が崩れ（数字の羅列・文字化け）、
 * 立論の論理展開が読み取れなかったため、登録では使わない（資料の自動取得では引き続き使う）。
 */
export async function extractUploadText(
  fileName: string,
  data: Uint8Array,
): Promise<ExtractedText> {
  const kind = detectUploadKind(fileName, data);
  if (kind === "pdf") {
    throw new ExtractError(
      "PDFは文字の読み取りが崩れることがあるため、登録できません。Wordで開いて .docx 形式で保存し直してから登録してください。",
    );
  }
  if (kind !== "docx") {
    throw new ExtractError(
      "登録できるのは Word（.docx）のファイルだけです。古い .doc 形式やPDFは、Wordで .docx に保存し直してください。",
    );
  }
  const extracted = await extractDocxText(data);
  if (looksGarbled(extracted.text)) {
    throw new ExtractError(
      "ファイルの文字を正しく読み取れませんでした（文字化けしています）。Wordで開いて文字が正しく表示されるか確認し、.docx で保存し直してください。",
    );
  }
  return extracted;
}
