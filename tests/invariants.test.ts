/**
 * 不変条件のテスト（REQUIREMENTS.md §6.3 テスト戦略）
 *
 * 資料番号の整合はエクスポートの実用性に直結するため最優先でテストする。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvariantError,
  assertCitationRules,
  assertNoCycle,
  assertRefNumbersConsistent,
  assertRefsWithinVariant,
  extractRefNumbers,
  renumberSourceRefs,
} from "../src/domain/invariants.ts";
import type {
  CaseVariant,
  Claim,
  CrossExamNode,
  SourceRequirement,
} from "../src/domain/types.ts";

function claim(id: string, refIds: string[], text: string): Claim {
  return {
    id,
    categoryIds: [],
    title: `主張${id}`,
    claim: text,
    warrant: "",
    sourceRefIds: refIds,
    causalChain: [],
    impact: "",
  };
}

function ref(id: string, number: number): SourceRequirement {
  return {
    id,
    number,
    materialId: `mat_${id}`,
    supportsClaimIds: [],
    categoryIds: [],
    description: "",
    searchKeywords: [],
    suggestedSourceIds: [],
    formatHint: "quote",
  };
}

function variant(
  refs: SourceRequirement[],
  claims: Claim[],
  fullText: string,
): CaseVariant {
  return {
    id: "var_1",
    side: "affirmative",
    framework: "租税公平主義",
    approach: "環境変化型",
    role: "candidate",
    sourceRefs: refs,
    debateCase: {
      side: "affirmative",
      valuePremise: "",
      claim: "所得税法56条および57条を廃止するべきである。",
      conclusion: "以上より、廃止するべきである。",
      fullText,
      sections: [
        { id: "sec_1", title: "問題点", type: "criteria", subsections: claims },
      ],
    },
  };
}

test("資料番号を登場順に1..Nへ再採番し、本文中の【資料N参照】も書き換える", () => {
  // 本文では 資料5 → 資料2 の順に登場するが、番号は 5 と 2 のまま
  const refs = [ref("r_a", 5), ref("r_b", 2)];
  const claims = [
    claim("c1", ["r_a"], "担税力に反する【資料5参照】。"),
    claim("c2", ["r_b"], "公平に反する【資料2参照】。"),
  ];
  const fullText = "担税力に反する【資料5参照】。\n公平に反する【資料2参照】。";

  const result = renumberSourceRefs(variant(refs, claims, fullText));

  assert.deepEqual(
    result.sourceRefs.map((r) => [r.id, r.number]),
    [
      ["r_a", 1],
      ["r_b", 2],
    ],
  );
  assert.ok(result.debateCase.fullText.includes("【資料1参照】"));
  assert.ok(result.debateCase.fullText.includes("【資料2参照】"));
  assert.ok(!result.debateCase.fullText.includes("【資料5参照】"));
});

test("【法37条1項、資料2参照】のような複合マーカーも番号だけ書き換える", () => {
  const refs = [ref("r_a", 2)];
  const claims = [claim("c1", ["r_a"], "必要経費【法37条1項、資料2参照】。")];
  const result = renumberSourceRefs(
    variant(refs, claims, "必要経費【法37条1項、資料2参照】。"),
  );
  assert.ok(result.debateCase.fullText.includes("【法37条1項、資料1参照】"));
});

test("本文で参照の順序を入れ替えたら、番号も読み順に振り直される", () => {
  // sourceRefIds の順は r_a, r_b だが、本文では 資料5(r_a) より先に 資料2(r_b) が出る。
  // 人が本文を編集して順序を入れ替えた状況にあたる。
  const refs = [ref("r_a", 5), ref("r_b", 2)];
  const claims = [
    claim("c1", ["r_a", "r_b"], "まず公平【資料2参照】、次に担税力【資料5参照】。"),
  ];
  const result = renumberSourceRefs(
    variant(refs, claims, "まず公平【資料2参照】、次に担税力【資料5参照】。"),
  );

  // 本文の登場順に従って r_b が1番になる
  assert.equal(result.sourceRefs.find((r) => r.id === "r_b")?.number, 1);
  assert.equal(result.sourceRefs.find((r) => r.id === "r_a")?.number, 2);
  assert.equal(
    result.debateCase.sections[0].subsections[0].claim,
    "まず公平【資料1参照】、次に担税力【資料2参照】。",
  );
});

test("本文にマーカーがない参照は、マーカー付きの後ろに回る", () => {
  const refs = [ref("r_a", 1), ref("r_b", 2)];
  // r_a は参照しているだけで本文にマーカーがない。r_b だけ本文に出る
  const claims = [claim("c1", ["r_a", "r_b"], "本文【資料2参照】。")];
  const result = renumberSourceRefs(variant(refs, claims, "本文【資料2参照】。"));

  assert.equal(result.sourceRefs.find((r) => r.id === "r_b")?.number, 1);
  assert.equal(result.sourceRefs.find((r) => r.id === "r_a")?.number, 2);
});

test("本文から参照されていない資料要件も削除せず末尾に残す", () => {
  const refs = [ref("r_a", 1), ref("r_orphan", 2)];
  const claims = [claim("c1", ["r_a"], "【資料1参照】")];
  const result = renumberSourceRefs(variant(refs, claims, "【資料1参照】"));
  assert.equal(result.sourceRefs.length, 2);
  assert.equal(result.sourceRefs.find((r) => r.id === "r_orphan")?.number, 2);
});

test("別パターンの資料を参照していたら弾く", () => {
  const v = variant([ref("r_a", 1)], [claim("c1", ["r_other"], "…")], "");
  assert.throws(() => assertRefsWithinVariant(v), (e: unknown) => {
    assert.ok(e instanceof InvariantError);
    assert.equal(e.code, "REF_OUT_OF_SCOPE");
    return true;
  });
});

test("本文の資料番号に対応する資料要件がなければ弾く", () => {
  const v = variant([ref("r_a", 1)], [claim("c1", ["r_a"], "")], "【資料9参照】");
  assert.throws(() => assertRefNumbersConsistent(v), (e: unknown) => {
    assert.ok(e instanceof InvariantError);
    assert.equal(e.code, "REF_NUMBER_MISMATCH");
    return true;
  });
});

test("本文から資料番号を抽出する", () => {
  assert.deepEqual(
    extractRefNumbers("【資料3参照】と【法14条、資料1参照】と【資料3参照】"),
    [1, 3],
  );
});

test("質疑フローの循環を検出する", () => {
  const nodes: CrossExamNode[] = [
    {
      id: "q1",
      direction: "attack",
      categoryIds: [],
      question: "?",
      purpose: "",
      branches: [{ expectedAnswer: "はい", followUpNodeId: "q2" }],
    },
    {
      id: "q2",
      direction: "attack",
      categoryIds: [],
      question: "?",
      purpose: "",
      branches: [{ expectedAnswer: "はい", followUpNodeId: "q1" }],
    },
  ];
  assert.throws(() => assertNoCycle(nodes), (e: unknown) => {
    assert.ok(e instanceof InvariantError);
    assert.equal(e.code, "CROSS_EXAM_CYCLE");
    return true;
  });
});

test("分岐が合流するだけなら循環ではない", () => {
  const nodes: CrossExamNode[] = [
    {
      id: "q1",
      direction: "attack",
      categoryIds: [],
      question: "?",
      purpose: "",
      branches: [
        { expectedAnswer: "はい", followUpNodeId: "q3" },
        { expectedAnswer: "いいえ", followUpNodeId: "q2" },
      ],
    },
    {
      id: "q2",
      direction: "attack",
      categoryIds: [],
      question: "?",
      purpose: "",
      branches: [{ expectedAnswer: "…", followUpNodeId: "q3" }],
    },
    {
      id: "q3",
      direction: "attack",
      categoryIds: [],
      question: "?",
      purpose: "",
      branches: [],
    },
  ];
  assert.doesNotThrow(() => assertNoCycle(nodes));
});

test("引用文があるのに出典がなければ弾く", () => {
  assert.throws(
    () =>
      assertCitationRules({
        id: "m1",
        provesWhat: "租税公平主義の定義",
        sourceType: "book",
        status: "found",
        quote: "税負担は国民の間に担税力に即して…",
        isModified: false,
      }),
    (e: unknown) => {
      assert.ok(e instanceof InvariantError);
      assert.equal(e.code, "CITATION_REQUIRED");
      return true;
    },
  );
});

test("下線を加えたのに注記がなければ弾く", () => {
  assert.throws(
    () =>
      assertCitationRules({
        id: "m1",
        provesWhat: "…",
        sourceType: "book",
        status: "found",
        quote: "…",
        citation: "金子宏『租税法〔第24版〕』（弘文堂・2021年）88頁",
        isModified: true,
      }),
    (e: unknown) => {
      assert.ok(e instanceof InvariantError);
      assert.equal(e.code, "MODIFICATION_NOTE_REQUIRED");
      return true;
    },
  );
});
