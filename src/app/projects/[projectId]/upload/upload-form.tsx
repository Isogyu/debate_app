"use client";

import { useActionState, useState } from "react";
import { uploadCase, uploadMaterials, type ActionState } from "../cases/actions";
import { keepInputs } from "@/components/keep-inputs";

const ACCEPT =
  ".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function UploadForm({
  projectId,
  defaultSide,
  defaultCategory,
  defaultVariantId,
  cases,
}: {
  projectId: string;
  defaultSide: "affirmative" | "negative";
  defaultCategory: "case" | "materials";
  defaultVariantId?: string;
  cases: { id: string; label: string; refCount: number }[];
}) {
  const [category, setCategory] = useState(defaultCategory);
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 font-bold">登録するもの</legend>
        <div className="flex gap-3">
          {(
            [
              ["case", "立論"],
              ["materials", "資料"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded border border-[var(--line)] px-4">
              <input
                type="radio"
                name="category"
                value={value}
                checked={category === value}
                onChange={() => setCategory(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {category === "case" ? (
        <CaseUploadForm projectId={projectId} defaultSide={defaultSide} />
      ) : (
        <MaterialsUploadForm projectId={projectId} cases={cases} defaultVariantId={defaultVariantId} />
      )}
    </div>
  );
}

function MaterialsUploadForm({
  projectId,
  cases,
  defaultVariantId,
}: {
  projectId: string;
  cases: { id: string; label: string; refCount: number }[];
  defaultVariantId?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadMaterials, {});
  if (cases.length === 0) {
    return (
      <p className="rounded border border-[var(--line)] p-4 text-sm">
        資料を付けられる立論がまだありません。先に立論を登録するか、生成してください。
      </p>
    );
  }
  return (
    <form onSubmit={keepInputs((fd) => action(fd))} className="space-y-6">
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="mb-1 block font-bold">どの立論の資料ですか（必須）</span>
        <select
          name="variantId"
          required
          defaultValue={cases.some((c) => c.id === defaultVariantId) ? defaultVariantId : ""}
          className="w-full rounded border border-[var(--line)] p-2"
        >
          <option value="" disabled>
            選んでください
          </option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}（資料{c.refCount}件）
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">資料のファイル（必須）</span>
        <input type="file" name="materialsFile" required accept={ACCEPT} className="block w-full text-sm" />
        <span className="mt-1 block text-sm text-[var(--muted)]">
          Word（.docx）か PDF（テキストファイルも可）。
          【資料N】の見出しがあれば、その番号の資料として登録します（同じ番号の資料があれば置き換えます）。
          見出しがなければ、ファイル全体を1つの資料として、次の番号で追加します。
          立論の本文の【資料N参照】は書き換えないので、新しい番号で追加した場合は、必要に応じて本文に書き足してください。
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-60"
      >
        {pending ? "アップロードしています…" : "資料を登録する"}
      </button>
      <p className="text-sm text-[var(--muted)]">
        登録した資料は「確認済」として扱い、登録後に数字の検査をやり直します（1分ほど）。
      </p>
    </form>
  );
}

function CaseUploadForm({
  projectId,
  defaultSide,
}: {
  projectId: string;
  defaultSide: "affirmative" | "negative";
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadCase, {});
  return (
    // 送信後も選んだ側・呼び名・ファイルを残す。エラーで出し直したときに
    // 側が初期値へ戻り、反対の側で登録してしまう事故を防ぐ
    <form onSubmit={keepInputs((fd) => action(fd))} className="space-y-6">
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}

      <fieldset>
        <legend className="mb-2 font-bold">どちらの立論ですか</legend>
        <div className="flex gap-3">
          {(
            [
              ["affirmative", "賛成側"],
              ["negative", "反対側"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded border border-[var(--line)] px-4">
              <input type="radio" name="side" value={value} defaultChecked={value === defaultSide} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-bold">呼び名（任意）</span>
        <input
          name="label"
          placeholder="例: 3年ゼミ案・担税力重視"
          className="w-full rounded border border-[var(--line)] p-2"
        />
        <span className="mt-1 block text-sm text-[var(--muted)]">空欄ならファイル名を使います。</span>
      </label>

      <label className="block">
        <span className="mb-1 block font-bold">立論のファイル（必須）</span>
        <input
          type="file"
          name="caseFile"
          required
          accept={ACCEPT}
          className="block w-full text-sm"
        />
        <span className="mt-1 block text-sm text-[var(--muted)]">
          Word（.docx）か PDF（テキストファイルも可）。Ⅰ主張／Ⅱ理由／Ⅲ結論 の形の原稿を想定しています。
          スキャン画像だけのPDF（文字を選択できないもの）は取り込めません。
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block font-bold">資料のファイル</span>
        <input
          type="file"
          name="materialsFile"
          accept={ACCEPT}
          className="block w-full text-sm"
        />
        <span className="mt-1 block text-sm text-[var(--muted)]">
          【資料1】【資料2】…の見出し、または「Ⅱ. 資料」の下の「1.」「2.」…の見出しで区切られた参考資料。
          立論の【資料N参照】（（資料N））と番号で対応付けます。
          番号が合わないところは、取り込んだあとに知らせます。
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-60"
      >
        {pending ? "アップロードしています…" : "登録する"}
      </button>
      <p className="text-sm text-[var(--muted)]">
        登録後、取り込み → 数字の検査 → 質疑 → 最終弁論の雛形 → 特徴と戦い方 の順に作ります（数分）。
      </p>
    </form>
  );
}
