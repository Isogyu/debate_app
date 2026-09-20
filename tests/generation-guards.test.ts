/**
 * 生成結果の後処理の防御（src/domain/case-format.ts）
 *
 * 実際にAPIを回して見つかった不具合に対応する。
 * プロンプトで指示しても守られないことがあるため、コード側でも直す。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureRefMarkers, stripLeadingNumber } from "../src/domain/case-format.ts";

test("見出しの先頭の番号を落とす（表示側の採番と二重にならないように）", () => {
  // 実際にAIが返してきた形
  assert.equal(
    stripLeadingNumber("Ⅱ-1. 個人の尊重・法の下の平等アプローチから見た問題点"),
    "個人の尊重・法の下の平等アプローチから見た問題点",
  );
  assert.equal(
    stripLeadingNumber("（1）婚姻の自由と氏の自己決定権"),
    "婚姻の自由と氏の自己決定権",
  );
  assert.equal(stripLeadingNumber("1. 廃止する環境"), "廃止する環境");
  assert.equal(stripLeadingNumber("2）簡素"), "簡素");
});

test("番号が付いていない見出しはそのまま残す", () => {
  assert.equal(stripLeadingNumber("担税力に即した課税"), "担税力に即した課税");
  // 本文の一部として数字が意味を持つ見出しを壊さない
  assert.equal(stripLeadingNumber("所得税法56条の問題点"), "所得税法56条の問題点");
});

test("本文にマーカーがなければ文末の句点の前に補う", () => {
  assert.equal(
    ensureRefMarkers("担税力に即した課税に反する。", [1, 2]),
    "担税力に即した課税に反する【資料1参照】【資料2参照】。",
  );
});

test("既にあるマーカーは重複させない", () => {
  const text = "必要経費を控除している【資料1参照】。";
  assert.equal(ensureRefMarkers(text, [1]), text);
});

test("一部だけ欠けている場合は欠けた分だけ補う", () => {
  assert.equal(
    ensureRefMarkers("根拠がある【資料1参照】。", [1, 3]),
    "根拠がある【資料1参照】【資料3参照】。",
  );
});

test("句点で終わらない本文にはそのまま付け足す", () => {
  assert.equal(
    ensureRefMarkers("見出しのような文", [2]),
    "見出しのような文【資料2参照】",
  );
});

test("複合マーカーも既出として扱う", () => {
  const text = "必要経費【法37条1項、資料2参照】を控除する。";
  assert.equal(ensureRefMarkers(text, [2]), text);
});

// ── LLM出力スキーマの許容範囲 ──────────────────────────
// 実際にAPIを回したときに見つかった不具合への対応。

test("分岐の終端で followUpKey が null でも受け付ける", async () => {
  const { crossExamOutputSchema } = await import("../src/domain/schemas.ts");
  // LLMは「値なし」を省略ではなく null で返してくる
  const result = crossExamOutputSchema.safeParse({
    nodes: [
      {
        key: "q1",
        direction: "attack",
        question: "本当に防げているのですか？",
        purpose: "前提を揺さぶる",
        categoryNames: ["公平性"],
        targetClaimTitle: null,
        branches: [
          { expectedAnswer: "防げています", followUpKey: "q2", exposedWeakness: null },
          { expectedAnswer: "いいえ", followUpKey: null, exposedWeakness: "過剰性を認める" },
        ],
      },
    ],
  });
  assert.ok(result.success, JSON.stringify(result.error?.issues));
  // null は undefined に寄せて、後続の処理で分岐しなくて済むようにする
  assert.equal(result.data.nodes[0].branches[1].followUpKey, undefined);
  assert.equal(result.data.nodes[0].targetClaimTitle, undefined);
});

test("評価基準の根拠法令が null でも受け付ける", async () => {
  const { analysisOutputSchema } = await import("../src/domain/schemas.ts");
  const result = analysisOutputSchema.safeParse({
    policyChange: "変更点",
    statusQuo: "現状",
    relatedLaws: [{ name: "民法", article: "第750条" }],
    stakeholders: [],
    coreIssues: [],
    categories: [{ name: "権利論", description: "" }],
    frameworks: {
      affirmative: { name: "枠組みA", basisLaw: null, criteria: ["自己決定権"] },
      negative: { name: "枠組みB", criteria: ["安定性"] },
    },
  });
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("slot が s1 のように数字を含んでいても置換できる", async () => {
  const { replaceSlotMarkers } = await import("../src/domain/case-format.ts");
  const slotToRefId = new Map([
    ["s1", "r_a"],
    ["s2", "r_b"],
  ]);
  const refs = [
    { id: "r_a", number: 1 },
    { id: "r_b", number: 2 },
  ];
  // 数字を含まない前提で書くと【資料s2参照】が残り、救済処理が
  // 【資料2参照】を足して「【資料s2参照】【資料2参照】」になっていた
  assert.equal(
    replaceSlotMarkers("妻が改氏している【資料s2参照】。", slotToRefId, refs),
    "妻が改氏している【資料2参照】。",
  );
  assert.equal(
    replaceSlotMarkers("必要経費【法37条1項、資料s1参照】。", slotToRefId, refs),
    "必要経費【法37条1項、資料1参照】。",
  );
});

test("未知の slot は書き換えずそのまま残す", async () => {
  const { replaceSlotMarkers } = await import("../src/domain/case-format.ts");
  const text = "根拠がある【資料zzz参照】。";
  assert.equal(replaceSlotMarkers(text, new Map(), []), text);
});
