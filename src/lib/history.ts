/**
 * 立論1本分の「誰が・いつ・何をしたか」（取説 02「名前は、誰が直したかを見分けるために使う」）。
 *
 * 記録は activity_logs（追記のみ）にある。立論そのもの・その段落・その資料・確認済の切り替えは
 * それぞれ target の形が違うので、立論に属する target を集めてから絞り込む。
 */

import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, caseVariants, users } from "@/db/schema";

export interface HistoryEntry {
  at: string;
  who: string;
  /** 何に対して（「本文」「資料3」など） */
  what: string;
  detail: string;
}

export interface VerifiedBy {
  who: string;
  at: string;
}

export interface VariantHistory {
  entries: HistoryEntry[];
  /** 作った人（AIに作らせた人・登録した人） */
  createdBy: VerifiedBy | null;
  /** 確認済にした人。キーは "case" / "questions" / "closing" / "strategy" / `material:{id}` */
  verifiedBy: Record<string, VerifiedBy>;
}

const VERIFY_LABELS: Record<string, string> = {
  case: "本文",
  questions: "質疑と回答",
  closing: "最終弁論の雛形",
  strategy: "特徴と戦い方",
};

/** 一度に見る記録の上限。ゼミ1年分でも十分に収まる */
const SCAN_LIMIT = 3000;

export async function loadVariantHistory(
  variant: typeof caseVariants.$inferSelect,
  limit = 40,
): Promise<VariantHistory> {
  const labelOf = new Map<string, string>();
  labelOf.set(variant.id, "立論");
  for (const section of variant.debateCase.sections) {
    labelOf.set(section.id, "本文");
    for (const sub of section.subsections) labelOf.set(sub.id, "本文");
  }
  const materialNumber = new Map(variant.sourceRefs.map((r) => [r.materialId, r.number]));
  for (const [id, n] of materialNumber) labelOf.set(id, `資料${n}`);

  const rows = await db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.projectId, variant.projectId),
        inArray(activityLogs.action, ["generate", "edit", "verify", "upload", "copy"]),
      ),
    )
    .orderBy(desc(activityLogs.at))
    .limit(SCAN_LIMIT);

  const mine = rows.filter((r) => {
    if (labelOf.has(r.target)) return true;
    const [kind, id] = r.target.split(":");
    if (!id) return false;
    return kind === "material" ? materialNumber.has(id) : id === variant.id && kind in VERIFY_LABELS;
  });

  const userIds = [...new Set([...mine.map((r) => r.userId), ...(variant.createdBy ? [variant.createdBy] : [])])];
  const names = userIds.length
    ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds))
    : [];
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  const who = (id: string) => nameOf.get(id) ?? "（不明）";

  const verifiedBy: Record<string, VerifiedBy> = {};
  const seenVerify = new Set<string>();
  const entries: HistoryEntry[] = [];
  let createdBy: VerifiedBy | null = null;

  for (const r of mine) {
    let what = labelOf.get(r.target) ?? "";
    if (r.action === "verify") {
      const [kind, id] = r.target.split(":");
      what = kind === "material" ? `資料${materialNumber.get(id) ?? ""}` : VERIFY_LABELS[kind] ?? "";
      const key = kind === "material" ? r.target : kind;
      // 新しい順に見ているので、最初に出てきたものが今の状態
      if (!seenVerify.has(key)) {
        seenVerify.add(key);
        if (r.detail === "確認済にした") verifiedBy[key] = { who: who(r.userId), at: r.at };
      }
    }
    if (
      r.target === variant.id &&
      (r.detail === "立論を生成" || r.detail?.startsWith("立論を登録"))
    ) {
      createdBy = { who: who(r.userId), at: r.at };
    }
    if (entries.length < limit) {
      entries.push({ at: r.at, who: who(r.userId), what, detail: r.detail ?? "" });
    }
  }
  // 最初の立論はテーマ登録の流れで作られ、立論単位の記録がない。作った人は立論の行にある
  if (!createdBy && variant.createdBy && nameOf.has(variant.createdBy)) {
    createdBy = { who: who(variant.createdBy), at: variant.createdAt };
  }
  return { entries, createdBy, verifiedBy };
}
