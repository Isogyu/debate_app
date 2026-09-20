"use client";

import { useActionState } from "react";
import { retryAnalysis, type FormState } from "../../actions";

/** 分析の失敗はよくあること。隠さず、その場でやり直せるようにする */
export function RetryAnalysis({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    retryAnalysis,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && <p className="mb-2 text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--accent)] px-5 py-3 font-bold text-white disabled:opacity-60"
      >
        {pending ? "分析しています…" : "もう一度分析する"}
      </button>
    </form>
  );
}
