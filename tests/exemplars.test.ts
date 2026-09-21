/**
 * お手本（few-shot）の健全性（src/domain/exemplars.ts）
 *
 * お手本は「実物であること」「5分に収まること」に価値がある。
 * ここが崩れると、モデルに悪い基準を教えることになる。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXEMPLARS, exemplarFor } from "../src/domain/exemplars.ts";
import { countSpeechChars, estimateSpeech } from "../src/domain/speech.ts";

test("両側のお手本がある", () => {
  assert.equal(EXEMPLARS.length, 2);
  assert.equal(exemplarFor("affirmative").side, "affirmative");
  assert.equal(exemplarFor("negative").side, "negative");
});

test("お手本は実フォーマットの構造を備えている", () => {
  for (const ex of EXEMPLARS) {
    assert.match(ex.text, /Ⅰ\.\s*主張/, `${ex.side}: Ⅰ.主張がない`);
    assert.match(ex.text, /Ⅱ\.\s*理由/, `${ex.side}: Ⅱ.理由がない`);
    assert.match(ex.text, /Ⅲ\.\s*結論/, `${ex.side}: Ⅲ.結論がない`);
    // 資料の参照マーカーが入っていないと、参照の書き方を教えられない
    assert.match(ex.text, /【[^】]*資料\d+参照】/, `${ex.side}: 資料参照がない`);
  }
});

test("お手本自身が5分に収まる（分量の教師になる）", () => {
  for (const ex of EXEMPLARS) {
    const est = estimateSpeech(ex.text);
    assert.equal(
      est.verdict !== "over",
      true,
      `${ex.side} のお手本が5分超過: ${est.label}`,
    );
  }
});

test("文字数は本文から数えており、5分の枠をほぼ使い切る長さ", () => {
  for (const ex of EXEMPLARS) {
    assert.equal(ex.speechChars, countSpeechChars(ex.text));
    // 短すぎるお手本を見せると、短い立論を書くようになってしまう
    assert.ok(
      ex.speechChars > 1200,
      `${ex.side}: お手本が短すぎる（${ex.speechChars}字）`,
    );
  }
});

test("匿名化されている（チーム名・個人名を含まない）", () => {
  for (const ex of EXEMPLARS) {
    for (const ng of ["名城", "池田", "石川", "磯貝", "増田", "松下", "三浦"]) {
      assert.equal(
        ex.text.includes(ng),
        false,
        `${ex.side}: 「${ng}」が残っている`,
      );
    }
  }
});
