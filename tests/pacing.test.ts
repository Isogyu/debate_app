/**
 * 読み上げのペース配分（src/domain/pacing.ts）
 *
 * 誤った指示は実害になる。「巻いてください」と誤表示すれば早口になり、
 * 要項11の「時間調整のため早口」で別途減点される。
 * だから判定の境界は正確でなければならない。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacingPlan, evaluatePace } from "../src/domain/pacing.ts";
import type { DebateCase } from "../src/domain/types.ts";

/** 各段落が同じ長さの立論。時間配分の検算がしやすい */
function evenCase(): DebateCase {
  const body = "あ".repeat(100);
  return {
    side: "affirmative",
    valuePremise: "",
    claim: body,
    conclusion: body,
    fullText: "",
    sections: [
      {
        id: "s1",
        title: "見出し",
        type: "criteria",
        subsections: [
          {
            id: "c1",
            categoryIds: [],
            title: "小見出し",
            claim: body,
            warrant: body,
            impact: body,
            sourceRefIds: [],
            causalChain: [],
          },
        ],
      },
    ],
  };
}

test("原稿を段落ごとの塊に分け、累積字数と目標時刻を付ける", () => {
  const plan = buildPacingPlan(evenCase(), 300);

  // 主張・理由の3段落・結論の本文が5つ、それに見出しが混じる
  assert.ok(plan.chunks.length >= 5);
  assert.ok(plan.totalChars > 500);

  // 累積は単調増加でなければならない
  for (let i = 1; i < plan.chunks.length; i++) {
    assert.ok(
      plan.chunks[i].cumulativeChars >= plan.chunks[i - 1].cumulativeChars,
      "累積字数が戻っている",
    );
    assert.ok(
      plan.chunks[i].dueAtSeconds >= plan.chunks[i - 1].dueAtSeconds,
      "目標時刻が戻っている",
    );
  }

  // 最後の塊を読み終える時刻が持ち時間と一致する
  assert.equal(
    Math.round(plan.chunks[plan.chunks.length - 1].dueAtSeconds),
    300,
  );
});

test("資料の参照記法は読み上げないので時間に数えない", () => {
  const withRef = evenCase();
  withRef.claim = "あ".repeat(100) + "【資料1参照】";
  const plain = buildPacingPlan(evenCase(), 300);
  const marked = buildPacingPlan(withRef, 300);
  assert.equal(marked.totalChars, plain.totalChars);
});

test("位置の申告がなければ、目安だけを示して口出ししない", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  const status = evaluatePace(plan, 60, null);
  assert.equal(status.state, "onTrack");
  assert.equal(status.projectedSeconds, null);
  // 位置が分からないのに「遅れています」と言ってはいけない
  assert.ok(!status.message.includes("遅れ"));
});

test("予定どおりの位置なら「ちょうど」と判定する", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  // 3つめの塊を読んでいる＝2つめまで終えている。その予定時刻に合わせる
  const elapsed = plan.chunks[1].dueAtSeconds;
  const status = evaluatePace(plan, elapsed, 2);
  assert.equal(status.state, "onTrack");
});

test("予定より遅れていれば遅れ秒数を示す", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  // 2つめまで終えているべき時刻より40秒多くかかっている
  const elapsed = plan.chunks[1].dueAtSeconds + 40;
  const status = evaluatePace(plan, elapsed, 2);
  assert.equal(status.state, "behind");
  assert.ok(status.driftSeconds < 0);
  assert.match(status.message, /遅れています/);
});

test("予定より早ければ「早い」と示し、急かさない", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  const elapsed = Math.max(plan.chunks[3].dueAtSeconds - 40, 1);
  const status = evaluatePace(plan, elapsed, 4);
  assert.equal(status.state, "ahead");
  assert.match(status.message, /早いです/);
  // 早いときに「詰めてください」と言うと早口を招く
  assert.ok(!status.message.includes("詰めて"));
});

test("多少のずれでは口を出さない（15秒まで許容）", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  const base = plan.chunks[2].dueAtSeconds;
  assert.equal(evaluatePace(plan, base + 10, 3).state, "onTrack");
  assert.equal(evaluatePace(plan, base - 10, 3).state, "onTrack");
});

test("このままのペースでの着地見込みを出す", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  // 半分の地点を、予定の倍の時間で読んでいる → 倍かかる見込み
  const half = plan.chunks.findIndex(
    (c) => c.cumulativeChars >= plan.totalChars / 2,
  );
  const doneChars = plan.chunks[half].cumulativeChars;
  const elapsed = (doneChars / plan.totalChars) * 300 * 2;
  const status = evaluatePace(plan, elapsed, half + 1);
  assert.ok(status.projectedSeconds !== null);
  assert.ok(
    Math.abs(status.projectedSeconds - 600) < 5,
    `着地見込みが合わない: ${status.projectedSeconds}`,
  );
});

test("経過時間から「ここまで終えているべき塊」を示す", () => {
  const plan = buildPacingPlan(evenCase(), 300);
  assert.equal(evaluatePace(plan, 0, null).targetIndex, 0);
  // 持ち時間を過ぎたら最後の塊を指す
  assert.equal(
    evaluatePace(plan, 999, null).targetIndex,
    plan.chunks.length - 1,
  );
});
