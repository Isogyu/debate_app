/**
 * 質疑練習の計算部品（src/domain/practice.ts）
 *
 * キーの対応がずれると、詰まった質問の印や照合結果が別の質問に付く。
 * 長さの判定がずれると、講評の「長すぎる発言」が信用できなくなる。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuestionKeys,
  keysToIds,
  LONG_TURN_SECONDS,
  longTurnsOf,
  matchParagraph,
  userTurnLengths,
  type KeyedNodeInput,
} from "../src/domain/practice.ts";

function node(p: Partial<KeyedNodeInput> & { id: string; chainId: string }): KeyedNodeInput {
  return {
    chainOrder: 0,
    question: `質問${p.id}`,
    modelAnswer: "",
    purpose: "",
    goal: undefined,
    priority: 3,
    setOrder: undefined,
    stuckCount: 0,
    targetParagraph: "",
    branches: [],
    ...p,
  };
}

const nodes: KeyedNodeInput[] = [
  node({ id: "a1", chainId: "A", priority: 5 }),
  node({ id: "b2", chainId: "B", chainOrder: 1 }),
  node({ id: "b1", chainId: "B", chainOrder: 0, setOrder: 2, goal: "Bの結論" }),
  node({ id: "c1", chainId: "C", setOrder: 1 }),
  node({ id: "d1", chainId: "D", priority: 5, stuckCount: 2 }),
];

test("8分セットを setOrder 順に先頭へ、残りは優先度・詰まった回数の順に並べる", () => {
  const map = buildQuestionKeys(nodes);
  assert.deepEqual(
    map.chains.map((c) => c.chainId),
    ["C", "B", "D", "A"],
  );
  assert.equal(map.chains[1].goal, "Bの結論");
  assert.equal(map.chains[1].inEightMinuteSet, true);
  assert.equal(map.chains[2].inEightMinuteSet, false);
});

test("連鎖の中は chainOrder 順にキーを振り、キーとIDを往復できる", () => {
  const map = buildQuestionKeys(nodes);
  assert.deepEqual(
    map.chains[1].nodes.map((n) => [n.key, n.node.id]),
    [
      ["q2", "b1"],
      ["q3", "b2"],
    ],
  );
  assert.equal(map.nodeIdByKey.get("q1"), "c1");
  assert.equal(map.keyByNodeId.get("b2"), "q3");
  assert.equal(map.chainIdByKey.get("c2"), "B");
});

test("上限を超える連鎖は丸ごと落とす（途中で切らない）", () => {
  const map = buildQuestionKeys(nodes, 2);
  // C(1問) を採ったあと B(2問) は入らない。D(1問) は入る
  assert.deepEqual(
    map.chains.map((c) => c.chainId),
    ["C", "D"],
  );
});

test("LLMが返したキーをIDに戻す。存在しないキーは捨て、重複はまとめる", () => {
  const map = buildQuestionKeys(nodes);
  assert.deepEqual(keysToIds(["q2", " Q2 ", "q99", "x"], map.nodeIdByKey), ["b1"]);
});

test("練習者の発言だけを、質問／回答の目安で長さ判定する", () => {
  const long = "あ".repeat(200); // 320字/分で約38秒
  const turns = [
    { speaker: "ai" as const, text: long },
    { speaker: "user" as const, text: "短い質問です。" },
    { speaker: "user" as const, text: long },
  ];
  const attack = userTurnLengths(turns, "attack");
  assert.deepEqual(
    attack.map((l) => [l.index, l.role, l.tooLong]),
    [
      [1, "question", false],
      [2, "question", true],
    ],
  );
  assert.equal(attack[1].seconds, 38);

  // 回答の目安は質問より長い。30秒を超える200字はやはり長い
  const defense = userTurnLengths(turns, "defense");
  assert.equal(defense[1].tooLong, 38 > LONG_TURN_SECONDS.answer);

  // 25秒（約133字）の発言は、質問なら長く、回答なら許容
  const mid = [{ speaker: "user" as const, text: "い".repeat(133) }];
  assert.equal(userTurnLengths(mid, "attack")[0].tooLong, true);
  assert.equal(userTurnLengths(mid, "defense")[0].tooLong, false);
});

test("長すぎる発言は冒頭だけを抜き出す", () => {
  const out = longTurnsOf(userTurnLengths([{ speaker: "user", text: "う".repeat(200) }], "attack"), 10);
  assert.deepEqual(out, [{ excerpt: `${"う".repeat(10)}…`, seconds: 38 }]);
});

test("段落名を、完全一致・表記ゆれ・見出しで対応付ける", () => {
  const paragraphs = [
    { claimId: "c1", label: "1（1）担税力", title: "担税力" },
    { claimId: "c2", label: "1（2）公平", title: "公平" },
  ];
  assert.equal(matchParagraph("1（1）担税力", paragraphs)?.claimId, "c1");
  assert.equal(matchParagraph("1(2) 公平", paragraphs)?.claimId, "c2");
  assert.equal(matchParagraph("担税力の段落", paragraphs)?.claimId, "c1");
  assert.equal(matchParagraph("", paragraphs), undefined);
  assert.equal(matchParagraph("結論", paragraphs), undefined);
});
