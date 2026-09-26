"use server";

/**
 * 質疑シミュレーター（v6 要件 F11・§4.3・§4.4）
 *
 * 登録・生成の全立論から「自分が守る立論」と「AIが演じる相手の立論」を選んで練習する。
 * defense（相手から質問される）では、AIは生成済みの質疑（8分セット・連鎖）を優先して使う。
 * 終了時の講評と同じリクエストで、練習結果を質疑データへ反映する（§4.3）。
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  apiUsage,
  caseVariants,
  closingTemplates,
  crossExamNodes,
  practiceSessions,
  projects,
} from "@/db/schema";
import type {
  PracticeFeedback,
  PracticeMode,
  PracticeReflection,
  PracticeTurn,
} from "@/domain/types";
import { simulatorFeedbackSchema, simulatorReplySchema } from "@/domain/schemas";
import { questionKey } from "@/domain/cross-exam";
import {
  buildQuestionKeys,
  keysToIds,
  LONG_TURN_SECONDS,
  longTurnsOf,
  matchParagraph,
  userTurnLengths,
} from "@/domain/practice";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { LlmConfigError, LlmSchemaError, type LlmUsage } from "@/lib/llm/provider";
import * as PP from "@/lib/llm/prompts-practice";
import { allowedNumbersFor, paragraphsOf } from "@/lib/jobs/common";
import { guardText, hasDisallowedNumber } from "@/domain/number-guard";
import { recomputeEightMinuteSet } from "@/lib/jobs/steps-questions";
import { newId, nowIso } from "@/lib/ids";
import { log, requireSession } from "@/lib/session";

export interface SimulatorState {
  error?: string;
  sessionId?: string;
  turns?: PracticeTurn[];
}

/** 対話中にAIへ見せる質疑の上限。多すぎると応答が遅くなり、指示も薄まる */
const MAX_NODES_IN_CHAT = 50;
/** 講評での照合に使う上限。講評は1回きりなので多めに渡す */
const MAX_NODES_IN_FEEDBACK = 80;

/** テキストでは判定しない観点。講評に含めず、画面に明記する（§4.4） */
const NOT_JUDGED = [
  "相手の発言をさえぎったか（要項6）",
  "20秒以上の沈黙（要項12）— 入力に要した時間は発話の沈黙と一致しないため",
  "声の大きさ・聞き取りやすさ（要項9）",
];

async function recordUsage(projectId: string, usage: LlmUsage) {
  await db.insert(apiUsage).values({
    id: newId("use"),
    projectId,
    step: "simulator",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

function toUserMessage(err: unknown): string {
  if (err instanceof LlmConfigError) return err.message;
  if (err instanceof LlmSchemaError) {
    return "AIの応答が読み取れませんでした。もう一度送ってみてください。";
  }
  return err instanceof Error
    ? err.message
    : "通信に失敗しました。電波の状況を確認してください。";
}

type VariantRow = typeof caseVariants.$inferSelect;
type SessionRow = typeof practiceSessions.$inferSelect;

async function loadVariantIn(projectId: string, id: string): Promise<VariantRow | undefined> {
  const [v] = await db
    .select()
    .from(caseVariants)
    .where(and(eq(caseVariants.id, id), eq(caseVariants.projectId, projectId)));
  return v;
}

async function loadContext(projectId: string, userVariantId: string, opponentVariantId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("テーマが見つかりませんでした。");
  const userVariant = await loadVariantIn(projectId, userVariantId);
  const aiVariant = await loadVariantIn(projectId, opponentVariantId);
  if (!userVariant || !aiVariant) {
    throw new Error("選んだ立論が見つかりませんでした。選び直してください。");
  }
  return { project, userVariant, aiVariant };
}

/**
 * 照合に使う質疑。
 * defense … AIが練習者の立論に質問するので、練習者の立論向けの質疑
 * attack  … 練習者が相手の立論に質問するので、相手の立論向けの質疑（練習者の台本になる）
 */
function questionTarget(mode: PracticeMode, userVariantId: string, opponentVariantId: string) {
  return mode === "defense" ? userVariantId : opponentVariantId;
}

async function loadNodes(variantId: string) {
  const rows = await db
    .select()
    .from(crossExamNodes)
    .where(eq(crossExamNodes.targetVariantId, variantId));
  return rows.map((r) => ({
    ...r,
    goal: r.goal ?? undefined,
    setOrder: r.setOrder ?? undefined,
    targetClaimId: r.targetClaimId ?? undefined,
  }));
}

function systemFor(
  ctx: Awaited<ReturnType<typeof loadContext>>,
  mode: PracticeMode,
  chains: ReturnType<typeof buildQuestionKeys>["chains"],
) {
  return PP.simulatorSystem({
    resolution: ctx.project.resolution,
    mode,
    aiCase: { side: ctx.aiVariant.side, text: ctx.aiVariant.debateCase.fullText },
    userCase: { side: ctx.userVariant.side, text: ctx.userVariant.debateCase.fullText },
    chains,
  });
}

/** 練習を始める。相手から質問される練習ではAIの最初の質問まで作る */
export async function startPractice(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const userId = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const mode: PracticeMode = formData.get("mode") === "defense" ? "defense" : "attack";
  const userVariantId = String(formData.get("userVariantId") ?? "");
  const opponentVariantId = String(formData.get("opponentVariantId") ?? "");

  if (!userVariantId || !opponentVariantId) {
    return { error: "自分が守る立論と、AIが演じる相手の立論を選んでください。" };
  }
  if (userVariantId === opponentVariantId) {
    return { error: "同じ立論どうしでは練習になりません。相手の立論を別のものにしてください。" };
  }

  let sessionId: string;
  try {
    const ctx = await loadContext(projectId, userVariantId, opponentVariantId);
    // 過去テーマは閲覧のみ。練習は AI の費用もかかるので、現テーマでだけ始められる（§2 F1）
    if (ctx.project.status !== "active") {
      return { error: "過去テーマでは練習を始められません。現テーマの立論で練習してください。" };
    }
    // 本文の構造がない立論（取り込み途中など）はAIが立脚できない
    if (
      ctx.userVariant.debateCase.sections.length === 0 ||
      ctx.aiVariant.debateCase.sections.length === 0
    ) {
      return { error: "本文がまだできていない立論は選べません。取り込みや生成が終わってから始めてください。" };
    }

    const turns: PracticeTurn[] = [];
    if (mode === "defense") {
      const keys = buildQuestionKeys(await loadNodes(userVariantId), MAX_NODES_IN_CHAT);
      const { data, usage } = await getLlmProvider().generateStructured({
        system: systemFor(ctx, mode, keys.chains),
        prompt: PP.simulatorOpeningPrompt(),
        schema: simulatorReplySchema,
        maxTokens: 1000,
      });
      await recordUsage(projectId, usage);
      const nodeId = data.usedKey ? keysToIds([data.usedKey], keys.nodeIdByKey)[0] : undefined;
      turns.push({ speaker: "ai", text: data.reply, at: nowIso(), ...(nodeId ? { nodeId } : {}) });
    }

    sessionId = newId("prc");
    await db.insert(practiceSessions).values({
      id: sessionId,
      projectId,
      userId,
      mode,
      userVariantId,
      opponentVariantId,
      turns,
    });
    await log(userId, "generate", sessionId, projectId, "質疑練習を開始");
  } catch (err) {
    return { error: toUserMessage(err) };
  }

  revalidatePath(`/projects/${projectId}/simulator`);
  // 作って終わりではなく、そのまま質疑を始められるところまで連れて行く
  redirect(`/projects/${projectId}/simulator?session=${sessionId}`);
}

async function loadOwnSession(sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.id, sessionId));
  if (!session) return { error: "練習の記録が見つかりませんでした。" };
  // 他の人の練習に書き込むと、その人の記録と講評が崩れる
  if (session.userId !== userId) return { error: "他の人の練習には書き込めません。" };
  return { session };
}

/** 1往復ぶん進める */
export async function sendTurn(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const userId = await requireSession();
  const sessionId = String(formData.get("sessionId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "発言を入力してください。" };

  const loaded = await loadOwnSession(sessionId, userId);
  if (!loaded.session) return { error: loaded.error };
  const session = loaded.session;
  if (session.finishedAt) {
    return { error: "この練習は終了しています。新しく始めてください。" };
  }

  const userTurn: PracticeTurn = { speaker: "user", text, at: nowIso() };

  try {
    const ctx = await loadContext(session.projectId, session.userVariantId, session.opponentVariantId);
    const target = questionTarget(session.mode, session.userVariantId, session.opponentVariantId);
    const keys = buildQuestionKeys(await loadNodes(target), MAX_NODES_IN_CHAT);

    const { data, usage } = await getLlmProvider().generateStructured({
      system: systemFor(ctx, session.mode, keys.chains),
      prompt: PP.simulatorReplyPrompt(
        session.mode,
        session.turns.map((t) => ({
          speaker: t.speaker,
          text: t.text,
          key: t.nodeId ? keys.keyByNodeId.get(t.nodeId) : undefined,
        })),
        text,
      ),
      schema: simulatorReplySchema,
      maxTokens: 1000,
    });
    await recordUsage(session.projectId, usage);

    // attack ではAIは答える側なので、質問を「使った」ことにはしない
    const nodeId =
      session.mode === "defense" && data.usedKey
        ? keysToIds([data.usedKey], keys.nodeIdByKey)[0]
        : undefined;
    const turns: PracticeTurn[] = [
      ...session.turns,
      userTurn,
      { speaker: "ai", text: data.reply, at: nowIso(), ...(nodeId ? { nodeId } : {}) },
    ];
    await db.update(practiceSessions).set({ turns }).where(eq(practiceSessions.id, sessionId));
    return { sessionId, turns };
  } catch (err) {
    // 失敗しても自分の発言は残す。入力し直しをさせない
    const turns = [...session.turns, userTurn];
    await db.update(practiceSessions).set({ turns }).where(eq(practiceSessions.id, sessionId));
    return { error: toUserMessage(err), sessionId, turns };
  }
}

/** 最終弁論の雛形の枠。練習者の立場で使うものを選ぶ */
async function closingFrameFor(session: SessionRow): Promise<string | undefined> {
  const [own] = await db
    .select()
    .from(closingTemplates)
    .where(eq(closingTemplates.variantId, session.userVariantId));
  if (session.mode === "attack") {
    // 相手の立論を攻めた練習なので「この立論と戦うチーム用」の枠が一番合う
    const [opp] = await db
      .select()
      .from(closingTemplates)
      .where(eq(closingTemplates.variantId, session.opponentVariantId));
    return opp?.opponent.frame || own?.own.frame || undefined;
  }
  return own?.own.frame || undefined;
}

/**
 * 練習結果を質疑データへ反映する（§4.3）。defense のときだけ。
 *  - 詰まった質問: stuckCount を1増やす（8分セットの選び直しで優先される）
 *  - 未登録の質問: 模範回答つきで「練習から追加」として保存（同趣旨は除く）
 */
async function reflect(
  session: SessionRow,
  userVariant: VariantRow,
  stuckNodeIds: string[],
  newQuestions: { question: string; modelAnswer: string; paragraph: string; attackPoint: (typeof crossExamNodes.$inferInsert)["attackPoint"] }[],
): Promise<Pick<PracticeReflection, "stuckNodeIds" | "addedNodeIds">> {
  for (const id of stuckNodeIds) {
    await db
      .update(crossExamNodes)
      .set({ stuckCount: sql`${crossExamNodes.stuckCount} + 1` })
      .where(and(eq(crossExamNodes.id, id), eq(crossExamNodes.targetVariantId, userVariant.id)));
  }

  const existing = await db
    .select({ question: crossExamNodes.question })
    .from(crossExamNodes)
    .where(eq(crossExamNodes.targetVariantId, userVariant.id));
  const seen = new Set(existing.map((e) => questionKey(e.question)));
  // 段落の見出しでも当てられるように、タイトルを添える
  const titles = new Map(
    userVariant.debateCase.sections.flatMap((s) => s.subsections.map((c) => [c.id, c.title] as const)),
  );
  const paragraphs = paragraphsOf(userVariant).map((p) => ({ ...p, title: titles.get(p.claimId) }));

  const addedNodeIds: string[] = [];
  // 練習から足す質問・回答にも、出典のない数字を入れない（§1-9）
  const allowed = await allowedNumbersFor(userVariant);
  for (const q of newQuestions) {
    if (hasDisallowedNumber(q.question, allowed)) continue;
    const k = questionKey(q.question);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const p = matchParagraph(q.paragraph, paragraphs);
    const id = newId("cx");
    await db.insert(crossExamNodes).values({
      id,
      projectId: session.projectId,
      targetVariantId: userVariant.id,
      // 単発の質問も長さ1の連鎖として持つ
      chainId: newId("chn"),
      chainOrder: 0,
      targetClaimId: p?.claimId ?? null,
      targetParagraph: p?.label ?? q.paragraph,
      attackPoint: q.attackPoint,
      question: q.question,
      purpose: "質疑練習で相手（AI）が出した質問",
      modelAnswer: guardText(q.modelAnswer, allowed).text,
      goal: null,
      priority: 3,
      origin: "practice",
      stuckCount: 0,
      categoryIds: [],
      branches: [],
    });
    addedNodeIds.push(id);
  }

  if (stuckNodeIds.length > 0 || addedNodeIds.length > 0) {
    await recomputeEightMinuteSet(userVariant.id);
  }
  return { stuckNodeIds, addedNodeIds };
}

/** 終了して講評をもらう。反映も同じリクエストで行う */
export async function finishPractice(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const userId = await requireSession();
  const sessionId = String(formData.get("sessionId") ?? "");
  const loaded = await loadOwnSession(sessionId, userId);
  if (!loaded.session) return { error: loaded.error };
  const session = loaded.session;
  if (session.finishedAt) redirect(`/projects/${session.projectId}/simulator?session=${sessionId}`);

  if (session.turns.filter((t) => t.speaker === "user").length === 0) {
    return { error: "まだ発言がありません。何度かやり取りしてから終えてください。" };
  }

  // 二重押しで stuckCount が2回増えないように、終了を1文で取る。
  // 講評に失敗したら戻して、もう一度押せるようにする
  const claimed = await db
    .update(practiceSessions)
    .set({ finishedAt: nowIso() })
    .where(and(eq(practiceSessions.id, sessionId), isNull(practiceSessions.finishedAt)))
    .returning({ id: practiceSessions.id });
  if (claimed.length === 0) {
    redirect(`/projects/${session.projectId}/simulator?session=${sessionId}`);
  }

  try {
    const ctx = await loadContext(session.projectId, session.userVariantId, session.opponentVariantId);
    const target = questionTarget(session.mode, session.userVariantId, session.opponentVariantId);
    const allNodes = await loadNodes(target);
    const keys = buildQuestionKeys(allNodes, MAX_NODES_IN_FEEDBACK);
    // AIが使った質問は、上限で落ちていても照合に要るので必ずキーを付ける
    const usedIds = new Set(session.turns.map((t) => t.nodeId).filter(Boolean));
    const keysWithUsed = [...usedIds].every((id) => keys.keyByNodeId.has(id!))
      ? keys
      : buildQuestionKeys(allNodes);

    const lengths = userTurnLengths(session.turns, session.mode);
    const secondsByIndex = new Map(lengths.map((l) => [l.index, l.seconds]));
    const role = session.mode === "attack" ? "question" : "answer";

    const { data, usage } = await getLlmProvider().generateStructured({
      system: PP.SIMULATOR_FEEDBACK_SYSTEM,
      prompt: PP.simulatorFeedbackPrompt({
        resolution: ctx.project.resolution,
        mode: session.mode,
        userCase: { side: ctx.userVariant.side, text: ctx.userVariant.debateCase.fullText },
        aiCase: { side: ctx.aiVariant.side, text: ctx.aiVariant.debateCase.fullText },
        turns: session.turns.map((t, i) => ({
          speaker: t.speaker,
          text: t.text,
          key: t.nodeId ? keysWithUsed.keyByNodeId.get(t.nodeId) : undefined,
          seconds: secondsByIndex.get(i),
        })),
        chains: keysWithUsed.chains,
        longTurnSeconds: LONG_TURN_SECONDS[role],
        existingQuestions: session.mode === "defense" ? allNodes.map((n) => n.question) : [],
        paragraphLabels:
          session.mode === "defense" ? paragraphsOf(ctx.userVariant).map((p) => p.label) : [],
        closingFrame: await closingFrameFor(session),
      }),
      schema: simulatorFeedbackSchema,
      maxTokens: 5000,
    });
    await recordUsage(session.projectId, usage);

    const goalByChain = new Map(keysWithUsed.chains.map((c) => [c.chainId, c.goal]));
    const feedback: PracticeFeedback = {
      strengths: data.strengths,
      weaknesses: data.weaknesses,
      suggestions: data.suggestions,
      summary: data.summary,
      chains: data.chains.flatMap((c) => {
        const chainId = keysWithUsed.chainIdByKey.get(c.key.trim().toLowerCase());
        return chainId
          ? [{ chainId, goal: goalByChain.get(chainId) ?? "", reached: c.reached, note: c.note }]
          : [];
      }),
      longTurns: longTurnsOf(lengths),
      notJudged: NOT_JUDGED,
    };

    const closingAllowed = [
      ...(await allowedNumbersFor(ctx.userVariant)),
      ...(await allowedNumbersFor(ctx.aiVariant)),
    ];
    let reflection: PracticeReflection = {
      stuckNodeIds: [],
      addedNodeIds: [],
      closingExample: data.closingExample
        ? guardText(data.closingExample, closingAllowed).text
        : undefined,
    };
    // 過去テーマは閲覧のみ。練習はできるが、質疑データへの反映はしない（§2 F1）
    if (session.mode === "defense" && ctx.project.status === "active") {
      try {
        const r = await reflect(
          session,
          ctx.userVariant,
          keysToIds(data.stuckKeys, keysWithUsed.nodeIdByKey),
          data.newQuestions,
        );
        reflection = { ...reflection, ...r };
      } catch (err) {
        // 反映に失敗しても講評は残す。講評まで失うと練習がやり直しになる
        console.error("practice reflection failed", err);
      }
    }

    await db
      .update(practiceSessions)
      .set({ feedback, reflection, finishedAt: nowIso() })
      .where(eq(practiceSessions.id, sessionId));
  } catch (err) {
    await db
      .update(practiceSessions)
      .set({ finishedAt: null })
      .where(eq(practiceSessions.id, sessionId));
    return { error: toUserMessage(err), sessionId, turns: session.turns };
  }

  revalidatePath(`/projects/${session.projectId}/simulator`);
  if (session.mode === "defense") {
    revalidatePath(`/projects/${session.projectId}/cases/${session.userVariantId}`);
  }
  // 講評はサーバー側で描画するので、読み込み直して確実に出す
  redirect(`/projects/${session.projectId}/simulator?session=${sessionId}`);
}
