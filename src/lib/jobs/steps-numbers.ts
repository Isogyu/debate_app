/**
 * 生成ステップ: 数字の検査（v6 要件 §1-9）
 *
 *  - 出典の明記 … 数字が【資料N参照】で出典に結びつき、その資料に実際にその数字があるか
 *  - 計算の再現 … 統計資料の計算結果と本文の数字が一致するか
 *  - 比較の前提 … 統計資料の比較の前提（年次・定義・単位…）の検査結果
 *  - 使い方の妥当性 … AI が点検し、弱点として質疑・戦い方に回す
 *
 * 生成立論は、出典のない数字を本文から除き、取得した統計の数字だけを差し込む。
 * 登録立論は本文を書き換えず、指摘だけする。
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { caseVariants, numberFindings } from "@/db/schema";
import { extractCaseNumbers, extractNumbers, splitSentences, type NumberMention } from "@/domain/numbers";
import { normalizeForMatch } from "@/domain/quote";
import { formatNumber, roughlyEqual } from "@/domain/statistics";
import { renderFullText } from "@/domain/case-format";
import type { DebateCase, NumberFinding, SourceRequirement } from "@/domain/types";
import { numberUsageSchema, paragraphTextSchema } from "@/domain/schemas";
import { getLlmProvider } from "@/lib/llm/anthropic";
import * as P from "@/lib/llm/prompts";
import * as PS from "@/lib/llm/prompts-sources";
import { newId } from "@/lib/ids";
import { adjustLengthWarning } from "./length";
import {
  loadMaterialsFor,
  loadVariant,
  recordAiRevision,
  UsageMeter,
  type StepContext,
} from "./common";

type MaterialRow = Awaited<ReturnType<typeof loadMaterialsFor>>[number];

interface AllowedNumber {
  refNumber: number;
  label: string;
  text: string;
  value: number;
  unit: string;
}

/** 統計資料から、本文で使ってよい数字の一覧を作る */
function allowedNumbersOf(refNumber: number, m: MaterialRow): AllowedNumber[] {
  const s = m.statistic;
  if (!s || m.status === "procedure") return [];
  return [
    ...s.inputs.map((i) => ({
      refNumber,
      label: `${i.label}（${i.year}）`,
      text: formatNumber(i.value, i.unit),
      value: i.value,
      unit: i.unit,
    })),
    ...s.results.map((r) => ({
      refNumber,
      label: r.label,
      text: formatNumber(r.value, r.unit),
      value: r.value,
      unit: r.unit,
    })),
  ];
}

/** 本文の数字が、許された数字のどれかと一致するか。割は％に直して比べる */
export function matchesAllowed(m: NumberMention, allowed: AllowedNumber[]): boolean {
  if (m.value === null) return false;
  const candidates = [m.value];
  if (m.unit === "割") candidates.push(m.value * 10);
  return allowed.some((a) => candidates.some((v) => roughlyEqual(v, a.value)));
}

/** 引用文（統計以外の資料）に、その数字がそのまま書かれているか */
function appearsInQuote(m: NumberMention, quote: string | null | undefined): boolean {
  if (!quote) return false;
  const digits = normalizeForMatch(m.text).replace(/^(約|およそ|実に|わずか)/, "").replace(/,/g, "");
  const q = normalizeForMatch(quote).replace(/,/g, "");
  const core = digits.match(/[0-9.]+/)?.[0];
  return !!core && q.includes(core);
}

interface Classified {
  mention: NumberMention;
  sourced: boolean;
  reason: string;
  /** 統計資料に結びついているが値が合わない */
  calcMismatch: boolean;
}

function classify(
  mention: NumberMention,
  refs: SourceRequirement[],
  materials: Map<string, MaterialRow>,
): Classified {
  if (mention.refNumbers.length === 0) {
    return { mention, sourced: false, reason: "同じ文に資料番号（【資料N参照】）がありません。", calcMismatch: false };
  }
  let calcMismatch = false;
  for (const n of mention.refNumbers) {
    const ref = refs.find((r) => r.number === n);
    const m = ref ? materials.get(ref.materialId) : undefined;
    if (!m) continue;
    if (m.status === "procedure") continue;
    if (m.statistic) {
      if (matchesAllowed(mention, allowedNumbersOf(n, m))) {
        return { mention, sourced: true, reason: "", calcMismatch: false };
      }
      calcMismatch = true;
      continue;
    }
    if (appearsInQuote(mention, m.quote)) {
      return { mention, sourced: true, reason: "", calcMismatch: false };
    }
  }
  const reason = calcMismatch
    ? "統計資料の値・計算結果と一致しません。"
    : "参照している資料に、この数字が見当たりません（資料が未完成の場合を含む）。";
  return { mention, sourced: false, reason, calcMismatch };
}

/** 文ごとに見て、許されない数字を含む文を落とす（最後の手段） */
function dropSentences(text: string, bad: (s: string) => boolean): string {
  return splitSentences(text).filter((s) => !bad(s)).join("");
}

/** 数字の表記だけを消す。文を落とすと空になってしまう短い文（主張・見出し）用 */
function removeNumberTokens(text: string, location: string): string {
  let out = text;
  for (const m of extractNumbers(text, location)) out = out.replace(m.text, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * 出典に結びつかない数字を含む文を落とす（生成立論用。v6 要件 §1-9）。
 * 段落の再生成（画面の「この部分を再生成」）でも同じ関所を通す。
 */
export function stripUnsourcedNumbers(
  text: string,
  location: string,
  refs: SourceRequirement[],
  materials: Map<string, MaterialRow>,
): { text: string; removed: Classified[] } {
  if (!text) return { text, removed: [] };
  const removed = extractNumbers(text, location)
    .map((m) => classify(m, refs, materials))
    .filter((c) => !c.sourced);
  if (removed.length === 0) return { text, removed };
  const bad = (sentence: string) =>
    extractNumbers(sentence, location).some((m) => !classify(m, refs, materials).sourced);
  const dropped = dropSentences(text, bad);
  return { text: dropped || removeNumberTokens(text, location), removed };
}

export { loadMaterialsFor };

export async function stepNumberCheck(ctx: StepContext) {
  const meter = new UsageMeter();
  const variant = await loadVariant(ctx.variantId);
  const materialsList = await loadMaterialsFor(variant);
  const materials = new Map(materialsList.map((m) => [m.id, m]));
  const refs = variant.sourceRefs;
  const findings: Omit<NumberFinding, "id" | "variantId">[] = [];
  let debateCase: DebateCase = variant.debateCase;
  let changed = false;

  // ── 生成立論: 出典のない数字を除き、統計の数字を差し込む ──
  if (variant.origin === "generated") {
    const sections = [];
    for (const s of debateCase.sections) {
      const subs = [];
      for (const [j, c] of s.subsections.entries()) {
        const location = `（${j + 1}）${c.title}`;
        const text = [c.claim, c.warrant, c.impact].join("\n");
        const mentions = extractNumbers(text, location, c.id);
        const unsourced = mentions
          .map((m) => classify(m, refs, materials))
          .filter((x) => !x.sourced);
        const myRefs = refs.filter((r) => c.sourceRefIds.includes(r.id));
        const allowed = myRefs.flatMap((r) => {
          const m = materials.get(r.materialId);
          return m ? allowedNumbersOf(r.number, m) : [];
        });
        const usesAllowed = mentions.some((m) => matchesAllowed(m, allowed));

        if (unsourced.length === 0 && (allowed.length === 0 || usesAllowed)) {
          subs.push(c);
          continue;
        }

        let next = { claim: c.claim, warrant: c.warrant, impact: c.impact };
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            const r = meter.add(
              await getLlmProvider().generateStructured({
                system: P.SYSTEM_BASE,
                prompt: P.insertNumbersPrompt(
                  JSON.stringify({ title: c.title, claim: c.claim, warrant: c.warrant, impact: c.impact }, null, 2),
                  allowed,
                  unsourced.map((u) => `「${u.mention.text}」— ${u.mention.sentence}`),
                ),
                schema: paragraphTextSchema,
                maxTokens: 6000,
              }),
            );
            const after = extractNumbers([r.claim, r.warrant, r.impact].join("\n"), location, c.id);
            const stillBad = after.filter(
              (m) => !matchesAllowed(m, allowed) && !classify(m, refs, materials).sourced,
            );
            const markersKept =
              (c.claim + c.warrant + c.impact).match(/資料\d+参照/g)?.sort().join() ===
              (r.claim + r.warrant + r.impact).match(/資料\d+参照/g)?.sort().join();
            if (stillBad.length === 0 && markersKept) {
              next = r;
              ok = true;
            }
          } catch (err) {
            console.error("[numbers] 数値の差し込みに失敗しました", err);
          }
        }

        if (!ok && unsourced.length > 0) {
          // 2回直しても出典のない数字が残る場合は、その文を落とす
          const bad = (sentence: string) =>
            extractNumbers(sentence, location).some(
              (m) => !classify(m, refs, materials).sourced,
            );
          next = {
            claim: dropSentences(c.claim, bad) || c.claim.replace(/[0-9０-９][0-9０-９,，.．]*\s*(％|%|割|倍|人|件|円)?/g, ""),
            warrant: dropSentences(c.warrant, bad),
            impact: dropSentences(c.impact, bad),
          };
        }

        for (const u of unsourced) {
          findings.push({
            aspect: "source",
            severity: "high",
            location,
            claimId: c.id,
            value: u.mention.text,
            message: `出典のない数字でした。${u.reason}`,
            resolution: ok
              ? "本文から取り除き、取得した統計の数字だけを使う形に直しました。"
              : "この数字を含む文を本文から取り除きました。",
          });
        }
        if (ok && next !== undefined) changed = true;
        if (!ok && unsourced.length > 0) changed = true;
        subs.push({ ...c, ...next });
      }
      sections.push({ ...s, subsections: subs });
    }
    // Ⅰ主張・Ⅲ結論・見出しにある出典のない数字も残さない
    const frame = (text: string, location: string, claimId?: string) => {
      const r = stripUnsourcedNumbers(text, location, refs, materials);
      for (const u of r.removed) {
        findings.push({
          aspect: "source",
          severity: "high",
          location,
          claimId,
          value: u.mention.text,
          message: `出典のない数字でした。${u.reason}`,
          resolution: "この数字を本文から取り除きました。",
        });
      }
      if (r.text !== text) changed = true;
      return r.text;
    };
    const claim = frame(debateCase.claim, "Ⅰ. 主張");
    const conclusion = frame(debateCase.conclusion, "Ⅲ. 結論");
    const titled = sections.map((sec, i) => ({
      ...sec,
      title: frame(sec.title, `${i + 1}. 見出し`),
      subsections: sec.subsections.map((c, j) => ({
        ...c,
        title: frame(c.title, `（${j + 1}）見出し`, c.id),
      })),
    }));
    if (changed) {
      debateCase = { ...debateCase, claim, conclusion, sections: titled };
      debateCase.fullText = renderFullText(debateCase);
    }
  }

  // ── 出典・計算の検査（登録・生成とも） ──
  for (const mention of extractCaseNumbers(debateCase)) {
    const c = classify(mention, refs, materials);
    if (c.sourced) continue;
    if (variant.origin === "generated") {
      // 生成立論で残ったもの（Ⅰ・Ⅲにある数字など）
      findings.push({
        aspect: c.calcMismatch ? "calculation" : "source",
        severity: "high",
        location: mention.location,
        claimId: mention.claimId,
        value: mention.text,
        message: c.reason,
      });
      continue;
    }
    findings.push({
      aspect: c.calcMismatch ? "calculation" : "source",
      severity: mention.refNumbers.length === 0 ? "high" : "medium",
      location: mention.location,
      claimId: mention.claimId,
      value: mention.text,
      message: `${c.reason}${mention.refNumbers.length === 0 ? "質疑で「その数字の出典は」と聞かれたときに答えられるようにしてください。" : ""}`,
    });
  }

  // ── 資料の側の検査 ──
  for (const ref of refs) {
    const m = materials.get(ref.materialId);
    if (!m) continue;
    const label = `【資料${ref.number}】${m.provesWhat}`;
    if (m.origin === "uploaded" && !m.withinAllowedSources) {
      findings.push({
        aspect: "source",
        severity: "medium",
        location: label,
        value: "",
        message: m.url
          ? "官公庁・統計・国会・法令・判例・論文以外の情報源です。資料の信頼性を突かれやすいので、公的な裏付けを用意しておくと安全です。"
          : "出典のURLが見当たりません。出典（発行元・題名・URL・最終確認日）を示せるようにしてください。",
      });
    }
    for (const chk of m.statistic?.comparability ?? []) {
      if (chk.ok === true) continue;
      findings.push({
        aspect: "comparability",
        severity: chk.ok === false ? "medium" : "low",
        location: label,
        value: "",
        message: `${chk.aspect}: ${chk.note}`,
      });
    }
  }

  // ── 使い方の妥当性（AI） ──
  const mentions = extractCaseNumbers(debateCase);
  if (mentions.length > 0) {
    try {
      const usage = meter.add(
        await getLlmProvider().generateStructured({
          system: P.SYSTEM_BASE,
          prompt: PS.numberUsagePrompt(
            debateCase.fullText,
            mentions.map((m) => ({
              location: m.location,
              text: m.text,
              sentence: m.sentence,
              source: m.refNumbers.length
                ? m.refNumbers
                    .map((n) => {
                      const ref = refs.find((r) => r.number === n);
                      const mat = ref ? materials.get(ref.materialId) : undefined;
                      return `資料${n}${mat?.citation ? `（${mat.citation}）` : ""}`;
                    })
                    .join("・")
                : "なし",
            })),
          ),
          schema: numberUsageSchema,
          maxTokens: 6000,
        }),
      );
      for (const f of usage.findings) {
        const m = mentions[f.index];
        if (!m) continue;
        findings.push({
          aspect: "usage",
          severity: f.severity,
          location: m.location,
          claimId: m.claimId,
          value: m.text,
          message: f.message,
        });
      }
    } catch (err) {
      // 使い方の点検は補助。失敗しても他の検査結果は残す
      console.error("[numbers] 使い方の点検に失敗しました", err);
    }
  }

  await db.delete(numberFindings).where(eq(numberFindings.variantId, variant.id));
  if (findings.length > 0) {
    await db.insert(numberFindings).values(
      findings.map((f) => ({
        id: newId("nf"),
        projectId: variant.projectId,
        variantId: variant.id,
        aspect: f.aspect,
        severity: f.severity,
        location: f.location,
        claimId: f.claimId ?? null,
        value: f.value,
        message: f.message,
        resolution: f.resolution ?? null,
      })),
    );
  }

  if (changed) {
    await db
      .update(caseVariants)
      .set({ debateCase, lengthWarning: adjustLengthWarning(debateCase) ?? null })
      .where(eq(caseVariants.id, variant.id));
    await recordAiRevision(variant.projectId, "case", variant.id, debateCase);
  }
  return meter.total;
}
