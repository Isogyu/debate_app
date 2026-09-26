"use client";

/**
 * 自作の立論・資料の登録（v6 要件 F2）。
 * 入れるのはファイルだけ。賛成側・反対側は原稿から判定し、呼び名はファイル名を使う。
 *  - 立論を選べば立論として登録（資料も選べば一緒に取り込む）
 *  - 資料だけを選べば、どの立論に付けるかを選んでもらう
 */

import { useActionState, useState } from "react";
import { uploadFiles, type ActionState } from "../cases/actions";
import { keepInputs } from "@/components/keep-inputs";

const ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** ファイル選択ボタンを目立たせる（標準の小さいボタンは見落とされた） */
const FILE_INPUT =
  "block w-full cursor-pointer text-sm text-[var(--muted)] file:mr-4 file:min-h-12 file:cursor-pointer file:rounded file:border-0 file:bg-[var(--accent)] file:px-6 file:text-base file:font-bold file:text-white hover:file:opacity-90";

export function UploadForm({
  projectId,
  defaultVariantId,
  cases,
}: {
  projectId: string;
  defaultVariantId?: string;
  cases: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadFiles, {});
  const [hasCase, setHasCase] = useState(false);
  const [hasMaterials, setHasMaterials] = useState(false);
  const needsTarget = !hasCase && hasMaterials;

  return (
    <form onSubmit={keepInputs((fd) => action(fd))} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && (
        <p role="alert" className="rounded border-2 border-[var(--neg)] p-3 text-sm">
          {state.error}
        </p>
      )}

      <div className="rounded-lg border-2 border-dashed border-[var(--line)] p-4">
        <label className="block">
          <span className="mb-2 block text-lg font-bold">立論（Word）</span>
          <input
            type="file"
            name="caseFile"
            accept={ACCEPT}
            onChange={(e) => setHasCase(!!e.target.files?.length)}
            className={FILE_INPUT}
          />
        </label>
      </div>

      <div className="rounded-lg border-2 border-dashed border-[var(--line)] p-4">
        <label className="block">
          <span className="mb-2 block text-lg font-bold">資料（Word）</span>
          <input
            type="file"
            name="materialsFile"
            accept={ACCEPT}
            onChange={(e) => setHasMaterials(!!e.target.files?.length)}
            className={FILE_INPUT}
          />
        </label>

        {needsTarget && (
          <label className="mt-4 block">
            <span className="mb-1 block font-bold">この資料を付ける立論</span>
            {cases.length === 0 ? (
              <span className="block text-sm text-[var(--neg)]">
                資料を付けられる立論がまだありません。立論のファイルも一緒に選んでください。
              </span>
            ) : (
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
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || (!hasCase && !hasMaterials)}
        className="min-h-12 rounded bg-[var(--accent)] px-8 font-bold text-white disabled:opacity-40"
      >
        {pending ? "アップロードしています…" : "登録する"}
      </button>
    </form>
  );
}
