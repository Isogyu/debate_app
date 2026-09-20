/**
 * 生成の起動（REQUIREMENTS.md §4 生成ジョブの実行方式）
 *
 * 生成は数分かかるため、ここではジョブを作って即座に返す。
 * 実際の生成はバックグラウンドで進み、クライアントは /api/jobs/:id をポーリングする。
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { createJob, latestJob, runJob } from "@/lib/jobs/runner";
import { newId } from "@/lib/ids";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = body.userId ?? "unknown";

  // 未完了のジョブがあれば、それを再開する。
  // 毎回新しいジョブを作ると、二度押しで立論が二重に生成されてしまう
  const existing = await latestJob(projectId);

  // 実行中なら何もしない。二度押しで同じジョブを並行に走らせると結果が壊れる
  if (existing?.status === "running") {
    return NextResponse.json(
      { jobId: existing.id, message: "すでに生成中です。" },
      { status: 202 },
    );
  }

  const resumable =
    existing &&
    existing.status !== "done" &&
    existing.steps.some((s) => s.status !== "done");

  const jobId = resumable ? existing.id : await createJob(projectId, userId);

  await db.insert(activityLogs).values({
    id: newId("log"),
    projectId,
    userId,
    action: "generate",
    target: jobId,
    detail: resumable ? "未完了のステップを再開" : "生成を開始",
  });

  // await しない。リクエストを待たせずにバックグラウンドで進める
  void runJob(jobId).catch((err) => {
    console.error("[generate] ジョブが異常終了しました", jobId, err);
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
