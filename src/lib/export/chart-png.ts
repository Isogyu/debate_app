/**
 * グラフの SVG → PNG 変換（Word に貼るため。v6 要件 §3.4・F12）
 *
 * Word は SVG をそのまま貼っても古い版で表示できないことがあるため PNG にする。
 * resvg は OS のフォントしか使えない。日本語フォントがないと文字が豆腐（□）になるので、
 * Dockerfile で fonts-noto-cjk を入れ、ここでもその場所を明示して読む。
 * 変換に失敗しても Word の出力自体は止めない（表だけ載せて注記する）。
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Resvg as ResvgClass } from "@resvg/resvg-js";

/** Debian の fonts-noto-cjk・macOS・Windows でよくある日本語フォントの場所 */
const FONT_FILE_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
  "C:\\Windows\\Fonts\\YuGothR.ttc",
  "C:\\Windows\\Fonts\\meiryo.ttc",
];

let cachedFontFiles: string[] | null = null;

function fontFiles(): string[] {
  if (cachedFontFiles) return cachedFontFiles;
  const extra = process.env.DEBATE_CHART_FONT ? [process.env.DEBATE_CHART_FONT] : [];
  cachedFontFiles = [...extra, ...FONT_FILE_CANDIDATES].filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });
  return cachedFontFiles;
}

type ResvgModule = { Resvg: typeof ResvgClass };
let resvgModule: ResvgModule | null | undefined;

/**
 * ネイティブモジュールはバンドルさせず、実行時に Node の require で読む。
 * （バンドラーが .node ファイルを解釈できず build が落ちるのを避ける）
 */
function loadResvg(): ResvgModule | null {
  if (resvgModule !== undefined) return resvgModule;
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const name = ["@resvg", "resvg-js"].join("/");
    resvgModule = req(name) as ResvgModule;
  } catch (err) {
    console.error("[chart-png] resvg を読み込めませんでした", err);
    resvgModule = null;
  }
  return resvgModule;
}

/** 日本語フォントが見つかるか（エクスポート画面の注意表示に使える） */
export function hasJapaneseChartFont(): boolean {
  return fontFiles().length > 0;
}

/**
 * SVG を指定幅の PNG にする。失敗したら null（呼び出し側は表だけにする）。
 * 日本語フォントが1つも見つからない場合も、豆腐のグラフを載せるより良いので null を返す。
 */
export function svgToPng(svg: string, width: number): Buffer | null {
  const mod = loadResvg();
  if (!mod) return null;
  const files = fontFiles();
  if (files.length === 0) {
    console.error(
      "[chart-png] 日本語フォントが見つかりません。fonts-noto-cjk を入れてください",
    );
    return null;
  }
  try {
    const resvg = new mod.Resvg(svg, {
      fitTo: { mode: "width", value: width },
      background: "#ffffff",
      font: {
        fontFiles: files,
        // システム全体を走査すると遅いので、見つけたファイルだけを使う
        loadSystemFonts: false,
        defaultFontFamily: "Noto Sans CJK JP",
        sansSerifFamily: "Noto Sans CJK JP",
      },
      logLevel: "off",
    });
    return Buffer.from(resvg.render().asPng());
  } catch (err) {
    console.error("[chart-png] グラフの変換に失敗しました", err);
    return null;
  }
}
