"use client";

/**
 * 生成進捗（DESIGN.md §3 進捗モーダル / §4 ダッシュボード）
 *
 * ジョブはサーバー側で動いているので、画面はポーリングするだけ。
 * 閉じて開き直しても続きが見える、が要件（§6.3）。
 */

import { useEffect, useState } from "react";

interface StepView {
  step: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  error?: string;
}

interface JobView {
  status: string;
  progress: { done: number; failed: number; total: number };
  steps: StepView[];
}

const MARK: Record<StepView["status"], string> = {
  done: "✓",
  running: "⏳",
  failed: "✗",
  pending: "○",
};

export function GenerationProgress({
  jobId,
  initial,
}: {
  jobId: string;
  initial: JobView;
}) {
  const [job, setJob] = useState(initial);

  useEffect(() => {
    // 完了していれば叩きに行かない
    if (job.status === "done" || job.status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) setJob(await res.json());
      } catch {
        // 一時的な通信失敗は次の周期で回復する。画面を壊さない
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [jobId, job.status]);

  const { done, failed, total } = job.progress;
  const running = job.status === "running";

  return (
    <section className="rounded border border-[var(--line)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">
          {running ? "生成しています…" : "生成状況"}
        </h2>
        <span className="text-sm text-[var(--muted)]">
          {done}/{total}
          {failed > 0 && `（${failed}件が失敗）`}
        </span>
      </div>

      <ul className="space-y-1 text-sm">
        {job.steps.map((s) => (
          <li key={s.step} className={s.status === "failed" ? "text-[var(--neg)]" : ""}>
            <span className="mr-2">{MARK[s.status]}</span>
            {s.label}
            {s.error && (
              <span className="ml-2 text-[var(--neg)]">— {s.error}</span>
            )}
          </li>
        ))}
      </ul>

      {running && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          ※数分かかります。この画面を閉じても生成は続きます。
        </p>
      )}
    </section>
  );
}
