/**
 * 統計資料のグラフ（SVG）。v6 要件 §3.4「表＋グラフ画像」
 *
 * Word 用の PNG（chart-png.ts）と印刷画面の両方でこの SVG を使う。
 * 参考資料は白黒で印刷されることが多いため、色ではなく
 * 斜線の模様・白抜きの点・数値ラベルで読めるようにする。
 *
 * 純粋関数だけを置く（テストから直接読むため "@/" の別名は使わない）。
 */

import { formatNumber } from "../../domain/statistics.ts";
import type { StatisticData } from "../../domain/types.ts";

export type StatisticChart = NonNullable<StatisticData["chart"]>;

export interface ChartSvgOptions {
  width?: number;
  height?: number;
  /** resvg で描くときは実在する日本語フォント名を先頭にする */
  fontFamily?: string;
}

export const CHART_FONT_FAMILY =
  "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif";

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 目盛りの刻み。1・2・5×10^n のどれかにそろえると読みやすい */
export function niceStep(range: number, targetTicks = 5): number {
  if (!(range > 0)) return 1;
  const raw = range / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** 軸の範囲。棒グラフは必ず0を含める（0から始めないと差が誇張される） */
export function axisRange(
  values: number[],
  includeZero: boolean,
): { min: number; max: number; step: number } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) {
    // 全部同じ値のときも軸が潰れないように幅を持たせる
    const pad = Math.abs(lo) || 1;
    if (includeZero) {
      hi = lo === 0 ? 1 : hi; // ここに来るのは全部0のときだけ
    } else {
      lo -= pad;
      hi += pad;
    }
  }
  const step = niceStep(hi - lo);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return { min, max: max === min ? min + step : max, step };
}

/** 目盛りの数値。浮動小数の誤差（0.30000000000000004 等）を出さない */
function tickLabel(v: number, step: number): string {
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(v.toFixed(digits)).toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
  });
}

/** 横軸ラベルの折り返し。日本語は単語区切りがないので字数で切る */
function wrapLabel(label: string, perLine: number, maxLines = 2): string[] {
  const chars = [...label];
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(""));
  }
  if (chars.length > perLine * maxLines) {
    const last = [...lines[maxLines - 1]];
    lines[maxLines - 1] = last.slice(0, Math.max(1, perLine - 1)).join("") + "…";
  }
  return lines;
}

export function statisticChartSvg(
  chart: StatisticChart,
  opts: ChartSvgOptions = {},
): string {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const font = opts.fontFamily ?? CHART_FONT_FAMILY;
  const points = chart.points.filter((p) => Number.isFinite(p.value));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(font)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    // 白黒印刷でも棒が見分けられる斜線模様
    `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">` +
      `<rect width="8" height="8" fill="#ffffff"/><line x1="0" y1="0" x2="0" y2="8" stroke="#000000" stroke-width="3"/></pattern></defs>`,
    `<text x="${width / 2}" y="26" font-size="18" font-weight="bold" text-anchor="middle" fill="#000000">${escapeXml(chart.title)}</text>`,
  );
  if (chart.unit) {
    parts.push(
      `<text x="${width - 16}" y="48" font-size="12" text-anchor="end" fill="#000000">（単位：${escapeXml(chart.unit)}）</text>`,
    );
  }

  if (points.length === 0) {
    parts.push(
      `<text x="${width / 2}" y="${height / 2}" font-size="14" text-anchor="middle" fill="#000000">グラフにできる数値がありません</text>`,
      `</svg>`,
    );
    return parts.join("");
  }

  const isBar = chart.type === "bar";
  const range = axisRange(
    points.map((p) => p.value),
    isBar,
  );
  const left = 72;
  const right = 24;
  const top = 64;
  const bottom = 64;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const y = (v: number) =>
    top + plotH - ((v - range.min) / (range.max - range.min)) * plotH;

  // 目盛りと補助線（薄い破線。色ではなく線種で主線と区別する）
  for (let v = range.min; v <= range.max + range.step / 1000; v += range.step) {
    const yy = y(v).toFixed(1);
    parts.push(
      `<line x1="${left}" y1="${yy}" x2="${left + plotW}" y2="${yy}" stroke="#999999" stroke-width="0.8" stroke-dasharray="3 3"/>`,
      `<text x="${left - 8}" y="${(Number(yy) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#000000">${escapeXml(tickLabel(v, range.step))}</text>`,
    );
  }
  // 軸
  const zeroY = y(Math.max(range.min, Math.min(range.max, 0)));
  parts.push(
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#000000" stroke-width="1.5"/>`,
    `<line x1="${left}" y1="${(isBar ? zeroY : top + plotH).toFixed(1)}" x2="${left + plotW}" y2="${(isBar ? zeroY : top + plotH).toFixed(1)}" stroke="#000000" stroke-width="1.5"/>`,
  );

  const n = points.length;
  const slot = plotW / n;
  const labelSize = n > 8 ? 10 : 12;
  const valueSize = n > 8 ? 9 : 11;
  const perLine = Math.max(2, Math.floor(slot / labelSize));

  points.forEach((p, i) => {
    const cx = left + slot * (i + 0.5);
    const lines = wrapLabel(p.label, perLine);
    parts.push(
      `<text font-size="${labelSize}" text-anchor="middle" fill="#000000">` +
        lines
          .map(
            (l, j) =>
              `<tspan x="${cx.toFixed(1)}" y="${(top + plotH + 18 + j * (labelSize + 3)).toFixed(1)}">${escapeXml(l)}</tspan>`,
          )
          .join("") +
        `</text>`,
    );
  });

  if (isBar) {
    const barW = Math.min(64, slot * 0.6);
    points.forEach((p, i) => {
      const cx = left + slot * (i + 0.5);
      const yv = y(p.value);
      const y0 = Math.min(yv, zeroY);
      const h = Math.max(1, Math.abs(zeroY - yv));
      parts.push(
        `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="url(#hatch)" stroke="#000000" stroke-width="1.5"/>`,
      );
      // 負の値はラベルを棒の下に置く
      const ly = p.value < 0 ? y0 + h + valueSize + 4 : y0 - 6;
      parts.push(valueLabel(cx, ly, p.value, chart.unit, valueSize));
    });
  } else {
    const coords = points.map((p, i) => ({
      x: left + slot * (i + 0.5),
      y: y(p.value),
      value: p.value,
    }));
    parts.push(
      `<polyline points="${coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#000000" stroke-width="2"/>`,
    );
    for (const c of coords) {
      // 白抜きの丸で点を示す（色に頼らない）
      parts.push(
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="#ffffff" stroke="#000000" stroke-width="2"/>`,
        valueLabel(c.x, c.y - 10, c.value, chart.unit, valueSize),
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function valueLabel(
  x: number,
  y: number,
  value: number,
  unit: string,
  size: number,
): string {
  // 白い縁取りで補助線と重なっても読めるようにする
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="bold" text-anchor="middle" fill="#000000" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(formatNumber(value, unit))}</text>`;
}
