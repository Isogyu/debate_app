/**
 * サーバー起動時の処理（Next.js の instrumentation）
 *
 * Fly.io は使われていない間マシンを止める。長い生成の途中で止まったジョブを、
 * 次に起動したときに続きから再開する（v6 要件 §1 #6「閉じても続く」）。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeOnBoot } = await import("@/lib/jobs/orchestrate");
  await resumeOnBoot().catch((err) => {
    console.error("[generate] 途中のジョブの再開に失敗しました", err);
  });
}
