/**
 * データモデルの不変条件（REQUIREMENTS.md §7.1）
 *
 * ここが崩れると「立論の【資料N参照】と参考資料の番号がずれる」という
 * エクスポートが実用に耐えない状態になるため、保存前に必ず通す。
 */

import type {
  CaseVariant,
  DebateCase,
  SourceMaterial,
  SourceRequirement,
} from "./types";

export class InvariantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvariantError";
    this.code = code;
  }
}

/** 本文中の資料参照マーカー。`【資料3参照】` `【法37条1項、資料2参照】` の両形に対応する */
const REF_MARKER = /【([^】]*?)資料(\d+)参照】/g;

/**
 * 不変条件1: 資料番号を 1..N に再採番し、本文中の【資料N参照】も同時に書き換える。
 *
 * 採番順は「立論に登場する順」。参考資料の並び順と読み上げ順が一致し、
 * 実物のフォーマット（§2.3）と同じになる。
 */
export function renumberSourceRefs(variant: CaseVariant): CaseVariant {
  const appearanceOrder: string[] = [];
  const refIdByOldNumber = new Map(
    variant.sourceRefs.map((r) => [r.number, r.id]),
  );

  // まず本文中の【資料N参照】を読み上げ順に拾う。
  // 人が本文を編集して参照の順序を入れ替えても、番号が読み順に従うようにする。
  for (const text of walkCaseTexts(variant.debateCase)) {
    for (const m of text.matchAll(REF_MARKER)) {
      const refId = refIdByOldNumber.get(Number(m[2]));
      if (refId && !appearanceOrder.includes(refId)) appearanceOrder.push(refId);
    }
  }
  // 次に、本文にマーカーはないがClaimが参照している資料
  for (const section of variant.debateCase.sections) {
    for (const claim of section.subsections) {
      for (const refId of claim.sourceRefIds) {
        if (!appearanceOrder.includes(refId)) appearanceOrder.push(refId);
      }
    }
  }
  // 最後に、どこからも参照されていない資料要件。削除はしない
  for (const ref of variant.sourceRefs) {
    if (!appearanceOrder.includes(ref.id)) appearanceOrder.push(ref.id);
  }

  const oldNumberById = new Map(variant.sourceRefs.map((r) => [r.id, r.number]));
  const newNumberById = new Map<string, number>();
  appearanceOrder.forEach((id, i) => newNumberById.set(id, i + 1));

  // 旧番号 → 新番号 の対応表を作り、本文を一括置換する
  const oldToNew = new Map<number, number>();
  for (const [id, oldNo] of oldNumberById) {
    const newNo = newNumberById.get(id);
    if (newNo !== undefined) oldToNew.set(oldNo, newNo);
  }

  const sourceRefs: SourceRequirement[] = variant.sourceRefs
    .map((r) => ({ ...r, number: newNumberById.get(r.id) ?? r.number }))
    .sort((a, b) => a.number - b.number);

  return {
    ...variant,
    sourceRefs,
    debateCase: rewriteRefMarkers(variant.debateCase, oldToNew),
  };
}

/** 本文を読み上げ順（renderFullTextと同じ順序）でたどる */
function* walkCaseTexts(debateCase: DebateCase): Generator<string> {
  yield debateCase.claim;
  for (const section of debateCase.sections) {
    for (const sub of section.subsections) {
      yield sub.claim;
      yield sub.warrant;
      yield sub.impact;
      for (const step of sub.causalChain) yield step;
    }
  }
  yield debateCase.conclusion;
}

function rewriteRefMarkers(
  debateCase: DebateCase,
  oldToNew: Map<number, number>,
): DebateCase {
  const rewrite = (text: string) =>
    text.replace(REF_MARKER, (whole, prefix: string, digits: string) => {
      const next = oldToNew.get(Number(digits));
      return next === undefined ? whole : `【${prefix}資料${next}参照】`;
    });

  return {
    ...debateCase,
    claim: rewrite(debateCase.claim),
    conclusion: rewrite(debateCase.conclusion),
    fullText: rewrite(debateCase.fullText),
    sections: debateCase.sections.map((s) => ({
      ...s,
      subsections: s.subsections.map((c) => ({
        ...c,
        claim: rewrite(c.claim),
        warrant: rewrite(c.warrant),
        impact: rewrite(c.impact),
        causalChain: c.causalChain.map(rewrite),
      })),
    })),
  };
}

/** 本文中に実在する資料番号を抽出する（エクスポート前の整合チェック用） */
export function extractRefNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(REF_MARKER)) found.add(Number(m[2]));
  return [...found].sort((a, b) => a - b);
}

/**
 * 不変条件2: Claim が指す資料参照は、同じバリエーション内に存在しなければならない。
 * パターンをまたぐ参照を作らないための検査。
 */
export function assertRefsWithinVariant(variant: CaseVariant): void {
  const known = new Set(variant.sourceRefs.map((r) => r.id));
  for (const section of variant.debateCase.sections) {
    for (const claim of section.subsections) {
      for (const refId of claim.sourceRefIds) {
        if (!known.has(refId)) {
          throw new InvariantError(
            "REF_OUT_OF_SCOPE",
            `立論「${claim.title}」が、このパターンに存在しない資料を参照しています。`,
          );
        }
      }
    }
  }
}

/** 本文の【資料N参照】と資料要件リストの番号が一致するか（エクスポート前チェック） */
export function assertRefNumbersConsistent(variant: CaseVariant): void {
  const declared = new Set(variant.sourceRefs.map((r) => r.number));
  const used = extractRefNumbers(variant.debateCase.fullText);
  const missing = used.filter((n) => !declared.has(n));
  if (missing.length > 0) {
    throw new InvariantError(
      "REF_NUMBER_MISMATCH",
      `立論本文の【資料${missing.join("】【資料")}】に対応する資料要件がありません。`,
    );
  }
}

/**
 * 不変条件3: 質疑フローの followUpNodeId が循環してはならない。
 * 循環したままツリーを描画すると無限ループする。
 */
export function assertNoCycle(
  nodes: { id: string; branches: { followUpNodeId?: string }[] }[],
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, "visiting" | "done">();

  const walk = (id: string, path: string[]): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      throw new InvariantError(
        "CROSS_EXAM_CYCLE",
        `質疑フローが循環しています: ${[...path, id].join(" → ")}`,
      );
    }
    state.set(id, "visiting");
    for (const branch of byId.get(id)?.branches ?? []) {
      if (branch.followUpNodeId && byId.has(branch.followUpNodeId)) {
        walk(branch.followUpNodeId, [...path, id]);
      }
    }
    state.set(id, "done");
  };

  for (const node of nodes) walk(node.id, []);
}

/**
 * 不変条件4: 引用文を登録するなら出典は必須。加工したなら注記も必須。
 * 法務観点（§6.2.1）でシステム側から強制する。
 */
export function assertCitationRules(
  material: Pick<SourceMaterial, "quote" | "citation" | "isModified" | "modificationNote">,
): void {
  if (material.quote && !material.citation?.trim()) {
    throw new InvariantError(
      "CITATION_REQUIRED",
      "引用文を登録するときは出典の入力が必要です。",
    );
  }
  if (material.isModified && !material.modificationNote?.trim()) {
    throw new InvariantError(
      "MODIFICATION_NOTE_REQUIRED",
      "下線などを加えた場合は「［下線はディベーターによる。］」のような注記が必要です。",
    );
  }
}

/** 保存前にまとめて検査する入口 */
export function validateVariant(variant: CaseVariant): CaseVariant {
  assertRefsWithinVariant(variant);
  const renumbered = renumberSourceRefs(variant);
  assertRefNumbersConsistent(renumbered);
  return renumbered;
}
