/**
 * 利用者の識別（REQUIREMENTS.md §6.2 真正性）
 *
 * ゼミ規模では個人ごとの厳格なパスワード運用は現実的でないため、
 * 個人は「名前を選ぶだけ」。アクセス制御はプロジェクトのパスコードが担う。
 * ここで分かるのは「誰が編集したと自称しているか」まで、という前提を崩さない。
 */

import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, users } from "@/db/schema";
import { USER_COOKIE } from "@/lib/auth";
import { newId } from "@/lib/ids";

const ONE_YEAR = 60 * 60 * 24 * 365;

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

  const store = await cookies();
  store.set(USER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ONE_YEAR,
    path: "/",
  });
  return id;
}

export async function currentUserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(USER_COOKIE)?.value ?? null;
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
