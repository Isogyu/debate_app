"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-[var(--accent)] px-5 py-3 font-bold text-white"
    >
      印刷する（PDFで保存）
    </button>
  );
}
