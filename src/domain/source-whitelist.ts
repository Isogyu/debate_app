/**
 * 情報源ホワイトリスト（REQUIREMENTS.md §2.4）
 *
 * LLMに情報源を自由記述させると、存在しないデータベース名やURLを書くことがある。
 * 生成時はこのリストのIDから選ばせるだけにして、捏造の余地をなくす。
 */

import type { SourceType } from "./types";

export interface SuggestedSource {
  id: string;
  label: string;
  /** 資料要件画面から直接飛べるようにする */
  url: string;
  kind: "law" | "diet" | "statistic" | "academic" | "book" | "govt" | "other";
  /** この情報源が向いている資料種別 */
  fits: SourceType[];
  hint: string;
}

export const SUGGESTED_SOURCES: SuggestedSource[] = [
  {
    id: "egov",
    label: "e-Gov法令検索",
    url: "https://laws.e-gov.go.jp/",
    kind: "law",
    fits: ["law"],
    hint: "条文の全文はここから取得する。AIに条文を書かせない。",
  },
  {
    id: "kokkai_giji",
    label: "国会会議録検索システム",
    url: "https://kokkai.ndl.go.jp/",
    kind: "diet",
    fits: ["diet_record"],
    hint: "「第N回国会 院 委員会 第N号 年月日」の形式で引用する。",
  },
  {
    id: "shugiin_shitsumon",
    label: "衆議院 質問主意書・答弁書",
    url: "https://www.shugiin.go.jp/internet/itdb_shitsumon.nsf/html/shitsumon/menu_m.htm",
    kind: "diet",
    fits: ["diet_record", "govt_doc"],
    hint: "政府見解を示すのに強い。",
  },
  {
    id: "sangiin_shitsumon",
    label: "参議院 質問主意書",
    url: "https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/syuisyo.htm",
    kind: "diet",
    fits: ["diet_record", "govt_doc"],
    hint: "衆議院側で見つからないときに確認する。",
  },
  {
    id: "estat",
    label: "e-Stat 政府統計の総合窓口",
    url: "https://www.e-stat.go.jp/",
    kind: "statistic",
    fits: ["statistic"],
    hint: "就業構造基本調査など。年次と表番号を必ず控える。",
  },
  {
    id: "nta_toukei",
    label: "国税庁 統計情報",
    url: "https://www.nta.go.jp/publication/statistics/kokuzeicho/tokei.htm",
    kind: "statistic",
    fits: ["statistic"],
    hint: "統計年報書・申告所得税標本調査。専従者給与の推移などはここ。",
  },
  {
    id: "courts",
    label: "裁判所 裁判例検索",
    url: "https://www.courts.go.jp/app/hanrei_jp/search1",
    kind: "law",
    fits: ["precedent"],
    hint: "判決の全文が読める。事件番号と言渡日で特定して引用する。",
  },
  {
    id: "cinii",
    label: "CiNii Research",
    url: "https://cir.nii.ac.jp/",
    kind: "academic",
    fits: ["paper"],
    hint: "論文の所在確認。本文はJ-STAGEや機関リポジトリへ。",
  },
  {
    id: "jstage",
    label: "J-STAGE",
    url: "https://www.jstage.jst.go.jp/",
    kind: "academic",
    fits: ["paper"],
    hint: "本文PDFが取れることが多い。",
  },
  {
    id: "ndl",
    label: "国立国会図書館サーチ",
    url: "https://ndlsearch.ndl.go.jp/",
    kind: "book",
    fits: ["book", "paper"],
    hint: "書籍の版・出版年の確認に使う。",
  },
  {
    id: "mof",
    label: "財務省 税制関連資料",
    url: "https://www.mof.go.jp/tax_policy/",
    kind: "govt",
    fits: ["govt_doc"],
    hint: "税制改正大綱・説明資料。",
  },
  {
    id: "gender_equality",
    label: "内閣府 男女共同参画白書",
    url: "https://www.gender.go.jp/about_danjo/whitepaper/",
    kind: "govt",
    fits: ["govt_doc", "statistic"],
    hint: "共働き世帯の推移など。",
  },
  {
    id: "self_made",
    label: "ディベーター作成資料",
    url: "",
    kind: "other",
    fits: ["self_made"],
    hint: "税額シミュレーション表など、自分で作る資料。計算根拠を必ず添える。",
  },
];

const BY_ID = new Map(SUGGESTED_SOURCES.map((s) => [s.id, s]));

export function getSuggestedSource(id: string): SuggestedSource | undefined {
  return BY_ID.get(id);
}

/** LLMが返したIDのうち、ホワイトリストにないものは捨てる */
export function sanitizeSuggestedSourceIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && BY_ID.has(id));
}

/** プロンプトに埋め込む一覧（LLMにはこの中から選ばせる） */
export function whitelistForPrompt(): string {
  return SUGGESTED_SOURCES.map((s) => `- ${s.id}: ${s.label}（${s.hint}）`).join(
    "\n",
  );
}
