/**
 * 利用者の識別（REQUIREMENTS.md §6.2 真正性）
 *
 * アクセス制御はアプリ共通の合言葉が担い、個人は名前を入れるだけ。
 * ここで分かるのは「誰が編集したと自称しているか」まで、という前提を崩さない。
 */

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, users } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { newId } from "@/lib/ids";

/** 同じ名前なら同じUserを使い回す。名簿を作らせない */
export async function resolveUser(displayName: string): Promise<string> {
  const name = displayName.trim();
  if (!name) throw new Error("お名前を入力してください。");

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.displayName, name));

  const id = existing?.id ?? newId("usr");
  if (!existing) {
    await db.insert(users).values({ id, displayName: name, role: "member" });
  }

  return id;
}

/** 署名を検証したうえで利用者IDを返す。proxyのチェックは楽観的なのでここが本番 */
export async function currentUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** ログイン必須のページ・処理で使う。未ログインならログイン画面へ送る */
export async function requireSession(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  return userId;
}

export async function currentUserName(): Promise<string | null> {
  const id = await currentUserId();
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user?.displayName ?? null;
}

/** 責任追跡性: 追記のみ。あとから書き換えない */
export async function log(
  userId: string,
  action: "generate" | "edit" | "export" | "verify" | "login" | "pack_build",
  target: string,
  projectId?: string,
  detail?: string,
): Promise<void> {
  await db.insert(activityLogs).values({
    id: newId("log"),
    projectId,
    userId,
    action,
    target,
    detail,
  });
}
