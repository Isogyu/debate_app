/**
 * 日本時間での日付・時刻。サーバー（Fly.io）は UTC で動くので、
 * そのまま表示すると 0〜9時は前日の日付になり、時刻は9時間ずれる。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJst(date: Date): Date {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

/** 今日の日付（日本時間、YYYY-MM-DD） */
export function todayJst(now: Date = new Date()): string {
  return toJst(now).toISOString().slice(0, 10);
}

/** ISO 形式の時刻を「2026-09-26 12:57」（日本時間）にする */
export function formatJstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return toJst(d).toISOString().slice(0, 16).replace("T", " ");
}

/** ISO 形式の時刻を「2026年9月26日」（日本時間）にする */
export function formatJstDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const j = toJst(d);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}
