/**
 * ドメイン型定義（docs/REQUIREMENTS_v6_draft.md）
 *
 * v6 の考え方:
 *  - テーマ（Theme）は常に1つだけが「現テーマ」。前のテーマは過去テーマとして閲覧のみ
 *  - 立論（CaseVariant）は賛成側・反対側を区別せず同じ扱い。出どころは「登録」か「生成」
 *  - 立論ごとに、資料・数字の検査・質疑・最終弁論の雛形・特徴と戦い方を持つ
 *  - 資料の「実体」(SourceMaterial) と「参照」(SourceRequirement) は v4 以来の分離を継続。
 *    資料番号【資料N参照】は立論ごとに 1..N
 */

export type Side = "affirmative" | "negative";

export const SIDE_LABELS: Record<Side, string> = {
  affirmative: "賛成側",
  negative: "反対側",
};

export type SourceType =
  | "law"
  | "precedent"
  | "statistic"
  | "paper"
  | "govt_doc"
  | "diet_record"
  | "news"
  | "book"
  | "org_doc"
  | "self_made"; // ディベーター作成資料（税額シミュレーション表等）

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  law: "法令",
  precedent: "判例",
  statistic: "統計",
  paper: "論文",
  govt_doc: "官公庁資料",
  diet_record: "国会会議録",
  news: "新聞・報道",
  book: "書籍",
  org_doc: "団体資料",
  self_made: "自作資料",
};

/** 質疑で突く観点。v6 で「数字の使い方」を追加（§1-9） */
export type AttackPoint =
  | "premise"
  | "evidence"
  | "causality"
  | "impact"
  | "numbers";

export const ATTACK_POINTS: AttackPoint[] = [
  "premise",
  "evidence",
  "causality",
  "impact",
  "numbers",
];

export const ATTACK_POINT_LABELS: Record<AttackPoint, string> = {
  premise: "前提",
  evidence: "根拠（資料）",
  causality: "因果",
  impact: "効果",
  numbers: "数字の使い方",
};

/** criteria=基準別論証 / environment=環境変化型 / comparison=比較衡量型 / other=実例にない構成 */
export type SectionType = "criteria" | "environment" | "comparison" | "other";

// ── 生成ジョブのステップ ─────────────────────────────────
export type GenStep =
  | "analysis"
  | "case_outline"
  | "case_body"
  | "source_plan"
  | "source_fetch"
  | "number_check"
  | "cross_exam"
  | "closing"
  | "strategy"
  | "import"
  | "more_questions";

/** テーマを登録したときに1回だけ流す */
export const ANALYSIS_STEPS: GenStep[] = ["analysis"];

/** 立論を1本生成するジョブ（§3.3） */
export const GENERATE_STEPS: GenStep[] = [
  "case_outline",
  "case_body",
  "source_plan",
  "source_fetch",
  "number_check",
  "cross_exam",
  "closing",
  "strategy",
];

/** 自作の立論＋資料を登録するジョブ（§3.2） */
export const IMPORT_STEPS: GenStep[] = [
  "import",
  "number_check",
  "cross_exam",
  "closing",
  "strategy",
];

/** 「この箇所をもっと」（§4.1） */
export const MORE_QUESTION_STEPS: GenStep[] = ["more_questions"];

/** 画面に出す日本語名。内部名は見せない */
export const GEN_STEP_LABELS: Record<GenStep, string> = {
  analysis: "論題の分析",
  case_outline: "立論の骨子",
  case_body: "立論の本文（字数の調整を含む）",
  source_plan: "資料の計画",
  source_fetch: "資料の取得・作成",
  number_check: "数字の検査",
  cross_exam: "質疑と回答",
  closing: "最終弁論の雛形",
  strategy: "特徴と戦い方",
  import: "ファイルの取り込み",
  more_questions: "質疑の追加",
};

export type JobKind = "analysis" | "generate" | "import" | "more_questions";

export type ThemeStatus = "active" | "archived";

/** 生成は1テーマにつき各側この本数まで（§2 F3）。登録は数えない */
export const MAX_GENERATED_PER_SIDE = 3;

// ── 利用者 ───────────────────────────────────────────────
export interface User {
  id: string;
  displayName: string;
  role: "member" | "admin";
  createdAt: string;
}

// ── 論題分析 ─────────────────────────────────────────────
export interface LawRef {
  id: string;
  name: string; // "所得税法"
  article: string; // "第56条"
  /** 条文はLLMに生成させない */
  verified: boolean;
  sourceUrl?: string;
}

export interface EvaluationFramework {
  name: string;
  basisLaw?: string;
  criteria: string[];
}

export interface ResolutionAnalysis {
  policyChange: string;
  statusQuo: string;
  relatedLaws: LawRef[];
  stakeholders: string[];
  coreIssues: string[];
  frameworks: Record<Side, EvaluationFramework>;
}

export interface IssueCategory {
  id: string;
  name: string;
  description: string;
}

// ── 立論 ─────────────────────────────────────────────────
export interface Claim {
  id: string;
  categoryIds: string[];
  title: string;
  claim: string;
  warrant: string;
  sourceRefIds: string[];
  causalChain: string[];
  impact: string;
}

export interface CaseSection {
  id: string;
  title: string;
  type: SectionType;
  /** 節の見出しと最初の（1）の間の導入文（登録立論で使う。生成立論は持たない） */
  intro?: string;
  subsections: Claim[];
}

export interface DebateCase {
  side: Side;
  valuePremise: string;
  claim: string; // Ⅰ.主張
  sections: CaseSection[]; // Ⅱ.理由
  conclusion: string; // Ⅲ.結論
  fullText: string;
}

export type CaseOrigin = "uploaded" | "generated";

export const CASE_ORIGIN_LABELS: Record<CaseOrigin, string> = {
  uploaded: "登録",
  generated: "生成",
};

// ── 資料 ─────────────────────────────────────────────────
/**
 * procedure  = 取得できず、作成手順だけがある
 * unverified = AIが取得した／登録された。人がまだ確認していない
 * verified   = 人が確認した
 */
export type MaterialStatus = "procedure" | "unverified" | "verified";

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  procedure: "作成手順",
  unverified: "AI取得（未確認）",
  verified: "確認済",
};

export type MaterialOrigin = "ai_fetched" | "uploaded" | "copied";

/** 取得できなかった資料の作成手順（§3.4） */
export interface SourceProcedure {
  /** 何を証明する資料か */
  provesWhat: string;
  /** そのまま検索欄に入れられる語 */
  searchKeywords: string[];
  /** 探す場所。URLはホワイトリストから組み立てたものだけ */
  whereToLook: { label: string; url: string }[];
  /** 見つけたら何を抜き出すか */
  whatToExtract: string;
  /** 統計の場合: 必要な統計表と計算手順 */
  statisticSteps?: string[];
  /** 自動で完成できなかった理由（画面に出す） */
  reason?: string;
}

/** 統計資料（§3.3 / §6.2）。値はすべてコードが入れる */
export interface StatisticInput {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** 調査年・年次 */
  year: string;
  statName: string;
  tableId: string;
  tableTitle: string;
  url: string;
  /** 表のどのセルか（分類コードの組） */
  locator: string;
}

export type StatisticOperation =
  | "ratio" // a / b
  | "percent" // a / b × 100
  | "growth" // (a - b) / b × 100
  | "difference" // a - b
  | "per_capita" // a / b
  | "share"; // a / b × 100（構成比）

export interface StatisticFormula {
  key: string;
  label: string;
  operation: StatisticOperation;
  a: string; // StatisticInput.key or 他の formula の key
  b: string;
  unit: string;
}

export interface StatisticResult {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** 元の数値 → 式 → 結果 を人が読める形で */
  expression: string;
}

export type ComparabilityAspect =
  | "年次"
  | "定義"
  | "単位"
  | "対象範囲"
  | "名目/実質";

export interface ComparabilityCheck {
  aspect: ComparabilityAspect;
  ok: boolean | null; // null = 機械的に判定できない
  note: string;
}

export interface StatisticData {
  inputs: StatisticInput[];
  formulas: StatisticFormula[];
  results: StatisticResult[];
  table: { columns: string[]; rows: string[][] };
  chart?: {
    type: "bar" | "line";
    title: string;
    unit: string;
    points: { label: string; value: number }[];
  };
  comparability: ComparabilityCheck[];
}

/** 実体。立論ごとの参照から番号付きで指される */
export interface SourceMaterial {
  id: string;
  projectId: string;
  provesWhat: string; // = 資料タイトル
  sourceType: SourceType;
  status: MaterialStatus;
  origin: MaterialOrigin;
  citation?: string;
  quote?: string;
  url?: string;
  /** 出典の最終確認日（YYYY-MM-DD） */
  lastCheckedAt?: string;
  sourceDomain?: string;
  /** §1-3a の情報源の範囲内か。登録資料で範囲外なら注意表示（§3.2） */
  withinAllowedSources: boolean;
  procedure?: SourceProcedure;
  statistic?: StatisticData;
  copiedFromMaterialId?: string;
  isModified: boolean;
  modificationNote?: string;
}

/** 参照。ある立論の中で、その資料が何番として何を支えるか */
export interface SourceRequirement {
  id: string;
  number: number;
  materialId: string;
  supportsClaimIds: string[];
  categoryIds: string[];
  description: string;
  searchKeywords: string[];
  suggestedSourceIds: string[];
  formatHint: "quote" | "chart" | "table" | "law_text" | "self_made";
  /** 資料の計画（source_plan）。取得の手がかりと、取れなかったときの手順の材料 */
  plan?: SourcePlan;
}

export interface SourcePlan {
  /** 法令: 法令名と条 */
  lawName?: string;
  article?: string;
  /** 統計: e-Stat で探す語 */
  statKeywords?: string[];
  /** 統計: 何をどう計算して何を示すか（作成手順にも使う） */
  statisticSteps?: string[];
  /** 官公庁・判例・論文: 検索に使う語 */
  webQuery?: string;
  /** 見つけたら何を抜き出すか */
  whatToExtract: string;
}

export interface CaseVariant {
  id: string;
  projectId: string;
  side: Side;
  origin: CaseOrigin;
  label: string;
  framework: string;
  approach: string;
  debateCase: DebateCase;
  sourceRefs: SourceRequirement[];
  /** 字数の自動調整で収まらなかったとき（§3.3） */
  lengthWarning?: string;
  /** 本文（生成のみ）を人が確認したか */
  verified: boolean;
  /** 質疑・フローチャートを人が確認したか */
  questionsVerified: boolean;
}

// ── 数字の検査（§1-9） ─────────────────────────────────
export type NumberAspect = "source" | "calculation" | "comparability" | "usage";

export const NUMBER_ASPECT_LABELS: Record<NumberAspect, string> = {
  source: "出典の明記",
  calculation: "計算の再現",
  comparability: "比較の前提",
  usage: "使い方の妥当性",
};

export interface NumberFinding {
  id: string;
  variantId: string;
  aspect: NumberAspect;
  severity: "high" | "medium" | "low";
  /** どの段落か（"（1）担税力" のような表示名） */
  location: string;
  claimId?: string;
  /** 問題の数字（原文の表記のまま） */
  value: string;
  message: string;
  /** 自動で直した場合、その内容 */
  resolution?: string;
}

// ── 質疑（§4） ───────────────────────────────────────────
export type BranchKind = "admit" | "deny" | "evade";

export const BRANCH_KIND_LABELS: Record<BranchKind, string> = {
  admit: "認める",
  deny: "否定する",
  evade: "はぐらかす",
};

export interface CrossExamBranch {
  kind: BranchKind;
  expectedAnswer: string;
  followUpNodeId?: string;
  exposedWeakness?: string;
}

export type QuestionOrigin = "generated" | "practice";

export interface CrossExamNode {
  id: string;
  projectId: string;
  targetVariantId: string;
  /** 連鎖（質問を重ねて詰める一続き）の単位。単発の質問も長さ1の連鎖として持つ */
  chainId: string;
  /** 連鎖の中での位置。0 = 起点 */
  chainOrder: number;
  targetClaimId?: string;
  /** 画面表示用の段落名（"（1）担税力"） */
  targetParagraph: string;
  attackPoint: AttackPoint;
  question: string;
  purpose: string;
  /** 立論側の模範回答 */
  modelAnswer: string;
  /** この連鎖で引き出したい結論（起点ノードにだけ入る） */
  goal?: string;
  /** 1(低)〜5(高) */
  priority: number;
  /** 8分セットに含まれる連鎖の並び順。含まれないなら undefined */
  setOrder?: number;
  origin: QuestionOrigin;
  /** 練習で答えに詰まった回数（§4.3） */
  stuckCount: number;
  categoryIds: string[];
  branches: CrossExamBranch[];
}

// ── 最終弁論の雛形（§6） ─────────────────────────────────
export interface ClosingBlank {
  key: string; // "①"
  label: string; // "相手が質疑で認めたこと"
  hint: string;
}

export interface ClosingExample {
  /** どの経路の場合の例か（"相手が(1)の前提を認めた場合"） */
  pathLabel: string;
  chainId?: string;
  text: string;
}

export interface ClosingPerspective {
  /** 【①…】のような空欄を含む枠。約320字 */
  frame: string;
  blanks: ClosingBlank[];
  examples: ClosingExample[];
}

export interface ClosingTemplate {
  variantId: string;
  /** この立論で戦うチーム用 */
  own: ClosingPerspective;
  /** この立論と戦うチーム（相手側）用 */
  opponent: ClosingPerspective;
  verified: boolean;
}

// ── 特徴と戦い方（§7） ───────────────────────────────────
export interface CaseStrategy {
  variantId: string;
  summary: string;
  strengths: string[];
  weaknesses: { point: string; why: string }[];
  /** 質疑で守るところ */
  defend: string[];
  /** 譲ってはいけないこと */
  neverConcede: string[];
  /** 最終弁論での勝ち筋 */
  winningPath: string;
  /** 相手としてこの立論と戦うとき */
  howToAttack: string[];
  verified: boolean;
}

// ── 生成ジョブ ───────────────────────────────────────────
export interface GenerationStepState {
  step: GenStep;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface JobParams {
  /** more_questions: 対象の段落 */
  claimId?: string;
  /** import: 取り込むアップロード */
  uploadId?: string;
}

// ── 登録（アップロード） ─────────────────────────────────
export interface ImportIssue {
  severity: "error" | "warning";
  message: string;
}

// ── 質疑シミュレーター ─────────────────────────────────
/** attack=自分が質問する練習 / defense=自分が質問される練習 */
export type PracticeMode = "attack" | "defense";

export interface PracticeTurn {
  speaker: "user" | "ai";
  text: string;
  at: string;
  /** AIが生成済みの質疑を使って質問した場合、そのノード */
  nodeId?: string;
}

export interface PracticeFeedback {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  summary: string;
  /** フローチャートとの照合（§4.4） */
  chains: { chainId: string; goal: string; reached: boolean; note: string }[];
  /** 発言の長さ（字数から推定した読み上げ秒数） */
  longTurns: { excerpt: string; seconds: number }[];
  /** テキストでは判定しない観点。画面に明記する */
  notJudged: string[];
}

export interface PracticeReflection {
  stuckNodeIds: string[];
  addedNodeIds: string[];
  closingExample?: string;
}
