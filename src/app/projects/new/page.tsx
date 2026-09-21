/**
 * 論題入力ウィザード（DESIGN.md §2 WIZ）
 */

import { desc, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Breadcrumb, Header } from "@/components/chrome";
import { WizardForm } from "./wizard-form";

export const metadata = { title: "お題の登録 | ディベート支援" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  // いまのお題がある＝これは「変更」。何が起きるかを先に伝える
  const [current] = await db
    .select()
    .from(projects)
    .where(ne(projects.status, "archived"))
    .orderBy(desc(projects.updatedAt))
    .limit(1);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[
            { label: "ホーム", href: "/" },
            { label: current ? "お題の変更" : "お題の登録" },
          ]}
        />
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">
            {current ? "お題を変更する" : "お題を登録する"}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            <b className="text-[var(--foreground)]">①論題入力</b> ─ ②分析確認 ─ ③生成
          </p>
        </div>

        {current && (
          <div className="mb-6 rounded border-2 border-[var(--neg)] p-4">
            <p className="mb-2 font-bold">いまのお題を切り替えます</p>
            <p className="mb-2 text-sm">現在: {current.resolution}</p>
            <p className="text-sm text-[var(--muted)]">
              これまでの立論・資料・ブロック集は<b>消えません</b>が、
              ホームの「過去のお題」に移ります。いつでも開けます。
            </p>
          </div>
        )}

        <WizardForm isChange={!!current} />
      </main>
    </>
  );
}
