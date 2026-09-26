"use client";

/**
 * 生成の進み具合。ジョブはサーバーで動いているので、画面は数秒おきに見に行くだけ。
 * 閉じて開き直しても続きが見える（v6 要件 §1 #6）。終わったら画面を読み込み直す。
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { retryJob, type ActionState } from "@/app/projects/[projectId]/cases/actions";

interface StepView {
  step: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  error?: string;
}

export interface JobView {
  id: string;
  status: string;
  progress: { done: number; failed: number; total: number };
  steps: StepView[];
}

const MARK: Record<StepView["status"], string> = {
  done: "✓",
  running: "…",
  failed: "✗",
  pending: "○",
};

export function JobStatus({ initial, compact = false }: { initial: JobView; compact?: boolean }) {
  const [job, setJob] = useState(initial);
  const router = useRouter();
  const [retryState, retryAction, retrying] = useActionState<ActionState, FormData>(retryJob, {});

  // 画面が更新されてサーバーから新しい状態が届いたら、それに合わせる
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setJob(initial);
  }

  // やり直しを押したら、また見に行き始める。2回目以降のやり直しでも同じ
  const [seenRetry, setSeenRetry] = useState<ActionState | null>(null);
  if (retryState.ok && retryState !== seenRetry) {
    setSeenRetry(retryState);
    setJob({ ...job, status: "running" });
  }

  const active = job.status === "running" || job.status === "queued";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const next: JobView = await res.json();
        setJob(next);
        // 終わったら、できあがった成果物を表示し直す
        if (next.status !== "running" && next.status !== "queued") router.refresh();
      } catch {
        // 一時的な通信失敗は次の周期で回復する
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [job.id, active, router]);

  const { done, failed, total } = job.progress;
  const current = job.steps.find((s) => s.status === "running");

  if (compact) {
    return (
      <span className={`text-xs ${failed > 0 ? "text-[var(--neg)]" : "text-[var(--muted)]"}`}>
        {active ? `生成中 ${done}/${total}${current ? `（${current.label}）` : ""}` : failed > 0 ? `一部失敗（${failed}件）` : ""}
      </span>
    );
  }

  return (
    <section className="rounded border border-[var(--line)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">{active ? "生成しています…" : "生成の状況"}</h2>
        <span className="text-sm text-[var(--muted)]">
          {done}/{total}
          {failed > 0 && `（${failed}件が失敗）`}
        </span>
      </div>
      <ul className="space-y-1 text-sm">
        {job.steps.map((s) => (
          <li key={s.step} className={s.status === "failed" ? "text-[var(--neg)]" : ""}>
            <span className="mr-2 inline-block w-4 text-center">{MARK[s.status]}</span>
            {s.label}
            {s.error && <span className="ml-2">— {s.error}</span>}
          </li>
        ))}
      </ul>
      {active && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          ※資料の取得まで含めて、数分〜十数分かかります。この画面を閉じても生成は続きます。
        </p>
      )}
      {!active && failed > 0 && (
        <form action={retryAction} className="mt-3">
          <input type="hidden" name="jobId" value={job.id} />
          <button
            type="submit"
            disabled={retrying}
            className="min-h-11 rounded border-2 border-[var(--accent)] px-4 text-sm font-bold text-[var(--accent)] disabled:opacity-50"
          >
            {retrying ? "やり直しています…" : "失敗したところからやり直す"}
          </button>
          {retryState.message && <p className="mt-2 text-sm">{retryState.message}</p>}
          {retryState.error && <p className="mt-2 text-sm text-[var(--neg)]">{retryState.error}</p>}
        </form>
      )}
    </section>
  );
}
