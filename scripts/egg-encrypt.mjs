/**
 * 隠しページの原稿（平文のHTML）を暗号化して public/egg/interview.enc に書き出す。
 * 平文と合言葉はリポジトリに入れない（.gitignore の /egg-src）。
 *
 *   EGG_PASSPHRASE='…' node scripts/egg-encrypt.mjs ../egg-src/interview.html
 */

import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const src = process.argv[2];
const phrase = process.env.EGG_PASSPHRASE;
if (!src || !phrase) {
  console.error("usage: EGG_PASSPHRASE='…' node scripts/egg-encrypt.mjs <plain.html>");
  process.exit(1);
}

const ITER = 250_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(phrase.trim()), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
  base,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"],
);
const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, readFileSync(src));
const b64 = (u) => Buffer.from(u).toString("base64");
writeFileSync(
  new URL("../public/egg/interview.enc", import.meta.url),
  JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) }),
);
console.log("public/egg/interview.enc を書き出しました。");
