/**
 * 統計資料のグラフ（src/lib/export/chart-svg.ts）
 *
 * 参考資料は白黒で印刷されることが多い。色が消えても読めること、
 * 数値ラベルが計算と同じ丸めで出ること、文字が壊れないことを確かめる。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  axisRange,
  escapeXml,
  niceStep,
  statisticChartSvg,
} from "../src/lib/export/chart-svg.ts";
import { formatNumber } from "../src/domain/statistics.ts";

const bar = {
  type: "bar" as const,
  title: "家族従業者の割合",
  unit: "%",
  points: [
    { label: "1950年", value: 61.23 },
    { label: "2023年", value: 3.3 },
  ],
};

test("棒グラフ: 題名・単位・横軸ラベル・数値ラベルが入る", () => {
  const svg = statisticChartSvg(bar);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("家族従業者の割合"));
  assert.ok(svg.includes("（単位：%）"));
  assert.ok(svg.includes("1950年"));
  assert.ok(svg.includes(formatNumber(61.23, "%")));
  assert.ok(svg.includes(formatNumber(3.3, "%")));
});

test("棒グラフ: 色だけに頼らず斜線の模様と黒枠で描く", () => {
  const svg = statisticChartSvg(bar);
  assert.ok(svg.includes('<pattern id="hatch"'));
  const rects = svg.match(/<rect [^>]*fill="url\(#hatch\)"[^>]*>/g) ?? [];
  assert.equal(rects.length, 2);
  for (const r of rects) assert.ok(r.includes('stroke="#000000"'));
});

test("折れ線グラフ: 線と白抜きの点を描く", () => {
  const svg = statisticChartSvg({
    type: "line",
    title: "推移",
    unit: "億円",
    points: [
      { label: "2020", value: 1200 },
      { label: "2021", value: 1350 },
      { label: "2022", value: 1100 },
    ],
  });
  assert.ok(svg.includes("<polyline"));
  assert.equal((svg.match(/<circle /g) ?? []).length, 3);
  assert.ok(svg.includes('fill="#ffffff" stroke="#000000"'));
  assert.ok(svg.includes(formatNumber(1350, "億円")));
});

test("記号を含む文字はエスケープする（SVGが壊れない）", () => {
  const svg = statisticChartSvg({
    type: "bar",
    title: "A&B <比較>",
    unit: "人",
    points: [{ label: "\"x\"", value: 1 }],
  });
  assert.ok(svg.includes("A&amp;B &lt;比較&gt;"));
  assert.ok(!svg.includes("<比較>"));
  assert.equal(escapeXml(`'`), "&apos;");
});

test("点がないときは、その旨を書いた SVG を返す", () => {
  const svg = statisticChartSvg({ type: "bar", title: "空", unit: "", points: [] });
  assert.ok(svg.includes("グラフにできる数値がありません"));
});

test("負の値の棒も描ける", () => {
  const svg = statisticChartSvg({
    type: "bar",
    title: "増減",
    unit: "%",
    points: [
      { label: "A", value: -5 },
      { label: "B", value: 10 },
    ],
  });
  assert.ok(svg.includes(formatNumber(-5, "%")));
  assert.ok(!svg.includes("NaN"));
});

test("軸の範囲: 棒グラフは0を含み、刻みは1・2・5系", () => {
  const r = axisRange([61.23, 3.3], true);
  assert.equal(r.min, 0);
  assert.ok(r.max >= 61.23);
  assert.equal(r.step, 20);
  assert.equal(niceStep(100), 20);
  assert.equal(niceStep(0.9), 0.2);
  const same = axisRange([0, 0], true);
  assert.ok(same.max > same.min);
  const line = axisRange([1200, 1350, 1100], false);
  assert.ok(line.min > 0 && line.min <= 1100);
});
