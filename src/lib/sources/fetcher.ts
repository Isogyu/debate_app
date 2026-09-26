/**
 * 情報源の本文取得（v6 要件 §1-3 / 計画 §6.1）
 *
 *  - 許可ドメイン（§1-3a）以外は取りに行かない。リダイレクト先も毎回検査する
 *  - 取った本文は fetched_documents に保存し、引用文の照合元にする
 *  - 同じURLは取り直さない（費用と相手サーバーへの負荷を抑える）
 */

import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fetchedDocuments } from "@/db/schema";
import {
  hostOf,
  isAllowedSourceUrl,
  type FetchPurpose,
} from "@/domain/source-whitelist";
import { newId } from "@/lib/ids";
import { extractHtmlText, extractPdfText } from "@/lib/text-extract";

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export interface FetchedDocument {
  id: string;
  url: string;
  domain: string;
  title?: string;
  contentType: "html" | "pdf" | "json" | "text";
  text: string;
  pageOffsets?: number[];
  fetchedAt: string;
}

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const USER_AGENT =
  "DebateSupportApp/6.0 (+https://debate-app-zemi.fly.dev; university seminar study tool)";

/** 許可ドメインだけを辿って取得する。リダイレクトは自分で追う */
export async function safeFetch(
  url: string,
  purpose: FetchPurpose = "general",
  accept = "text/html,application/pdf,application/json;q=0.9,*/*;q=0.5",
): Promise<{ finalUrl: string; response: Response; body: Uint8Array }> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!isAllowedSourceUrl(current, purpose)) {
      throw new FetchBlockedError(`許可されていない情報源です: ${hostOf(current) ?? current}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
    } catch {
      clearTimeout(timer);
      throw new Error(`取得できませんでした（接続できない・時間切れ）: ${current}`);
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      const location = response.headers.get("location");
      if (!location) throw new Error(`リダイレクト先が不明です: ${current}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      throw new Error(`取得できませんでした（HTTP ${response.status}）: ${current}`);
    }

    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) {
      clearTimeout(timer);
      throw new Error(`ファイルが大きすぎます（${Math.round(length / 1024 / 1024)}MB）: ${current}`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    clearTimeout(timer);
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`ファイルが大きすぎます: ${current}`);
    }
    return { finalUrl: current, response, body: buf };
  }
  throw new Error(`リダイレクトが多すぎます: ${url}`);
}

function detectType(contentType: string, body: Uint8Array): FetchedDocument["contentType"] {
  if (contentType.includes("pdf") || (body[0] === 0x25 && body[1] === 0x50)) return "pdf";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("html") || contentType.includes("xml")) return "html";
  return "text";
}

/** 文字コードを見て文字列にする。官公庁サイトには Shift_JIS がまだ多い */
function decode(body: Uint8Array, contentType: string): string {
  const fromHeader = contentType.match(/charset=([\w-]+)/i)?.[1];
  const head = new TextDecoder("ascii").decode(body.slice(0, 2048));
  const fromMeta = head.match(/charset=["']?([\w-]+)/i)?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset === "shift-jis" ? "shift_jis" : charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function toRow(row: typeof fetchedDocuments.$inferSelect): FetchedDocument {
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    title: row.title ?? undefined,
    contentType: row.contentType as FetchedDocument["contentType"],
    text: row.text,
    pageOffsets: row.pageOffsets ?? undefined,
    fetchedAt: row.fetchedAt,
  };
}

/** 本文を取得して保存する。保存済みならそれを返す */
export async function fetchDocument(
  url: string,
  purpose: FetchPurpose = "general",
): Promise<FetchedDocument> {
  const [cached] = await db
    .select()
    .from(fetchedDocuments)
    .where(eq(fetchedDocuments.url, url));
  if (cached) return toRow(cached);

  const { finalUrl, response, body } = await safeFetch(url, purpose);
  const contentTypeHeader = response.headers.get("content-type") ?? "";
  const type = detectType(contentTypeHeader, body);

  let text: string;
  let title: string | undefined;
  let pageOffsets: number[] | undefined;
  if (type === "pdf") {
    const extracted = await extractPdfText(body);
    text = extracted.text;
    pageOffsets = extracted.pageOffsets;
  } else if (type === "html") {
    const extracted = await extractHtmlText(decode(body, contentTypeHeader), finalUrl);
    text = extracted.text;
    title = extracted.title;
  } else {
    text = decode(body, contentTypeHeader);
  }
  if (!text.trim()) throw new Error(`本文が空でした: ${finalUrl}`);

  const row = {
    id: newId("doc"),
    url,
    domain: hostOf(finalUrl) ?? "",
    title: title ?? null,
    contentType: type,
    text,
    pageOffsets: pageOffsets ?? null,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  await db.insert(fetchedDocuments).values(row).onConflictDoNothing();
  const [saved] = await db
    .select()
    .from(fetchedDocuments)
    .where(eq(fetchedDocuments.url, url));
  return toRow(saved);
}

/** API（JSON）の取得。保存はしない（照合元は本文テキストの方） */
export async function fetchJson<T>(url: string): Promise<T> {
  const { body } = await safeFetch(url, "general", "application/json");
  const text = new TextDecoder("utf-8").decode(body);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`応答を読み取れませんでした: ${url}`);
  }
}

/** API の本文（法令・会議録など）を照合元として保存する */
export async function saveApiDocument(
  url: string,
  title: string,
  text: string,
): Promise<FetchedDocument> {
  const [cached] = await db
    .select()
    .from(fetchedDocuments)
    .where(eq(fetchedDocuments.url, url));
  if (cached) return toRow(cached);
  await db
    .insert(fetchedDocuments)
    .values({
      id: newId("doc"),
      url,
      domain: hostOf(url) ?? "",
      title,
      contentType: "text",
      text,
      pageOffsets: null,
      sha256: createHash("sha256").update(text).digest("hex"),
    })
    .onConflictDoNothing();
  const [saved] = await db
    .select()
    .from(fetchedDocuments)
    .where(eq(fetchedDocuments.url, url));
  return toRow(saved);
}
