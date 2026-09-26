/**
 * テーマの登録・変更（v6 要件 F1）
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Breadcrumb } from "@/components/chrome";
import { Header } from "@/components/header";
import { activeJobs } from "@/lib/jobs/runner";
import { requireSession } from "@/lib/session";
import { WizardForm } from "./wizard-form";

export const metadata = { title: "テーマの登録 | ディベート支援" };
export const dynamic = "force-dynamic";

export default async function NewThemePage() {
  await requireSession();
  const [current] = await db.select().from(projects).where(eq(projects.status, "active"));
  const busy = current ? (await activeJobs(current.id)).length > 0 : false;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Breadcrumb
          items={[{ label: "ホーム", href: "/" }, { label: current ? "テーマの変更" : "テーマの登録" }]}
        />
        <h1 className="mb-6 text-2xl font-bold">{current ? "テーマを変更する" : "テーマを登録する"}</h1>

        {current && (
          <div className="mb-6 rounded border-2 border-[var(--neg)] p-4">
            <p className="mb-2 font-bold">いまのテーマを切り替えます</p>
            <p className="mb-2 text-sm">現在: {current.resolution}</p>
            <p className="text-sm text-[var(--muted)]">
              これまでの立論・資料・質疑は<b>消えません</b>。「過去テーマ」として保管され、
              閲覧・印刷と、資料の現テーマへのコピーができます。
            </p>
          </div>
        )}

        {busy ? (
          <p className="rounded border border-[var(--line)] p-4">
            いまのテーマで生成が動いているため、変更できません。生成が終わってから変更してください。
          </p>
        ) : (
          <WizardForm isChange={!!current} />
        )}
      </main>
    </>
  );
}
