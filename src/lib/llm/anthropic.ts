/**
 * Claude APIプロバイダ実装。
 *
 * APIキーはサーバー環境変数のみで扱い、クライアントには一切返さない（§6.2 機密性）。
 * このファイルは server-only。
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmProvider,
  LlmResult,
  StructuredRequest,
  WebSearchHit,
  WebSearchRequest,
} from "./provider";
import { LlmConfigError, LlmSchemaError, LlmTruncatedError } from "./provider";

export const DEFAULT_MODEL = process.env.DEBATE_MODEL ?? "claude-sonnet-5";

/** 出力の既定上限。切れると必ずJSONが壊れるので余裕を持たせる */
export const DEFAULT_MAX_TOKENS = 12000;

/**
 * APIの失敗を、ゼミ生が読んで意味の分かる日本語にする。
 * 生のエラーには内部情報が混じるので、そのまま見せない（§6.3 エラー設計）。
 */
function translateApiError(err: unknown): Error {
  // すでに意味のあるエラーになっているものは、そのまま通す。
  // ここで包み直すと「APIキーが設定されていません」という具体的な案内が
  // 「接続できませんでした」に化け、しかもリトライ対象に戻ってしまう
  if (err instanceof LlmConfigError || err instanceof LlmTruncatedError) {
    return err;
  }

  if (!(err instanceof Anthropic.APIError)) {
    return new Error(
      "AIに接続できませんでした。通信の状況を確認して、もう一度お試しください。",
    );
  }

  switch (err.status) {
    case 401:
    case 403:
      // やり直しても無駄なので設定エラーとして扱い、その場で諦める
      return new LlmConfigError(
        "APIキーが正しくないか、利用できない状態です。管理者に連絡してください。",
      );
    case 429:
      return new Error(
        "AIへの問い合わせが混み合っています。少し待ってからもう一度お試しください。",
      );
    case 400:
      return new Error(
        "AIへの依頼内容に問題がありました。管理者に連絡してください。",
      );
    default:
      if (err.status && err.status >= 500) {
        return new Error(
          "AI側で問題が起きています。時間をおいてもう一度お試しください。",
        );
      }
      return new Error("AIへの問い合わせに失敗しました。もう一度お試しください。");
  }
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "APIキーが設定されていません。管理者に連絡してください。（サーバーの .env に ANTHROPIC_API_KEY を設定します）",
    );
  }
  client ??= new Anthropic({ apiKey });
  return client;
}

/** ```json フェンスやモデルの前置きが混ざっても拾えるようにする */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  async generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    const model = req.model ?? DEFAULT_MODEL;

    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model,
        // 日本語の構造化出力は嵩む。8000だと反駁・質疑が途中で切れた
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: `${req.system}\n\n出力は説明文を付けず、JSONオブジェクトのみを返してください。`,
        messages: [{ role: "user", content: req.prompt }],
      });
    } catch (err) {
      // SDKの例外はJSONの生文字列をmessageに持つ。そのまま画面に出すと
      // 「401 {"type":"error"...}」という表示になるので日本語に置き換える
      throw translateApiError(err);
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
    };

    // 上限で切れたJSONは必ずパースに失敗する。
    // 「読み取れませんでした」で片付けると原因に辿り着けないので先に判定する
    if (response.stop_reason === "max_tokens") {
      throw new LlmTruncatedError(
        `AIの回答が長すぎて途中で切れました（出力上限 ${req.maxTokens ?? DEFAULT_MAX_TOKENS} トークン）。`,
        response.usage.output_tokens,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      throw new LlmSchemaError("AIの出力がJSONとして読み取れませんでした。", text);
    }

    const result = req.schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmSchemaError(
        `AIの出力が想定した形式と違いました: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join(" / ")}`,
        text,
      );
    }

    return { data: result.data, usage };
  }

  /**
   * Claude のサーバー側 Web 検索ツールで URL だけを集める。
   * allowed_domains で検索範囲を §1-3a の情報源に限定する。
   * 検索結果ブロックから URL を直接拾い、モデルの文章は使わない。
   */
  async searchWeb(req: WebSearchRequest): Promise<LlmResult<WebSearchHit[]>> {
    const model = DEFAULT_MODEL;
    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model,
        max_tokens: 1024,
        system:
          "あなたは資料探しの補助です。与えられた検索語で web_search を使い、関係しそうなページを探してください。回答の文章は不要です。",
        messages: [{ role: "user", content: `検索語: ${req.query}` }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: req.maxUses ?? 2,
            allowed_domains: req.allowedDomains,
          },
        ],
      });
    } catch (err) {
      throw translateApiError(err);
    }

    const hits: WebSearchHit[] = [];
    const seen = new Set<string>();
    for (const block of response.content) {
      if (block.type !== "web_search_tool_result") continue;
      if (!Array.isArray(block.content)) continue; // 検索エラー
      for (const r of block.content) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        hits.push({ url: r.url, title: r.title });
      }
    }

    return {
      data: hits,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model,
      },
    };
  }
}

let provider: LlmProvider | null = null;

/** 呼び出し側はここ経由でのみプロバイダを取得する */
export function getLlmProvider(): LlmProvider {
  provider ??= new AnthropicProvider();
  return provider;
}

/** テスト用にプロバイダを差し替える */
export function setLlmProvider(p: LlmProvider): void {
  provider = p;
}
