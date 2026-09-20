"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    {},
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <p
          role="alert"
          className="rounded border-2 border-[var(--neg)] p-3 text-sm"
        >
          {state.error}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block font-bold">合言葉</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          disabled={pending}
          className="w-full rounded border border-[var(--line)] p-3 text-base"
        />
        <span className="mt-1 block text-sm text-[var(--muted)]">
          ゼミで共有している合言葉です。
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block font-bold">お名前</span>
        <input
          name="displayName"
          required
          autoComplete="name"
          disabled={pending}
          className="w-full rounded border border-[var(--line)] p-3 text-base"
        />
        <span className="mt-1 block text-sm text-[var(--muted)]">
          誰が編集したかの記録に使います。本名でなくても構いません。
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white disabled:opacity-60"
      >
        {pending ? "確認しています…" : "はじめる"}
      </button>
    </form>
  );
}
