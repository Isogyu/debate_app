"use client";

import { useRouter } from "next/navigation";

/**
 * 資料番号は立論パターンごとに振られるので、
 * どのパターンを出力するかで参考資料の番号体系が変わる。
 */
export function VariantPicker({
  projectId,
  currentId,
  options,
}: {
  projectId: string;
  currentId: string;
  options: { id: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <label className="mb-5 block text-sm">
      <span className="mr-2 text-[var(--muted)]">出力する立論パターン:</span>
      <select
        defaultValue={currentId}
        onChange={(e) =>
          router.push(`/projects/${projectId}/export?variant=${e.target.value}`)
        }
        className="rounded border border-[var(--line)] p-2"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="ml-2 text-xs text-[var(--muted)]">
        ※資料番号はパターンごとに振られます
      </span>
    </label>
  );
}
