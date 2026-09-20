/**
 * 生成の起動（REQUIREMENTS.md §4 生成ジョブの実行方式）
 *
 * 生成は数分かかるため、ここではジョブを作って即座に返す。
 * 実際の生成はバックグラウンドで進み、クライアントは /api/jobs/:id をポーリングする。
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { createJob, runJob } from "@/lib/jobs/runner";
import { newId } from "@/lib/ids";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = body.userId ?? "unknown";

  const jobId = await createJob(projectId, userId);

  await db.insert(activityLogs).values({
    id: newId("log"),
    projectId,
    userId,
    action: "generate",
    target: jobId,
  });

  // await しない。リクエストを待たせずにバックグラウンドで進める
  void runJob(jobId).catch((err) => {
    console.error("[generate] ジョブが異常終了しました", jobId, err);
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
