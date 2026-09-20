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
} from "./provider";
import { LlmConfigError, LlmSchemaError } from "./provider";

export const DEFAULT_MODEL = process.env.DEBATE_MODEL ?? "claude-sonnet-5";

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
    const response = await getClient().messages.create({
      model,
      max_tokens: req.maxTokens ?? 8000,
      system: `${req.system}\n\n出力は説明文を付けず、JSONオブジェクトのみを返してください。`,
      messages: [{ role: "user", content: req.prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
    };

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
