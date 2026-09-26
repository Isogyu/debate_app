"use client";

/**
 * フォームを送信しても入力を消さない。
 *
 * React 19 は `<form action={...}>` で送信すると、終わったあとにフォームを初期値へ戻す。
 * エラーで送り直すとき、入力した内容（登録フォームでは選んだ側まで）が消えてしまい、
 * 気付かずに反対の側で登録する事故が起きた。
 * ここでは送信を自分で受け、`startTransition` の中で action を呼ぶ（初期化されない）。
 *
 * 使い方:
 *   <form onSubmit={keepInputs((fd, intent) => (intent === "generate" ? genAction : saveAction)(fd))}>
 *   押したボタンの `name="intent" value="..."` が intent に入る
 */

import { startTransition, type FormEvent } from "react";

export function keepInputs(
  dispatch: (formData: FormData, intent: string | undefined) => void,
) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | HTMLInputElement
      | null;
    const formData = new FormData(e.currentTarget, submitter ?? undefined);
    const intent = submitter?.name === "intent" ? submitter.value : undefined;
    startTransition(() => dispatch(formData, intent));
  };
}
