import { randomUUID } from "node:crypto";

/** 読みやすさ優先の接頭辞付きID。ログを目視で追えるようにする */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
