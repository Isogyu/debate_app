/**
 * 読み上げ時間の見積もり（src/domain/speech.ts）
 *
 * 立論は5分を超えると減点される。分量の判定を誤ると
 * 「問題なし」と表示したまま試合で減点されることになるので、
 * 実物の立論を基準に確かめる。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  countSpeechChars,
  estimateSpeech,
  formatDuration,
  speechBudgetChars,
  speechBudgetGuide,
  SPEECH_LIMIT_SECONDS,
} from "../src/domain/speech.ts";

test("資料の参照記法は読み上げないので数えない", () => {
  // 「必要経費を控除している」11字 ＋ 句点1字
  assert.equal(countSpeechChars("必要経費を控除している【資料2参照】。"), 12);
  assert.equal(
    countSpeechChars("公平に反する【法37条1項、資料2参照】。"),
    7,
  );
});

test("空白と改行は数えない", () => {
  assert.equal(countSpeechChars("あいう　えお\nかき"), 7);
});

test("見出しの番号は読まないが、文中の括弧は読む", () => {
  assert.equal(countSpeechChars("（1）担税力"), 3);
  // 文中の補足は実際に読み上げるので数える（6字＋括弧込み9字）
  assert.equal(countSpeechChars("純資産増加説（包括的所得概念）"), 15);
});

test("5分の持ち分は既定で1600字", () => {
  assert.equal(speechBudgetChars(), 1600);
  assert.equal(speechBudgetChars(280), 1400);
});

test("実物の立論は5分に収まると判定される", () => {
  // 実際の試合で使われた立論。これが「収まる」と出ないなら基準がおかしい
  const dir = path.join(process.cwd(), "docs/samples");
  const files = fs.readdirSync(dir).filter((f) => f.includes("立論"));
  assert.ok(files.length > 0, "サンプルが見つからない");

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    // 1行目=チーム名、2行目=氏名は読み上げない
    const body = raw.split("\n").slice(2).join("\n");
    const est = estimateSpeech(body);

    assert.ok(
      est.seconds <= SPEECH_LIMIT_SECONDS,
      `${file} が超過と判定された: ${est.label}（${est.chars}字）`,
    );
    // 5分の枠をほぼ使い切る長さのはず。短すぎる判定も困る
    assert.ok(
      est.ratio > 0.8,
      `${file} が短すぎる判定: ${est.label}（${est.chars}字）`,
    );
  }
});

test("超過したら超過分を示す", () => {
  const est = estimateSpeech("あ".repeat(2000));
  assert.equal(est.verdict, "over");
  assert.match(est.label, /超過/);
});

test("5分の9割を超えたら注意を促す", () => {
  assert.equal(estimateSpeech("あ".repeat(1000)).verdict, "ok");
  assert.equal(estimateSpeech("あ".repeat(1500)).verdict, "near");
});

test("時間の表示は分と秒", () => {
  assert.equal(formatDuration(300), "5分00秒");
  assert.equal(formatDuration(65), "1分05秒");
});

test("生成への指示に全体と1段落あたりの目安が入る", () => {
  const guide = speechBudgetGuide(6);
  assert.match(guide, /1600字以内/);
  assert.match(guide, /減点/);
  // 1段落あたりの目安がないと、全体だけ言っても守られない
  assert.match(guide, /1つあたり\d+字/);
});
