/**
 * 登録した立論が賛成側か反対側かを判定する（登録画面で「どちらの立論ですか」を聞かないため）。
 *
 * まず原稿の言葉でコードが判定し（「べきではない」「反対側」など）、決まらないときだけ
 * 軽いモデルに論題と主張を見せて判定させる。判定を誤っても、立論の画面で入れ替えられる。
 */

import "server-only";
import { z } from "zod";
import type { Side } from "@/domain/types";
import { getLlmProvider, LIGHT_MODEL } from "@/lib/llm/anthropic";

/** Ⅰ主張の部分（見つからなければ冒頭）を取り出す */
function claimPart(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^[\s　]*Ⅰ/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^[\s　]*Ⅱ/.test(l));
  if (start >= 0) return lines.slice(start, end > start ? end : start + 6).join("\n");
  return lines.slice(0, 8).join("\n");
}

/** 原稿の言葉だけで判定する。決まらなければ null */
export function detectSideByText(fileName: string, text: string): Side | null {
  const head = `${fileName}\n${text.split("\n").slice(0, 3).join("\n")}`;
  if (/(反対|否定)側/.test(head)) return "negative";
  if (/(賛成|肯定)側/.test(head)) return "affirmative";
  const claim = claimPart(text);
  if (/べき\s*(では|で)\s*ない|すべきでない|認められない|反対する/.test(claim)) return "negative";
  if (/べきである|べきだ|すべきである/.test(claim)) return "affirmative";
  return null;
}

const sideSchema = z.object({ side: z.enum(["affirmative", "negative"]) });

export async function detectSide(
  resolution: string,
  fileName: string,
  text: string,
): Promise<Side> {
  const byText = detectSideByText(fileName, text);
  if (byText) return byText;
  try {
    const { data } = await getLlmProvider().generateStructured({
      system: "あなたはディベートの立論を分類する補助です。",
      prompt: `論題: ${resolution}\n\n次の立論の主張は、論題に賛成（affirmative）ですか、反対（negative）ですか。\n\n${claimPart(text)}\n\n出力するJSON: { "side": "affirmative" または "negative" }`,
      schema: sideSchema,
      model: LIGHT_MODEL,
      maxTokens: 200,
    });
    return data.side;
  } catch (err) {
    console.error("[upload] 賛成・反対の判定に失敗しました（賛成側として登録します）", err);
    return "affirmative";
  }
}
