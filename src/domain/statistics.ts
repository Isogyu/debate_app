/**
 * 統計の計算と比較の前提の検査（v6 要件 §1-9 / 計画 §6.2）
 *
 * 数値はすべてコードが入れる。AI が決めるのは「どの数値にどの計算をするか」だけ。
 * 計算過程（元の数値 → 式 → 結果）を資料に載せ、誰でも再現できるようにする。
 */

import type {
  ComparabilityCheck,
  StatisticFormula,
  StatisticInput,
  StatisticOperation,
  StatisticResult,
} from "./types";

export class StatisticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatisticError";
  }
}

const OP_SYMBOL: Record<StatisticOperation, string> = {
  ratio: "÷",
  percent: "÷",
  growth: "−",
  difference: "−",
  per_capita: "÷",
  share: "÷",
};

export const OPERATION_LABELS: Record<StatisticOperation, string> = {
  ratio: "比率（A÷B）",
  percent: "割合（A÷B×100）",
  growth: "増減率（(A−B)÷B×100）",
  difference: "差（A−B）",
  per_capita: "一人当たり（A÷B）",
  share: "構成比（A÷B×100）",
};

export function applyOperation(
  op: StatisticOperation,
  a: number,
  b: number,
): number {
  switch (op) {
    case "difference":
      return a - b;
    case "ratio":
    case "per_capita":
      if (b === 0) throw new StatisticError("0 で割る計算になっています。");
      return a / b;
    case "percent":
    case "share":
      if (b === 0) throw new StatisticError("0 で割る計算になっています。");
      return (a / b) * 100;
    case "growth":
      if (b === 0) throw new StatisticError("基準の値が 0 のため増減率を出せません。");
      return ((a - b) / b) * 100;
  }
}

/** 表示用の丸め。割合は小数1桁、それ以外は有効数字を保って3桁区切り */
export function formatNumber(value: number, unit: string): string {
  const pct = unit === "%" || unit === "％" || unit === "ポイント";
  const digits = pct ? 1 : Math.abs(value) >= 100 ? 0 : 2;
  const rounded = Number(value.toFixed(digits));
  return `${rounded.toLocaleString("ja-JP", {
    minimumFractionDigits: pct ? 1 : 0,
    maximumFractionDigits: digits,
  })}${unit}`;
}

/**
 * 式を順に評価する。式は入力か、前に出た式の結果を参照できる。
 * 参照先がない・循環している場合は例外（AI の指定ミスを保存しない）。
 */
export function evaluateFormulas(
  inputs: StatisticInput[],
  formulas: StatisticFormula[],
): StatisticResult[] {
  const values = new Map<string, { value: number; unit: string; label: string }>();
  for (const i of inputs) {
    if (!Number.isFinite(i.value)) {
      throw new StatisticError(`「${i.label}」の値が数値ではありません。`);
    }
    values.set(i.key, { value: i.value, unit: i.unit, label: i.label });
  }

  const results: StatisticResult[] = [];
  for (const f of formulas) {
    const a = values.get(f.a);
    const b = values.get(f.b);
    if (!a || !b) {
      throw new StatisticError(
        `式「${f.label}」が存在しない値（${!a ? f.a : f.b}）を参照しています。`,
      );
    }
    const value = applyOperation(f.operation, a.value, b.value);
    const unit =
      f.operation === "percent" || f.operation === "share" || f.operation === "growth"
        ? "%"
        : f.unit;
    const expression = describeExpression(f.operation, a, b, value, unit);
    results.push({ key: f.key, label: f.label, value, unit, expression });
    values.set(f.key, { value, unit, label: f.label });
  }
  return results;
}

function describeExpression(
  op: StatisticOperation,
  a: { value: number; unit: string; label: string },
  b: { value: number; unit: string; label: string },
  result: number,
  unit: string,
): string {
  const A = `${a.label}（${formatNumber(a.value, a.unit)}）`;
  const B = `${b.label}（${formatNumber(b.value, b.unit)}）`;
  const r = formatNumber(result, unit);
  switch (op) {
    case "growth":
      return `(${A} ${OP_SYMBOL[op]} ${B}) ÷ ${B} × 100 = ${r}`;
    case "percent":
    case "share":
      return `${A} ÷ ${B} × 100 = ${r}`;
    default:
      return `${A} ${OP_SYMBOL[op]} ${B} = ${r}`;
  }
}

/** 名目／実質の区別が表題に出ているか */
function realOrNominal(text: string): "real" | "nominal" | null {
  if (/実質/.test(text)) return "real";
  if (/名目/.test(text)) return "nominal";
  return null;
}

/**
 * 比較の前提がそろっているか（§1-9「比較の前提」）。
 * 計算に一緒に使った入力どうしを比べる。機械的に分からない項目は null（要確認）。
 */
export function checkComparability(
  inputs: StatisticInput[],
  formulas: StatisticFormula[],
): ComparabilityCheck[] {
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const pairs: [StatisticInput, StatisticInput, StatisticFormula][] = [];
  for (const f of formulas) {
    const a = byKey.get(f.a);
    const b = byKey.get(f.b);
    if (a && b) pairs.push([a, b, f]);
  }
  if (pairs.length === 0) {
    return [
      {
        aspect: "年次",
        ok: null,
        note: "計算を伴わない資料のため、比較の前提の検査は行っていません。",
      },
    ];
  }

  const checks: ComparabilityCheck[] = [];
  for (const [a, b, f] of pairs) {
    const name = `式「${f.label}」`;
    // 増減率・差は年次が違って当然（時点比較）。それ以外は同じ年次でなければならない
    const timeSeries = f.operation === "growth" || f.operation === "difference";
    if (!timeSeries) {
      checks.push({
        aspect: "年次",
        ok: a.year === b.year,
        note:
          a.year === b.year
            ? `${name}: どちらも ${a.year}`
            : `${name}: 年次が違います（${a.label}=${a.year}、${b.label}=${b.year}）`,
      });
    } else {
      checks.push({
        aspect: "年次",
        ok: a.year !== b.year ? true : null,
        note: `${name}: ${b.year} → ${a.year} の比較`,
      });
    }

    const sameTable = a.tableId === b.tableId;
    checks.push({
      aspect: "定義",
      ok: sameTable ? true : null,
      note: sameTable
        ? `${name}: 同じ統計表（${a.tableTitle}）の値`
        : `${name}: 別の統計表の値です。用語の定義が同じか確認してください（${a.statName} / ${b.statName}）`,
    });

    // 割合・差・増減率は同じ単位どうしでないと意味がない。一人当たりは違ってよい
    const needsSameUnit = f.operation !== "per_capita" && f.operation !== "ratio";
    if (needsSameUnit) {
      checks.push({
        aspect: "単位",
        ok: a.unit === b.unit,
        note:
          a.unit === b.unit
            ? `${name}: どちらも「${a.unit}」`
            : `${name}: 単位が違います（${a.unit} と ${b.unit}）`,
      });
    }

    const ra = realOrNominal(a.tableTitle + a.label);
    const rb = realOrNominal(b.tableTitle + b.label);
    if (ra || rb) {
      checks.push({
        aspect: "名目/実質",
        ok: ra === rb ? true : ra && rb ? false : null,
        note:
          ra === rb
            ? `${name}: どちらも${ra === "real" ? "実質" : "名目"}値`
            : `${name}: 名目値と実質値が混ざっている可能性があります`,
      });
    }

    checks.push({
      aspect: "対象範囲",
      ok: sameTable ? true : null,
      note: sameTable
        ? `${name}: 同じ表の中での比較`
        : `${name}: 調査対象（全国／事業所規模など）がそろっているか確認してください`,
    });
  }
  return checks;
}

/** 数字の突き合わせ用。表記ゆれ（全角・カンマ・％）を吸収して数値にする */
export function parseJapaneseNumber(text: string): number | null {
  const t = text.normalize("NFKC").replace(/,/g, "").trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*(兆|億|万|千)?/);
  if (!m) return null;
  let v = Number(m[1]);
  const mult: Record<string, number> = { 兆: 1e12, 億: 1e8, 万: 1e4, 千: 1e3 };
  if (m[2]) v *= mult[m[2]];
  return Number.isFinite(v) ? v : null;
}

/** 本文の数字と資料の数字がおおむね一致するか（丸めの差は許す） */
export function roughlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  // 表示の丸め（小数1桁・有効数字3桁）で生じる差まで許す
  return Math.abs(a - b) <= Math.max(0.051, scale * 0.005);
}
