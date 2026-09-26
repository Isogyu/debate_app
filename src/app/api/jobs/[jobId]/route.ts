/**
 * 生成の進捗取得。DESIGN §3 の進捗モーダルが数秒おきに叩く。
 * ブラウザを閉じても生成は続くため、開き直せば続きの進捗が見える。
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { generationJobs } from "@/db/schema";
import { GEN_STEP_LABELS } from "@/domain/types";
import { progressOf } from "@/lib/jobs/runner";
import { currentUserId } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // proxy はクッキーの有無しか見ない。署名をここで検証する
  if (!(await currentUserId())) {
    return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  }
  const { jobId } = await params;
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId));

  if (!job) {
    return NextResponse.json(
      { error: "生成の記録が見つかりませんでした。" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: progressOf(job.steps),
    steps: job.steps.map((s) => ({
      step: s.step,
      label: GEN_STEP_LABELS[s.step], // 画面には日本語名だけ出す
      status: s.status,
      error: s.error,
    })),
  });
}
