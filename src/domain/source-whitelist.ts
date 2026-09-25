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
  /**
   * 検索語を入れた状態で開けるURLの作り方。
   *
   * トップページへ飛ばすと、ゼミ生が検索語を打ち直すことになる。
   * ここが埋まっている情報源は、ワンタップで結果一覧に着く。
   *
   * **実際にブラウザで開いて結果が絞り込まれることを確認したものだけ**に
   * 設定する。国会会議録のように、URLに検索語を載せても効かない
   * （全件が出る）サイトがあり、壊れたリンクはトップページより悪い。
   */
  searchUrl?: (keywords: string[]) => string;
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
    // 確認済み: 「就業構造基本調査」で該当統計に絞り込まれた
    searchUrl: (kw) =>
      `https://www.e-stat.go.jp/stat-search?page=1&query=${encodeURIComponent(kw.join(" "))}`,
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
    // 確認済み: 「夫婦別氏 人格権」で関連する判例研究・論文が出た
    searchUrl: (kw) =>
      `https://cir.nii.ac.jp/all?q=${encodeURIComponent(kw.join(" "))}`,
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

/**
 * 検索語を入れた状態のURL。作り方が分からない情報源はトップページを返す。
 * 検索語が空のときもトップページでよい
 */
export function searchUrlFor(id: string, keywords: string[]): string {
  const source = BY_ID.get(id);
  if (!source) return "";
  if (!source.searchUrl || keywords.length === 0) return source.url;
  return source.searchUrl(keywords);
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

// ── 資料の自動取得で許す情報源（v6 要件 §1-3a） ─────────────────
/**
 * 取得してよいドメイン。新聞・民間調査・一般サイトは取得しない。
 *
 *  - 官公庁・統計・国会・法令・判例 … `go.jp` 配下（e-Gov・e-Stat・国会会議録・
 *    衆参・裁判所・各府省庁・J-STAGE を含む）
 *  - 論文 … CiNii Research（`nii.ac.jp`）。本文PDFは J-STAGE（go.jp）か、
 *    CiNii からリンクされた大学の機関リポジトリ（`ac.jp`）の公開PDFに限る
 */
export type FetchPurpose = "general" | "paper_pdf";

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function endsWithDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 取得してよいURLか。リダイレクト先にも同じ検査をかける */
export function isAllowedSourceUrl(
  url: string,
  purpose: FetchPurpose = "general",
): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (endsWithDomain(host, "go.jp")) return true;
  if (endsWithDomain(host, "nii.ac.jp")) return true;
  if (purpose === "paper_pdf" && endsWithDomain(host, "ac.jp")) return true;
  return false;
}

/** Claude の Web 検索に渡すドメイン（allowed_domains） */
export const WEB_SEARCH_DOMAINS: Record<"govt" | "precedent" | "paper", string[]> = {
  govt: [
    "go.jp",
  ],
  precedent: ["courts.go.jp"],
  paper: ["jstage.jst.go.jp", "cir.nii.ac.jp"],
};

/** 登録資料の出典URLが §1-3a の範囲内か（範囲外は注意表示。§3.2） */
export function isWithinAllowedSources(url: string | undefined): boolean {
  if (!url) return false;
  return isAllowedSourceUrl(url, "paper_pdf");
}
