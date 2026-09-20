/**
 * 立論の整形と資料参照の解析（src/domain/case-format.ts）
 *
 * splitRefs は画面で【資料N参照】をリンクにするために使う。
 * ここが壊れるとリンクが切れるか、本文の文字が欠ける。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFullText, splitRefs } from "../src/domain/case-format.ts";
import type { DebateCase } from "../src/domain/types.ts";

test("本文を素のテキストと資料参照に分解する", () => {
  const parts = splitRefs("担税力に反する【資料3参照】といえる。");
  assert.deepEqual(
    parts.map((p) => [p.kind, p.value]),
    [
      ["text", "担税力に反する"],
      ["ref", "【資料3参照】"],
      ["text", "といえる。"],
    ],
  );
  assert.equal(parts[1].kind === "ref" && parts[1].number, 3);
});

test("複合マーカーの前置き部分を保持する", () => {
  const parts = splitRefs("必要経費【法37条1項、資料2参照】を控除する。");
  const ref = parts.find((p) => p.kind === "ref");
  assert.ok(ref && ref.kind === "ref");
  assert.equal(ref.prefix, "法37条1項、");
  assert.equal(ref.number, 2);
});

test("分解して連結すると元の文字列に戻る（文字を落とさない）", () => {
  const text = "【資料1参照】冒頭から始まり【法14条、資料2参照】中間【資料10参照】";
  assert.equal(splitRefs(text).map((p) => p.value).join(""), text);
});

test("資料参照がない文はそのまま1つのテキストになる", () => {
  const parts = splitRefs("参照のない文章です。");
  assert.deepEqual(parts, [{ kind: "text", value: "参照のない文章です。" }]);
});

test("空文字は空の配列になる", () => {
  assert.deepEqual(splitRefs(""), []);
});

test("実フォーマットどおりの本文を組み立てる", () => {
  const debateCase: DebateCase = {
    side: "affirmative",
    valuePremise: "",
    claim: "所得税法56条および57条を廃止するべきである。",
    conclusion: "以上より、所得税法56条および57条を廃止するべきである。",
    fullText: "",
    sections: [
      {
        id: "s1",
        title: "問題点（租税公平主義の観点から）",
        type: "criteria",
        subsections: [
          {
            id: "c1",
            categoryIds: [],
            title: "担税力に即した課税",
            claim: "純資産増加説を採用するわが国では【資料1参照】。",
            warrant: "したがって必要経費の控除が必要である。",
            sourceRefIds: ["r1"],
            causalChain: [],
            impact: "",
          },
        ],
      },
    ],
  };

  const text = renderFullText(debateCase);
  assert.match(text, /^Ⅰ\. 主張/);
  assert.ok(text.includes("Ⅱ. 理由"));
  assert.ok(text.includes("1. 問題点（租税公平主義の観点から）"));
  // 実物に合わせて全角括弧の連番と全角スペースの字下げを使う
  assert.ok(text.includes("　（1）担税力に即した課税"));
  assert.ok(text.includes("【資料1参照】"));
  assert.ok(text.trimEnd().endsWith("以上より、所得税法56条および57条を廃止するべきである。"));
});
