/**
 * 論題入力ウィザード（DESIGN.md §2 WIZ）
 */

import { Breadcrumb, Header } from "@/components/chrome";
import { WizardForm } from "./wizard-form";

export const metadata = { title: "新しいプロジェクト | ディベート支援" };

export default function NewProjectPage() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb items={[{ label: "ホーム", href: "/" }, { label: "新しいプロジェクト" }]} />
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">新しいプロジェクト</h1>
          <p className="text-sm text-[var(--muted)]">
            <b className="text-[var(--foreground)]">①論題入力</b> ─ ②分析確認 ─ ③生成
          </p>
        </div>
        <WizardForm />
      </main>
    </>
  );
}
