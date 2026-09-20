"use client";

/**
 * 論題入力ウィザード（DESIGN.md §2 WIZ）
 *
 * 非情報系のゼミ生が最初に触る画面。専門用語には注釈を付け、
 * 入力例をプレースホルダーに置いて「何を書けばいいか」で詰まらせない。
 */

import { useActionState } from "react";
import Link from "next/link";
import { createProject, type FormState } from "../actions";
import { Term } from "@/components/chrome";

const SIDES = [
  {
    value: "affirmative",
    label: "肯定側",
    description: "論題のとおり実施すべきだと主張する側",
  },
  {
    value: "negative",
    label: "否定側",
    description: "実施すべきでないと主張する側",
  },
] as const;

export function WizardForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createProject,
    {},
  );

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <p
          role="alert"
          className="rounded border-2 border-[var(--neg)] bg-[var(--neg)]/5 p-3 text-sm"
        >
          {state.error}
        </p>
      )}

      <section>
        <label htmlFor="resolution" className="mb-1 block font-bold">
          論題を入力してください
        </label>
        <textarea
          id="resolution"
          name="resolution"
          rows={3}
          required
          disabled={pending}
          placeholder="例: 日本は所得税法第56条および第57条を廃止すべきである"
          className="w-full rounded border border-[var(--line)] p-3"
        />
        <p className="mt-1 text-sm text-[var(--muted)]">
          ※「〜すべきである」の形で書くと分析しやすくなります。
        </p>
      </section>

      <section>
        <p className="mb-2 font-bold">
          あなたの立場は？{" "}
          <Term note="ディベートでは論題に賛成する側を肯定側、反対する側を否定側と呼びます。どちらの立場でも、両side の立論を生成します。">
            立場とは
          </Term>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SIDES.map((s, i) => (
            <label
              key={s.value}
              className="flex cursor-pointer gap-3 rounded border-2 border-[var(--line)] p-4 has-checked:border-[var(--accent)]"
            >
              <input
                type="radio"
                name="side"
                value={s.value}
                defaultChecked={i === 0}
                disabled={pending}
                className="mt-1"
              />
              <span>
                <span className="block font-bold">{s.label}</span>
                <span className="block text-sm text-[var(--muted)]">
                  {s.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="font-bold">チーム名・メンバー（任意）</p>
        <p className="text-sm text-[var(--muted)]">
          Word出力の表紙に使います。あとから変更できます。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm">チーム名</span>
            <input
              name="teamName"
              disabled={pending}
              placeholder="例: ○○大学"
              className="w-full rounded border border-[var(--line)] p-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">メンバー（空白区切り）</span>
            <input
              name="members"
              disabled={pending}
              placeholder="例: メンバーA　メンバーB"
              className="w-full rounded border border-[var(--line)] p-2"
            />
          </label>
        </div>
      </section>

      <section className="rounded border border-[var(--line)] p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="isCompetitionTopic"
            disabled={pending}
            className="mt-1"
          />
          <span>
            これは<b>本番の大会で使う論題</b>です
            <span className="block text-xs text-[var(--muted)]">
              チェックを入れると、この立論は練習用の教材として公開できなくなります。
              大会前の立論は競技上の秘匿情報のためです。練習用の論題ならチェック不要です。
            </span>
          </span>
        </label>
      </section>

      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          ← やめる
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--accent)] px-6 py-3 font-bold text-white disabled:opacity-60"
        >
          {pending ? "分析しています…" : "論題を分析する →"}
        </button>
      </div>
      {pending && (
        <p className="text-right text-sm text-[var(--muted)]">
          AIが関連法令と争点を読み取っています。30秒ほどかかります。
        </p>
      )}
    </form>
  );
}
