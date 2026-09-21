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
    // 実物は適正帯に入っているはず。「余りすぎ」と出るなら基準がおかしい
    assert.equal(
      est.verdict,
      "ok",
      `${file} が適正と判定されない: ${est.label}（${est.chars}字）`,
    );
  }
});

test("超過したら超過分を示す", () => {
  const est = estimateSpeech("あ".repeat(2000));
  assert.equal(est.verdict, "over");
  assert.match(est.label, /超過/);
});

test("30秒以上余る短さは減点対象として扱う", () => {
  // 審査要項: 「時間オーバーや30秒以上時間が余った場合は減点」
  // 320字/分なので、4分30秒ぶんは1440字。これ以下は余りすぎ
  // 境界そのものは秒への丸めがあるので、明確に内外の値で確かめる
  assert.equal(estimateSpeech("あ".repeat(1000)).verdict, "short");
  assert.equal(estimateSpeech("あ".repeat(1440)).verdict, "short");
  assert.equal(estimateSpeech("あ".repeat(1500)).verdict, "ok");
  assert.equal(estimateSpeech("あ".repeat(1590)).verdict, "ok");
  assert.equal(estimateSpeech("あ".repeat(1700)).verdict, "over");
});

test("短い場合は何秒余るかを示す", () => {
  const est = estimateSpeech("あ".repeat(800));
  assert.equal(est.verdict, "short");
  assert.match(est.label, /余る/);
});

test("時間の表示は分と秒", () => {
  assert.equal(formatDuration(300), "5分00秒");
  assert.equal(formatDuration(65), "1分05秒");
});

test("生成への指示に上限と下限の両方が入る", () => {
  const guide = speechBudgetGuide(6);
  // 上限だけ伝えると、短すぎる立論ができて減点される
  assert.match(guide, /1440〜1600字/);
  assert.match(guide, /減点/);
  assert.match(guide, /減点/);
  // 1段落あたりの目安がないと、全体だけ言っても守られない
  assert.match(guide, /1つあたり\d+〜\d+字/);
  // 速度で帳尻を合わせるのも減点対象だと伝える
  assert.match(guide, /早口/);
});

test("括弧だけの資料マーカーも読み上げない", () => {
  // 実物のチームによっては (資料2) と書く。【資料N参照】しか見ていないと
  // 字数を多く数え、リンクも張れなかった
  assert.equal(countSpeechChars("家族従業者であった(資料2)。"), 10);
  assert.equal(countSpeechChars("割合は3.3%である（資料3）。"), 11);
});

test("論点の区切り線は読み上げないので数えない", () => {
  // 実物の原稿には ＿＿＿＿… の罫線が入っていた。
  // これを数えると8秒ぶん過大になり、収まる立論を「超過」と判定していた
  const ruled = "主張です。\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿\n次の論点です。";
  assert.equal(countSpeechChars(ruled), countSpeechChars("主張です。次の論点です。"));
  assert.equal(countSpeechChars("区切り\n--------\n続き"), 5);
});
