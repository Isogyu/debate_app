/**
 * 生成ステップ: 質疑と回答・最終弁論の雛形・特徴と戦い方（v6 要件 §4〜§7）
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseStrategies,
  closingTemplates,
  crossExamNodes,
  numberFindings,
} from "@/db/schema";
import { assertNoCycle } from "@/domain/invariants";
import { coverageGaps, questionKey } from "@/domain/cross-exam";
import {
  ATTACK_POINTS,
  SIDE_LABELS,
  type AttackPoint,
  type CrossExamNode,
} from "@/domain/types";
import { closingPerspectiveSchema, crossExamChainsSchema, strategySchema } from "@/domain/schemas";
import { LlmTruncatedError } from "@/lib/llm/provider";
import { guardText, hasDisallowedNumber } from "@/domain/number-guard";
import type { z } from "zod";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { SYSTEM_BASE } from "@/lib/llm/prompts";
import * as PQ from "@/lib/llm/prompts-questions";
import { newId } from "@/lib/ids";
import {
  allowedNumbersFor,
  categoryIdsByName,
  loadCategories,
  loadMaterialsFor,
  loadProject,
  loadVariant,
  paragraphsOf,
  UsageMeter,
  type StepContext,
  type VariantRow,
} from "./common";

type ChainsOutput = z.infer<typeof crossExamChainsSchema>;
type Paragraph = ReturnType<typeof paragraphsOf>[number];

/** 1段落あたりに作る量。段落5〜6個で合計30問前後になる（1回の出力を小さくして途中切れを防ぐ） */
const PER_PARAGRAPH = "質問（連鎖の中の追及も含めて数える）の合計で5〜7個。うち連鎖を1〜2本含める";

async function loadNodes(variantId: string) {
  return db.select().from(crossExamNodes).where(eq(crossExamNodes.targetVariantId, variantId));
}

/** LLMの出力（キーで繋がった連鎖）を保存用のノードに直す */
async function saveChains(
  variant: VariantRow,
  paragraph: Paragraph,
  output: ChainsOutput,
  origin: "generated" | "practice",
): Promise<number> {
  const rows: (CrossExamNode & { createdAt?: string })[] = [];
  const allowed = await allowedNumbersFor(variant);
  const g = (t: string) => guardText(t, allowed).text;
  for (const chain of output.chains) {
    // 出典のない数字を含む文は落とす（v6 要件 §1-9）。質問が丸ごと落ちてしまう
    // （質問が1文で、その文に数字がある）場合だけ、その連鎖を使わない
    if (chain.nodes.some((n) => !g(n.question).trim())) {
      console.warn("[questions] 出典のない数字を含む質問を除きました:", chain.nodes[0]?.question);
      continue;
    }
    const chainId = newId("chn");
    const idByKey = new Map(chain.nodes.map((n) => [n.key, newId("cx")]));
    // 追及は連鎖の中で「後ろのノード」へだけ進める。前に戻る指定は循環のもとなので切る
    const indexByKey = new Map(chain.nodes.map((n, i) => [n.key, i]));
    const categoryIds = await categoryIdsByName(variant.projectId, chain.categoryNames);
    chain.nodes.forEach((n, i) => {
      rows.push({
        id: idByKey.get(n.key)!,
        projectId: variant.projectId,
        targetVariantId: variant.id,
        chainId,
        chainOrder: i,
        targetClaimId: paragraph.claimId,
        targetParagraph: paragraph.label,
        attackPoint: chain.attackPoint,
        question: g(n.question),
        purpose: g(n.purpose),
        modelAnswer: g(n.modelAnswer),
        goal: i === 0 && chain.goal ? g(chain.goal) : undefined,
        priority: chain.priority,
        origin,
        stuckCount: 0,
        categoryIds,
        branches: n.branches.map((b) => ({
          kind: b.kind,
          expectedAnswer: g(b.expectedAnswer),
          // 同じ連鎖の中だけを指させる。自分自身を指すものも切る
          followUpNodeId:
            b.followUpKey && (indexByKey.get(b.followUpKey) ?? -1) > i
              ? idByKey.get(b.followUpKey)
              : undefined,
          exposedWeakness: b.exposedWeakness ? g(b.exposedWeakness) : undefined,
        })),
      });
    });
  }
  if (rows.length === 0) return 0;
  // 循環したまま保存すると分岐図の描画が止まらない（不変条件3）
  assertNoCycle(rows);
  await db.insert(crossExamNodes).values(
    rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      targetVariantId: r.targetVariantId,
      chainId: r.chainId,
      chainOrder: r.chainOrder,
      targetClaimId: r.targetClaimId ?? null,
      targetParagraph: r.targetParagraph,
      attackPoint: r.attackPoint,
      question: r.question,
      purpose: r.purpose,
      modelAnswer: r.modelAnswer,
      goal: r.goal ?? null,
      priority: r.priority,
      origin: r.origin,
      stuckCount: 0,
      categoryIds: r.categoryIds,
      branches: r.branches,
    })),
  );
  return rows.length;
}

async function numberIssuesByClaim(variantId: string): Promise<Map<string, string[]>> {
  const rows = await db.select().from(numberFindings).where(eq(numberFindings.variantId, variantId));
  const map = new Map<string, string[]>();
  for (const f of rows) {
    // 自動で直したもの（生成立論から除いた数字）は、もう本文にない
    if (!f.claimId || f.resolution) continue;
    const list = map.get(f.claimId) ?? [];
    list.push(`${f.value ? `「${f.value}」` : ""}${f.message}`);
    map.set(f.claimId, list);
  }
  return map;
}

async function generateForParagraph(
  variant: VariantRow,
  resolution: string,
  paragraph: Paragraph,
  attackPoints: AttackPoint[],
  numberIssues: string[],
  categories: string[],
  existingQuestions: string[],
  count: string,
  meter: UsageMeter,
): Promise<ChainsOutput> {
  const ask = (points: AttackPoint[], howMany: string) =>
    getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PQ.crossExamParagraphPrompt({
        resolution,
        caseText: variant.debateCase.fullText,
        paragraphLabel: paragraph.label,
        paragraphText: paragraph.text,
        attackPoints: points,
        numberIssues,
        categories,
        existingQuestions,
        count: howMany,
      }),
      schema: crossExamChainsSchema,
      maxTokens: 16000,
    });

  try {
    return meter.add(await ask(attackPoints, count));
  } catch (err) {
    // 出力が長すぎて切れたら、攻撃点ごとに小さく分けて頼み直す（全部を失わないように）
    if (!(err instanceof LlmTruncatedError) || attackPoints.length <= 1) throw err;
    console.warn(`[questions] ${paragraph.label} の出力が長すぎたため、攻撃点ごとに分けて作り直します`);
    const chains: ChainsOutput["chains"] = [];
    for (const point of attackPoints) {
      try {
        chains.push(...meter.add(await ask([point], "この攻撃点で1〜2問（連鎖は1本まで）")).chains);
      } catch (inner) {
        if (!(inner instanceof LlmTruncatedError)) throw inner;
        console.warn(`[questions] ${paragraph.label}／${point} は作れませんでした（出力が長すぎる）`);
      }
    }
    return { chains };
  }
}

export async function stepCrossExam(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  const categories = (await loadCategories(ctx.projectId)).map((c) => c.name);
  const paragraphs = paragraphsOf(variant);
  const issues = await numberIssuesByClaim(variant.id);

  // 作り直しに備え、生成した質疑だけ消す（練習から足した質疑は残す）
  await db
    .delete(crossExamNodes)
    .where(and(eq(crossExamNodes.targetVariantId, variant.id), eq(crossExamNodes.origin, "generated")));

  const required = (claimId: string): AttackPoint[] =>
    issues.has(claimId) ? ATTACK_POINTS : ATTACK_POINTS.filter((a) => a !== "numbers");

  // 段落ごとに分けて呼ぶ。1回の出力を小さくして途中切れを防ぐ（並列は2まで）
  const queue = [...paragraphs];
  const worker = async () => {
    while (queue.length > 0) {
      const p = queue.shift()!;
      const out = await generateForParagraph(
        variant, project.resolution, p, required(p.claimId), issues.get(p.claimId) ?? [],
        categories, [], PER_PARAGRAPH, meter,
      );
      await saveChains(variant, p, out, "generated");
    }
  };
  // 片方が失敗しても、もう片方が書き終えるのを待つ。先に失敗を返すと、
  // 自動リトライの「作り直し（削除）」と残ったワーカーの書き込みが重なり、質疑が混ざる
  const results = await Promise.allSettled([worker(), worker()]);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;

  // 網羅の検査。段落×攻撃点で抜けたマスを1回だけ埋めに行く
  const nodes = await loadNodes(variant.id);
  const gaps = coverageGaps(
    paragraphs,
    nodes.map((n) => ({ targetClaimId: n.targetClaimId ?? undefined, attackPoint: n.attackPoint })),
    new Set(issues.keys()),
  );
  const byParagraph = new Map<string, AttackPoint[]>();
  for (const g of gaps) byParagraph.set(g.claimId, [...(byParagraph.get(g.claimId) ?? []), g.attackPoint]);
  for (const [claimId, points] of byParagraph) {
    const p = paragraphs.find((x) => x.claimId === claimId)!;
    const out = await generateForParagraph(
      variant, project.resolution, p, points, issues.get(claimId) ?? [], categories,
      nodes.filter((n) => n.targetClaimId === claimId).map((n) => n.question),
      `不足している攻撃点（${points.join("、")}）それぞれに1〜2問`,
      meter,
    );
    await saveChains(variant, p, out, "generated");
  }

  return meter.total;
}

/** 「この箇所をもっと」（§4.1）。既存と同趣旨の質問は除く */
export async function stepMoreQuestions(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  const p = paragraphsOf(variant).find((x) => x.claimId === ctx.params.claimId);
  if (!p) throw new Error("質疑を追加する段落が見つかりませんでした。");
  const categories = (await loadCategories(ctx.projectId)).map((c) => c.name);
  const issues = await numberIssuesByClaim(variant.id);
  const existing = await loadNodes(variant.id);

  const out = await generateForParagraph(
    variant, project.resolution, p,
    issues.has(p.claimId) ? ATTACK_POINTS : ATTACK_POINTS.filter((a) => a !== "numbers"),
    issues.get(p.claimId) ?? [], categories,
    existing.map((n) => n.question),
    "新しい切り口の質問を合計6〜8個（連鎖を2本以上含める）",
    meter,
  );
  // 同趣旨の一次判定（文言がほぼ同じもの）はコードでも弾く
  const known = new Set(existing.map((n) => questionKey(n.question)));
  out.chains = out.chains.filter((c) => !known.has(questionKey(c.nodes[0]?.question ?? "")));
  const saved = await saveChains(variant, p, out, "generated");
  if (saved === 0) {
    // 何も増えなかったことを知らせる（黙って終わると、押しても何も起きないように見える）
    throw new Error(
      "新しい質問が見つかりませんでした（既にある質問と同じ趣旨のものを除いた結果、0問でした）。別の段落で試してください。",
    );
  }
  return meter.total;
}

/** 連鎖ごとの要約（最終弁論・戦い方の材料） */
async function chainDigest(variantId: string) {
  const nodes = await loadNodes(variantId);
  const roots = nodes
    .filter((n) => n.chainOrder === 0)
    .sort((a, b) => (a.setOrder ?? 99) - (b.setOrder ?? 99) || b.priority - a.priority);
  return roots.map((r) => ({
    chainId: r.chainId,
    paragraph: r.targetParagraph,
    goal: r.goal ?? r.purpose,
    question: r.question,
    priority: r.priority,
    admit: r.branches.find((b) => b.kind === "admit")?.expectedAnswer ?? "",
    deny: r.branches.find((b) => b.kind === "deny")?.expectedAnswer ?? "",
  }));
}

export async function stepClosing(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  const chains = (await chainDigest(variant.id)).slice(0, 6);
  const findings = await db.select().from(numberFindings).where(eq(numberFindings.variantId, variant.id));

  // 2つの立場の雛形を1回で頼むと長くなり途中で切れたので、1つずつ頼む
  const ask = async (perspective: "own" | "opponent") =>
    meter.add(
      await getLlmProvider().generateStructured({
        system: SYSTEM_BASE,
        prompt: PQ.closingPrompt({
          resolution: project.resolution,
          sideLabel: SIDE_LABELS[variant.side],
          opponentSideLabel: SIDE_LABELS[variant.side === "affirmative" ? "negative" : "affirmative"],
          caseText: variant.debateCase.fullText,
          chains,
          weaknesses: findings.filter((f) => !f.resolution).slice(0, 6).map((f) => `${f.location}: ${f.message}`),
          perspective,
        }),
        schema: closingPerspectiveSchema,
        maxTokens: 8000,
      }),
    );
  const data = { own: await ask("own"), opponent: await ask("opponent") };

  const valid = new Set(chains.map((c) => c.chainId));
  const allowed = await allowedNumbersFor(variant);
  const g = (t: string) => guardText(t, allowed).text;
  const clean = (p: typeof data.own) => ({
    ...p,
    frame: g(p.frame),
    examples: p.examples.map((e) => ({
      ...e,
      text: g(e.text),
      chainId: e.chainId && valid.has(e.chainId) ? e.chainId : undefined,
    })),
  });

  await db.delete(closingTemplates).where(eq(closingTemplates.variantId, variant.id));
  await db.insert(closingTemplates).values({
    variantId: variant.id,
    projectId: variant.projectId,
    own: clean(data.own),
    opponent: clean(data.opponent),
  });
  return meter.total;
}

export async function stepStrategy(ctx: StepContext) {
  const meter = new UsageMeter();
  const project = await loadProject(ctx.projectId);
  const variant = await loadVariant(ctx.variantId);
  const findings = await db.select().from(numberFindings).where(eq(numberFindings.variantId, variant.id));
  const materials = await loadMaterialsFor(variant);
  const chains = (await chainDigest(variant.id)).sort((a, b) => b.priority - a.priority).slice(0, 8);

  const materialNotes = [
    ...materials
      .filter((m) => m.status === "procedure")
      .map((m) => `「${m.provesWhat}」の資料はまだ完成していません（作成手順のみ）`),
    ...materials
      .filter((m) => m.origin === "uploaded" && !m.withinAllowedSources)
      .map((m) => `「${m.provesWhat}」は公的な情報源以外の資料です（信頼性を突かれやすい）`),
  ];

  const data = meter.add(
    await getLlmProvider().generateStructured({
      system: SYSTEM_BASE,
      prompt: PQ.strategyPrompt({
        resolution: project.resolution,
        sideLabel: SIDE_LABELS[variant.side],
        caseText: variant.debateCase.fullText,
        numberFindings: findings.filter((f) => !f.resolution).map((f) => `${f.location}: ${f.message}`),
        topChains: chains,
        materialNotes,
      }),
      schema: strategySchema,
      maxTokens: 8000,
    }),
  );

  const allowed = await allowedNumbersFor(variant);
  const g = (t: string) => guardText(t, allowed).text;
  const keep = (t: string) => !hasDisallowedNumber(t, allowed);
  const guarded = {
    ...data,
    summary: g(data.summary),
    strengths: data.strengths.filter(keep),
    weaknesses: data.weaknesses.map((w) => ({ point: g(w.point), why: g(w.why) })).filter((w) => w.point),
    defend: data.defend.filter(keep),
    neverConcede: data.neverConcede.filter(keep),
    winningPath: g(data.winningPath),
    howToAttack: data.howToAttack.filter(keep),
  };

  await db.delete(caseStrategies).where(eq(caseStrategies.variantId, variant.id));
  await db.insert(caseStrategies).values({
    variantId: variant.id,
    projectId: variant.projectId,
    data: guarded,
  });
  return meter.total;
}
