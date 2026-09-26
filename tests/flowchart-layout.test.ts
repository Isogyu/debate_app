/**
 * 質疑フローチャートの配置（src/lib/flowchart-layout.ts）
 *
 * 箱が1つでも抜けると、分岐図から回答や続きの質問が消えて台本と食い違う。
 * 行き止まりの回答・単発の質問も必ず箱になることを確かめる。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerBoxId,
  buildChainGraph,
  goalBoxId,
  layoutChain,
  questionBoxId,
  wrapText,
  type LayoutSourceNode,
} from "../src/lib/flowchart-layout.ts";

const chain: LayoutSourceNode[] = [
  {
    id: "n1",
    chainId: "c1",
    chainOrder: 0,
    question: "資料2の数字は、給与所得者だけを対象にした統計ですね？",
    purpose: "統計の対象範囲を確定させる",
    modelAnswer: "はい。ただし全体の傾向を示すには十分です。",
    goal: "資料2では担税力の比較ができないこと",
    branches: [
      { kind: "admit", expectedAnswer: "はい、そうです。", followUpNodeId: "n2" },
      { kind: "deny", expectedAnswer: "いいえ、全体です。", exposedWeakness: "資料の注記と矛盾" },
      { kind: "evade", expectedAnswer: "傾向は同じです。", followUpNodeId: "n2" },
    ],
  },
  {
    id: "n2",
    chainId: "c1",
    chainOrder: 1,
    question: "では自営業者との比較には使えませんね？",
    purpose: "比較の前提のずれを認めさせる",
    modelAnswer: "直接の比較には使いませんが、別の資料で補っています。",
    branches: [
      { kind: "admit", expectedAnswer: "直接は使えません。" },
      { kind: "deny", expectedAnswer: "使えます。" },
    ],
  },
];

test("すべての質問と回答が箱になる（行き止まりの回答も含む）", async () => {
  const layout = await layoutChain(chain);
  const ids = new Set(layout.boxes.map((b) => b.id));
  for (const n of chain) {
    assert.ok(ids.has(questionBoxId(n.id)), `質問 ${n.id} の箱がない`);
    n.branches.forEach((_, i) => {
      assert.ok(ids.has(answerBoxId(n.id, i)), `回答 ${n.id}#${i} の箱がない`);
    });
  }
  assert.ok(ids.has(goalBoxId("c1")));
  // 質問2 + 回答5 + 結論1
  assert.equal(layout.boxes.length, 8);

  // 行き止まりの回答（n1 の否定、n2 の両方）も箱として置かれ、色分け用の種類を持つ
  const deny = layout.boxes.find((b) => b.id === answerBoxId("n1", 1));
  assert.equal(deny?.kind, "deny");
  assert.equal(deny?.subText, "資料の注記と矛盾");

  // 認めて終わる回答は結論につながる
  assert.ok(
    layout.edges.some((e) => e.source === answerBoxId("n2", 0) && e.target === goalBoxId("c1")),
  );
});

test("配置結果に座標と線の経路が入り、全体の大きさに収まる", async () => {
  const layout = await layoutChain(chain);
  assert.ok(layout.width > 0 && layout.height > 0);
  for (const b of layout.boxes) {
    assert.ok(b.height > 0);
    assert.ok(b.x >= 0 && b.x + b.width <= layout.width + 1);
    assert.ok(b.y >= 0 && b.y + b.height <= layout.height + 1);
  }
  for (const e of layout.edges) {
    assert.ok(e.points.length >= 2, `${e.id} に経路がない`);
  }
  // 左から右へ: 質問1 → 回答 → 質問2 の順に右へ進む
  const x = (id: string) => layout.boxes.find((b) => b.id === id)!.x;
  assert.ok(x(questionBoxId("n1")) < x(answerBoxId("n1", 0)));
  assert.ok(x(answerBoxId("n1", 0)) < x(questionBoxId("n2")));
});

test("単発の質問（長さ1の連鎖）も配置できる", async () => {
  const single: LayoutSourceNode[] = [
    {
      id: "s1",
      chainId: "c2",
      chainOrder: 0,
      question: "制度の開始時期はいつですか？",
      goal: "開始時期が未定であること",
      branches: [
        { kind: "deny", expectedAnswer: "決まっています。" },
        { kind: "evade", expectedAnswer: "今後検討します。" },
      ],
    },
  ];
  const layout = await layoutChain(single);
  assert.equal(layout.boxes.length, 4);
  // 認める回答がないときは、起点から結論へ仮の線を引く
  const dashed = layout.edges.find((e) => e.dashed);
  assert.equal(dashed?.source, questionBoxId("s1"));
  assert.equal(dashed?.target, goalBoxId("c2"));
});

test("守る側の見え方では、質問の箱に模範回答を出し、突ける点は出さない", () => {
  const { boxes } = buildChainGraph(chain, { subText: "modelAnswer" });
  const q = boxes.find((b) => b.id === questionBoxId("n1"));
  assert.equal(q?.subLabel, "模範回答");
  assert.equal(q?.subText, chain[0].modelAnswer);
  assert.equal(boxes.find((b) => b.id === answerBoxId("n1", 1))?.subText, undefined);
});

test("折り返しは箱の幅に収まり、句読点を行頭に送らない", () => {
  const lines = wrapText("あいうえおかきくけこさしすせそ。たちつてと", 15);
  assert.equal(lines[0], "あいうえおかきくけこさしすせそ。");
  assert.equal(lines[1], "たちつてと");
  assert.deepEqual(wrapText("", 15), [""]);
});
