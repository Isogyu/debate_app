"use client";

import { useRouter } from "next/navigation";

/**
 * 出力する立論を選ぶ。資料番号は立論ごとに 1..N なので、
 * どの立論を選ぶかで参考資料の中身と番号が変わる。
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
    <label className="mb-5 block">
      <span className="mb-1 block text-sm font-bold">出力する立論</span>
      <select
        value={currentId}
        onChange={(e) =>
          router.push(`/projects/${projectId}/export?variant=${encodeURIComponent(e.target.value)}`)
        }
        className="min-h-11 w-full rounded border border-[var(--line)] p-2"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-[var(--muted)]">
        ※資料の番号は立論ごとに振られています
      </span>
    </label>
  );
}
