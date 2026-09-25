/**
 * v6 で追加したドメイン処理のテスト
 *  - 引用文の照合（§1-3）
 *  - 統計の計算・比較の前提（§1-9）
 *  - 数字の抽出（§1-9 出典の明記）
 *  - 質疑の網羅・8分セット・台本（§4・§5）
 *  - 登録の取り込み（§3.2）
 *  - 公的APIの応答の読み取り（§1-3a）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, normalizeForMatch, relevantExcerpt } from "../src/domain/quote.ts";
import {
  checkComparability,
  evaluateFormulas,
  formatNumber,
  roughlyEqual,
  StatisticError,
} from "../src/domain/statistics.ts";
import { extractNumbers } from "../src/domain/numbers.ts";
import {
  coverageGaps,
  estimateChainSeconds,
  mainPath,
  scriptTo,
  selectEightMinuteSet,
} from "../src/domain/cross-exam.ts";
import {
  applyCaseStructure,
  cleanHeading,
  numberingIssues,
  parseCheckedDate,
  parseMaterialsText,
} from "../src/domain/import-parse.ts";
import {
  articleToNum,
  egovNodeToText,
  findPdfLinks,
  kanjiToNumber,
  kokkaiCitation,
  parseEstatStatsData,
  parseEstatStatsList,
  parseKokkaiSpeeches,
} from "../src/domain/source-parsers.ts";
import { isAllowedSourceUrl } from "../src/domain/source-whitelist.ts";

// ── 引用文の照合 ────────────────────────────────────────
const DOC = `第一章　総則
　事業に従事する親族がその事業から対価の支払を受ける場合には、
その対価に相当する金額は、その居住者の事業所得の金額の計算上、必要経費に算入しないものとする。`;

test("空白・改行・全角半角の違いは吸収して一致とみなす", () => {
  const quote = "その対価に相当する金額は、その居住者の事業所得の金額の計算上、必要経費に算入しないものとする。";
  assert.ok(findQuote(DOC, quote).found);
  assert.ok(findQuote(DOC.replace(/\n/g, " "), quote).found);
});

test("語を入れ替えた引用・要約は一致しない", () => {
  assert.equal(findQuote(DOC, "その対価に相当する額は、事業所得の計算上、必要経費に入れないものとする。").found, false);
});

test("「…」で省略した引用は、本文そのままではないので採用しない", () => {
  assert.equal(findQuote(DOC, "事業に従事する親族が…必要経費に算入しないものとする。").found, false);
});

test("短すぎる引用は偶然の一致を避けるため採用しない", () => {
  assert.equal(findQuote(DOC, "必要経費").found, false);
});

test("PDFのページ番号を返す", () => {
  const text = "1ページ目の本文です。\n2ページ目には家族従業者の割合が大きく減少したとの記述がある。\n";
  const offsets = [0, text.indexOf("2ページ目")];
  const m = findQuote(text, "2ページ目には家族従業者の割合が大きく減少したとの記述がある。", offsets);
  assert.equal(m.page, 2);
});

test("正規化はNFKCで全角英数をそろえる", () => {
  assert.equal(normalizeForMatch("ＡＢＣ　１２３"), "ABC123");
});

test("長い本文からは検索語の周辺だけを切り出す", () => {
  const filler = "無関係な文章。".repeat(3000);
  const text = `${filler}青色事業専従者給与の相当性について判断する。${filler}`;
  const ex = relevantExcerpt(text, ["青色事業専従者"], 4000);
  assert.ok(ex.length <= 4000 + 20);
  assert.ok(ex.includes("青色事業専従者給与"));
});

// ── 統計の計算 ─────────────────────────────────────────
const inputs = [
  { key: "x1", label: "家族従業者", value: 1200, unit: "千人", year: "2022年", statName: "労働力調査", tableId: "T1", tableTitle: "従業上の地位別就業者数", url: "", locator: "" },
  { key: "x2", label: "女性就業者", value: 30000, unit: "千人", year: "2022年", statName: "労働力調査", tableId: "T1", tableTitle: "従業上の地位別就業者数", url: "", locator: "" },
  { key: "x3", label: "家族従業者（1990年）", value: 3000, unit: "千人", year: "1990年", statName: "労働力調査", tableId: "T1", tableTitle: "従業上の地位別就業者数", url: "", locator: "" },
];

test("割合・増減率をコードで計算し、計算過程を残す", () => {
  const results = evaluateFormulas(inputs, [
    { key: "f1", label: "家族従業者の割合", operation: "percent", a: "x1", b: "x2", unit: "%" },
    { key: "f2", label: "家族従業者の増減率", operation: "growth", a: "x1", b: "x3", unit: "%" },
  ]);
  assert.equal(results[0].value, 4);
  assert.equal(results[1].value, -60);
  assert.match(results[0].expression, /÷.*×\s*100\s*=\s*4\.0%/);
});

test("存在しない値を参照する式は保存しない", () => {
  assert.throws(
    () => evaluateFormulas(inputs, [{ key: "f1", label: "誤り", operation: "percent", a: "x1", b: "x9", unit: "%" }]),
    StatisticError,
  );
});

test("0で割る計算は止める", () => {
  assert.throws(
    () =>
      evaluateFormulas([{ ...inputs[0] }, { ...inputs[1], value: 0 }], [
        { key: "f1", label: "割合", operation: "percent", a: "x1", b: "x2", unit: "%" },
      ]),
    StatisticError,
  );
});

test("年次の違う値で割合を出すと比較の前提の検査で×になる", () => {
  const checks = checkComparability(inputs, [
    { key: "f1", label: "割合", operation: "percent", a: "x1", b: "x3", unit: "%" },
  ]);
  const year = checks.find((c) => c.aspect === "年次");
  assert.equal(year?.ok, false);
});

test("別の統計表どうしの比較は「要確認」にする", () => {
  const other = { ...inputs[1], tableId: "T2", statName: "国勢調査" };
  const checks = checkComparability([inputs[0], other], [
    { key: "f1", label: "割合", operation: "percent", a: "x1", b: "x2", unit: "%" },
  ]);
  assert.equal(checks.find((c) => c.aspect === "定義")?.ok, null);
});

test("数値の表示と丸めの許容", () => {
  assert.equal(formatNumber(4, "%"), "4.0%");
  assert.equal(formatNumber(1234567, "円"), "1,234,567円");
  assert.ok(roughlyEqual(61.5, 61.53));
  assert.ok(!roughlyEqual(61.5, 62.5));
});

// ── 数字の抽出 ─────────────────────────────────────────
test("数字の主張を拾い、同じ文の資料番号を結びつける", () => {
  const found = extractNumbers(
    "女性就業者のうち家族従業者は約61%であった【資料2参照】。一方で現在は3.3%にすぎない。",
    "（1）",
  );
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].refNumbers, [2]);
  assert.equal(found[0].value, 61);
  assert.deepEqual(found[1].refNumbers, []);
});

test("条番号・年・資料番号・見出し番号は数字の主張として拾わない", () => {
  const found = extractNumbers(
    "所得税法56条は昭和25年に創設された（1）。第3回の改正で令和5年度に見直された【資料3参照】。",
    "（1）",
  );
  assert.equal(found.length, 0);
});

test("三割のような漢数字の割合も拾う", () => {
  const found = extractNumbers("小規模事業者の三割が家族を雇っている。", "（2）");
  assert.equal(found[0]?.unit, "割");
  assert.equal(found[0]?.value, 3);
});

// ── 質疑 ───────────────────────────────────────────────
function node(id: string, chainId: string, order: number, followUps: (string | undefined)[], priority = 3) {
  return {
    id,
    chainId,
    chainOrder: order,
    question: "この制度は本当に必要ですか？",
    priority,
    stuckCount: 0,
    branches: followUps.map((f, i) => ({
      kind: (["admit", "deny", "evade"] as const)[i % 3],
      expectedAnswer: "必要です。",
      followUpNodeId: f,
    })),
  };
}

test("段落×攻撃点の抜けを数える。数字の弱点がある段落だけ数字の質問を必須にする", () => {
  const paragraphs = [
    { claimId: "c1", label: "（1）", order: 0 },
    { claimId: "c2", label: "（2）", order: 1 },
  ];
  const gaps = coverageGaps(
    paragraphs,
    [
      { targetClaimId: "c1", attackPoint: "premise" },
      { targetClaimId: "c1", attackPoint: "evidence" },
      { targetClaimId: "c1", attackPoint: "causality" },
      { targetClaimId: "c1", attackPoint: "impact" },
    ],
    new Set(["c2"]),
  );
  assert.equal(gaps.filter((g) => g.claimId === "c1").length, 0);
  assert.equal(gaps.filter((g) => g.claimId === "c2").length, 5);
});

test("連鎖の主経路と所要時間", () => {
  const nodes = [node("a", "ch1", 0, ["b", undefined]), node("b", "ch1", 1, ["c"]), node("c", "ch1", 2, [])];
  assert.deepEqual(mainPath(nodes, "ch1").map((n) => n.id), ["a", "b", "c"]);
  assert.ok(estimateChainSeconds(nodes, "ch1") > 18);
});

test("8分セットは時間の予算に収め、段落順に並べる", () => {
  const set = selectEightMinuteSet(
    [
      { chainId: "x", priority: 5, stuckCount: 0, paragraphOrder: 2, seconds: 200 },
      { chainId: "y", priority: 4, stuckCount: 0, paragraphOrder: 0, seconds: 200 },
      { chainId: "z", priority: 3, stuckCount: 0, paragraphOrder: 1, seconds: 200 },
    ],
    450,
  );
  assert.deepEqual([...set.entries()], [["y", 1], ["x", 2]]);
});

test("練習で詰まった連鎖は8分セットに入りやすくなる", () => {
  const set = selectEightMinuteSet(
    [
      { chainId: "p", priority: 4, stuckCount: 0, paragraphOrder: 0, seconds: 300 },
      { chainId: "q", priority: 3, stuckCount: 3, paragraphOrder: 1, seconds: 300 },
    ],
    450,
  );
  assert.ok(set.has("q"));
  assert.ok(!set.has("p"));
});

test("台本は起点から押したノードまでの経路を、通った分岐つきで並べる", () => {
  const nodes = [node("a", "ch1", 0, ["b", "c"]), node("b", "ch1", 1, []), node("c", "ch1", 1, [])];
  const lines = scriptTo(nodes, "c");
  assert.equal(lines.length, 3);
  assert.equal(lines[1].kind, "deny");
});

// ── 登録の取り込み ─────────────────────────────────────
const MATERIALS = `【資料1】

国税庁「税務行政のデジタル・トランスフォーメーション－税務行政の将来像2023－」
https://www.nta.go.jp/about/introduction/torikumi/digitaltransformation2023/index.htm
（最終確認日：2025年10月24日）
【資料２】
小企業における家族従業員の存在意義　日本政策金融公庫
https://www.jfc.go.jp/n/findings/pdf/ronbun1308_03.pdf（最終確認日：2025年10月24日）
小企業の従業員に家族従業員が含まれる割合は61.5%である。
`;

test("資料ファイルを【資料N】で区切り、出典・URL・最終確認日を読む", () => {
  const blocks = parseMaterialsText(MATERIALS);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].number, 2);
  assert.equal(blocks[0].lastCheckedAt, "2025-10-24");
  assert.match(blocks[0].url ?? "", /nta\.go\.jp/);
  assert.match(blocks[1].body, /61\.5%/);
});

test("立論と資料の番号が合わないところを指摘する", () => {
  const issues = numberingIssues("…である【資料1参照】。…(資料3)", parseMaterialsText(MATERIALS));
  assert.ok(issues.some((i) => i.severity === "error" && i.message.includes("資料3")));
  assert.ok(issues.some((i) => i.message.includes("資料2")));
});

test("確認日の表記ゆれを読む", () => {
  assert.equal(parseCheckedDate("閲覧日: 2024/4/1"), "2024-04-01");
});

test("区切りの行番号から、本文を書き換えずに構造化する", () => {
  const text = ["Ⅰ　主張", "56条を廃止するべきである。", "Ⅱ　理由", "1. 　制定当時との比較", "本文その1。", "本文その2。", "Ⅲ　結論", "廃止するべきである。"].join("\n");
  let n = 0;
  const dc = applyCaseStructure(
    text,
    {
      claim: [1, 1],
      sections: [{ titleLine: 3, type: "environment", subsections: [{ titleLine: 3, body: [4, 5] }] }],
      conclusion: [7, 7],
    },
    "affirmative",
    (p) => `${p}_${n++}`,
  );
  assert.equal(dc.claim, "56条を廃止するべきである。");
  assert.equal(dc.sections[0].title, "制定当時との比較");
  assert.equal(dc.sections[0].subsections[0].claim, "本文その1。本文その2。");
});

test("行の範囲が壊れていたら例外にする（ランナーがやり直す）", () => {
  assert.throws(() =>
    applyCaseStructure("a\nb", { claim: [0, 5], sections: [], conclusion: [1, 1] }, "negative", (p) => p),
  );
});

test("見出しの番号を落とす", () => {
  assert.equal(cleanHeading("（2）担税力に即した課税"), "担税力に即した課税");
  assert.equal(cleanHeading("2.　税務行政コストの増加"), "税務行政コストの増加");
});

// ── 公的APIの応答 ───────────────────────────────────────
test("条番号をe-Govの形式に直す", () => {
  assert.equal(kanjiToNumber("五十六"), 56);
  assert.equal(kanjiToNumber("百二十"), 120);
  assert.equal(articleToNum("第56条"), "56");
  assert.equal(articleToNum("第五十六条の二"), "56_2");
  assert.equal(articleToNum("所得税法"), null);
});

test("e-Govの条文JSONをテキストにする（ルビは除く）", () => {
  const text = egovNodeToText({
    tag: "Article",
    attr: { Num: "56" },
    children: [
      { tag: "ArticleCaption", children: ["（事業から対価を受ける親族がある場合の必要経費の特例）"] },
      { tag: "ArticleTitle", children: ["第五十六条"] },
      {
        tag: "Paragraph",
        children: [{ tag: "ParagraphSentence", children: [{ tag: "Sentence", children: ["居住者と", { tag: "Ruby", children: ["生計", { tag: "Rt", children: ["せいけい"] }] }, "を一にする"] }] }],
      },
    ],
  });
  assert.match(text, /第五十六条　居住者と生計を一にする/);
  assert.ok(!text.includes("せいけい"));
});

test("国会会議録の応答と、実物と同じ書式の出典", () => {
  const speeches = parseKokkaiSpeeches({
    speechRecord: [
      { speechID: "1", session: 211, nameOfHouse: "衆議院", nameOfMeeting: "財務金融委員会", issue: "第5号", date: "2023-03-01", speaker: "鈴木俊一", speakerPosition: "財務大臣", speech: "発言の本文", speechURL: "https://kokkai.ndl.go.jp/txt/1" },
    ],
  });
  assert.equal(kokkaiCitation(speeches[0]), "第211回国会 衆議院 財務金融委員会 第5号 2023年3月1日 鈴木俊一（財務大臣）発言");
});

test("e-Statの一覧と統計表を読む（1件だけのときはオブジェクトで返る）", () => {
  const list = parseEstatStatsList({
    GET_STATS_LIST: {
      RESULT: { STATUS: 0 },
      DATALIST_INF: { TABLE_INF: { "@id": "0003", STAT_NAME: { $: "労働力調査" }, TITLE: { $: "従業上の地位別就業者数" }, GOV_ORG: { $: "総務省" }, SURVEY_DATE: "202201-202212", OPEN_DATE: "2023-01-31" } },
    },
  });
  assert.equal(list[0].id, "0003");
  assert.equal(list[0].statName, "労働力調査");

  const data = parseEstatStatsData({
    GET_STATS_DATA: {
      RESULT: { STATUS: 0 },
      STATISTICAL_DATA: {
        TABLE_INF: { "@id": "0003", STAT_NAME: { $: "労働力調査" }, TITLE: "従業上の地位別" },
        CLASS_INF: {
          CLASS_OBJ: [
            { "@id": "cat01", "@name": "従業上の地位", CLASS: [{ "@code": "1", "@name": "家族従業者", "@unit": "万人" }, { "@code": "2", "@name": "総数", "@unit": "万人" }] },
            { "@id": "time", "@name": "時間軸", CLASS: { "@code": "2022000000", "@name": "2022年" } },
          ],
        },
        DATA_INF: { VALUE: [{ "@cat01": "1", "@time": "2022000000", $: "120" }, { "@cat01": "2", "@time": "2022000000", $: "-" }] },
      },
    },
  });
  assert.equal(data.rows[0].value, 120);
  assert.equal(data.rows[0].unit, "万人");
  assert.equal(data.rows[1].value, null);
});

test("e-Statのエラーは例外にする", () => {
  assert.throws(() => parseEstatStatsList({ GET_STATS_LIST: { RESULT: { STATUS: 100, ERROR_MSG: "認証に失敗しました" } } }));
});

test("論文ページから本文PDFの候補を探す", () => {
  const links = findPdfLinks(
    '<a href="/article/jjtl/1/0/1_1/_article/-char/ja/">記事</a><a href="https://repo.example.ac.jp/file.pdf">PDF</a>',
    "https://www.jstage.jst.go.jp/",
  );
  assert.ok(links.some((l) => l.includes("/_pdf/")));
  assert.ok(links.some((l) => l.endsWith(".pdf")));
});

test("取得してよい情報源の範囲（§1-3a）", () => {
  assert.ok(isAllowedSourceUrl("https://www.nta.go.jp/x"));
  assert.ok(isAllowedSourceUrl("https://laws.e-gov.go.jp/law/1"));
  assert.ok(isAllowedSourceUrl("https://cir.nii.ac.jp/crid/1"));
  assert.ok(!isAllowedSourceUrl("https://www.nikkei.com/article"));
  assert.ok(!isAllowedSourceUrl("https://repo.example.ac.jp/a.pdf"));
  assert.ok(isAllowedSourceUrl("https://repo.example.ac.jp/a.pdf", "paper_pdf"));
  assert.ok(!isAllowedSourceUrl("https://evil.go.jp.example.com/"));
  assert.ok(!isAllowedSourceUrl("file:///etc/passwd"));
});

test("出典の文には URL と確認日を重ねて入れない", () => {
  const [b] = parseMaterialsText("【資料1】\n日経新聞の記事\nhttps://www.nikkei.com/x\n（最終確認日：2025年1月1日）\n本文");
  assert.equal(b.citation, "日経新聞の記事");
  assert.equal(b.url, "https://www.nikkei.com/x");
  assert.equal(b.lastCheckedAt, "2025-01-01");
});
