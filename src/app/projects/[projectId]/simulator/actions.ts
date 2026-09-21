"use server";

/**
 * 質疑シミュレーター（U9 / DESIGN §11）
 *
 * 練習回数を増やすことが運用の目的なので、記録を残して後から振り返れるようにする。
 * AIには相手側の立論を持たせ、簡単に折れないようにしている。
 * すぐ負けを認める相手だと練習にならない。
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { apiUsage, caseVariants, practiceSessions, projects } from "@/db/schema";
import type { PracticeMode, PracticeTurn } from "@/domain/types";
import {
  simulatorFeedbackSchema,
  simulatorReplySchema,
} from "@/domain/schemas";
import { getLlmProvider } from "@/lib/llm/anthropic";
import { LlmConfigError, LlmSchemaError } from "@/lib/llm/provider";
import type { LlmUsage } from "@/lib/llm/provider";
import * as P from "@/lib/llm/prompts";
import { newId, nowIso } from "@/lib/ids";
import { log, requireSession } from "@/lib/session";

export interface SimulatorState {
  error?: string;
  sessionId?: string;
  turns?: PracticeTurn[];
}

/** 練習の利用量も記録する。管理画面のコスト表示に含めるため（A6） */
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

async function loadContext(projectId: string, mode: PracticeMode) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("プロジェクトが見つかりませんでした。");

  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.projectId, projectId));

  // AIは常に相手側を演じる
  const aiVariant =
    variants.find((v) => v.role === "opponent_prediction") ??
    variants.find((v) => v.side !== project.mySide);
  const myVariant =
    variants.find((v) => v.id === project.adoptedCaseId) ??
    variants.find((v) => v.side === project.mySide);

  if (!aiVariant) {
    throw new Error(
      "相手側の立論がまだありません。先にダッシュボードから生成してください。",
    );
  }
  if (mode === "defense" && !myVariant) {
    throw new Error("自分の立論がまだありません。先に生成してください。");
  }

  return { project, aiVariant, myVariant };
}

/** 練習を始める。受ける練習ではAIの最初の質問まで作る */
export async function startPractice(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const projectId = String(formData.get("projectId") ?? "");
  const mode = String(formData.get("mode") ?? "attack") as PracticeMode;
  const userId = await requireSession();

  try {
    const { project, aiVariant, myVariant } = await loadContext(projectId, mode);
    const turns: PracticeTurn[] = [];

    if (mode === "defense") {
      // 相手から質問される練習なので、AIから切り出す
      const { data, usage } = await getLlmProvider().generateStructured({
        system: P.simulatorSystem({
          resolution: project.resolution,
          aiSide: aiVariant.side,
          caseText: aiVariant.debateCase.fullText,
          mode,
        }),
        prompt: P.simulatorOpeningPrompt(myVariant!.debateCase.fullText),
        schema: simulatorReplySchema,
        maxTokens: 1000,
      });
      await recordUsage(projectId, usage);
      turns.push({ speaker: "ai", text: data.reply, at: nowIso() });
    }

    const sessionId = newId("prc");
    await db.insert(practiceSessions).values({
      id: sessionId,
      projectId,
      userId,
      mode,
      opponentVariantId: aiVariant.id,
      turns,
    });

    await log(userId, "generate", sessionId, projectId, "質疑練習を開始");
    revalidatePath(`/projects/${projectId}/simulator`);
    // 作って終わりではなく、そのまま質疑を始められるところまで連れて行く
    redirect(`/projects/${projectId}/simulator?session=${sessionId}`);
  } catch (err) {
    // redirect() は例外で制御を移す仕組みなので、握りつぶさず投げ直す
    if (isRedirectError(err)) throw err;
    return { error: toUserMessage(err) };
  }
}

/** Next.js の redirect() が投げる制御用の例外か */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/** 1往復ぶん進める */
export async function sendTurn(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "発言を入力してください。" };

  const [session] = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.id, sessionId));
  if (!session) return { error: "練習の記録が見つかりませんでした。" };
  if (session.finishedAt) {
    return { error: "この練習は終了しています。新しく始めてください。" };
  }

  const userTurn: PracticeTurn = { speaker: "user", text, at: nowIso() };

  try {
    const { project, aiVariant } = await loadContext(
      session.projectId,
      session.mode,
    );

    const { data, usage } = await getLlmProvider().generateStructured({
      system: P.simulatorSystem({
        resolution: project.resolution,
        aiSide: aiVariant.side,
        caseText: aiVariant.debateCase.fullText,
        mode: session.mode,
      }),
      prompt: P.simulatorReplyPrompt(session.turns, text),
      schema: simulatorReplySchema,
      maxTokens: 1000,
    });
    await recordUsage(session.projectId, usage);

    const turns = [
      ...session.turns,
      userTurn,
      { speaker: "ai" as const, text: data.reply, at: nowIso() },
    ];
    await db
      .update(practiceSessions)
      .set({ turns })
      .where(eq(practiceSessions.id, sessionId));

    return { sessionId, turns };
  } catch (err) {
    // 失敗しても自分の発言は残す。入力し直しをさせない
    const turns = [...session.turns, userTurn];
    await db
      .update(practiceSessions)
      .set({ turns })
      .where(eq(practiceSessions.id, sessionId));
    return { error: toUserMessage(err), sessionId, turns };
  }
}

/** 終了してフィードバックをもらう */
export async function finishPractice(
  _prev: SimulatorState,
  formData: FormData,
): Promise<SimulatorState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const [session] = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.id, sessionId));
  if (!session) return { error: "練習の記録が見つかりませんでした。" };

  if (session.turns.filter((t) => t.speaker === "user").length === 0) {
    return { error: "まだ発言がありません。何度かやり取りしてから終えてください。" };
  }

  try {
    const transcript = session.turns
      .map((t) => `${t.speaker === "user" ? "練習者" : "相手(AI)"}: ${t.text}`)
      .join("\n");

    const { data, usage } = await getLlmProvider().generateStructured({
      system:
        "あなたは日本の大学の政策ディベートの指導者です。出力はJSONのみを返してください。",
      prompt: P.simulatorFeedbackPrompt(session.mode, transcript),
      schema: simulatorFeedbackSchema,
      maxTokens: 3000,
    });
    await recordUsage(session.projectId, usage);

    await db
      .update(practiceSessions)
      .set({ feedback: data, finishedAt: nowIso() })
      .where(eq(practiceSessions.id, sessionId));

    revalidatePath(`/projects/${session.projectId}/simulator`);
    // 講評はサーバー側で描画するので、読み込み直して確実に出す
    redirect(`/projects/${session.projectId}/simulator?session=${sessionId}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: toUserMessage(err), sessionId, turns: session.turns };
  }
}
