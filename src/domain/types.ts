/**
 * ドメイン型定義（REQUIREMENTS.md §7 / v4）
 *
 * v4での重要な変更点:
 *  - 資料の「実体」(SourceMaterial) と「参照」(SourceRequirement) を分離した。
 *    資料番号【資料N参照】は立論バリエーション内でのみ一意。
 *  - 生成ジョブ(GenerationJob)を永続エンティティにした。
 *  - セキュリティ要件に対応する User / Revision / ActivityLog を追加した。
 */

export type Side = "affirmative" | "negative";

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

export type AttackPoint = "premise" | "evidence" | "causality" | "impact";

/** criteria=基準別論証 / environment=環境変化型 / comparison=比較衡量型 / other=実例にない構成 */
export type SectionType = "criteria" | "environment" | "comparison" | "other";

/** 生成パイプラインの8ステップ（REQUIREMENTS §8） */
export type GenStep =
  | "analysis"
  | "case_outline"
  | "case_body"
  | "source_req"
  | "cross_exam"
  | "rebuttal"
  | "blocks"
  | "comparison";

export const GEN_STEPS: GenStep[] = [
  "analysis",
  "case_outline",
  "case_body",
  "source_req",
  "cross_exam",
  "rebuttal",
  "blocks",
  "comparison",
];

/** 画面に出す日本語名。非情報系ユーザー向けに内部名を見せない */
export const GEN_STEP_LABELS: Record<GenStep, string> = {
  analysis: "論題の分析",
  case_outline: "立論の骨子",
  case_body: "立論の本文",
  source_req: "資料要件リスト",
  cross_exam: "質疑フローチャート",
  rebuttal: "反駁シート",
  blocks: "ブロック集",
  comparison: "比較衡量",
};

export type ProjectStatus = "analyzing" | "generating" | "ready" | "archived";

export type MaterialStatus = "needed" | "found" | "verified";

export type VariantRole =
  | "candidate"
  | "adopted"
  | "opponent_prediction"
  | "practice";

// ── 利用者 ───────────────────────────────────────────────
// 個人識別は「名前を選ぶだけ」。アクセス制御はプロジェクトのパスコードで行う（§6.2）
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
  fullText?: string; // 条文全文（参考資料Ⅰ用）
  /** 条文はLLMに生成させない。e-Gov等で人が確認したか（§13-4） */
  verified: boolean;
  sourceUrl?: string;
}

export interface EvaluationFramework {
  name: string; // "租税公平主義" / "税の基本原則(税制改革法3条)"
  basisLaw?: string;
  criteria: string[]; // ["担税力","公平","中立性"]
}

export interface ResolutionAnalysis {
  policyChange: string;
  statusQuo: string;
  relatedLaws: LawRef[];
  stakeholders: string[];
  coreIssues: string[];
  /** 両側で異なる枠組みを持ちうる（§2.2） */
  frameworks: Record<Side, EvaluationFramework>;
}

export interface IssueCategory {
  id: string;
  name: string; // "担税力" "所得分散防止"
  description: string;
}

// ── 立論 ─────────────────────────────────────────────────
export interface Claim {
  id: string;
  categoryIds: string[];
  title: string; // "担税力に即した課税"
  claim: string;
  warrant: string;
  /** 同じ CaseVariant の sourceRefs 内の参照のみを指す（不変条件2） */
  sourceRefIds: string[];
  causalChain: string[];
  impact: string;
}

export interface CaseSection {
  id: string;
  title: string;
  type: SectionType;
  subsections: Claim[]; // （1）（2）（3）
}

export interface DebateCase {
  side: Side;
  valuePremise: string;
  claim: string; // Ⅰ.主張（一文）
  sections: CaseSection[]; // Ⅱ.理由
  conclusion: string; // Ⅲ.結論
  fullText: string;
}

// ── 資料: 実体と参照の分離 ─────────────────────────────────
/** 実体。実際に見つけた／作った資料そのもの。プロジェクト内で複数パターンから再利用する */
export interface SourceMaterial {
  id: string;
  provesWhat: string; // = 資料タイトル（証明する命題そのもの）
  sourceType: SourceType;
  status: MaterialStatus;
  citation?: string; // 出典（§2.3の書式）
  quote?: string; // 引用文
  isModified: boolean; // 下線・傍点等の加工の有無
  modificationNote?: string; // "［下線はディベーターによる。］"
  verifiedBy?: string;
  verifiedAt?: string;
}

/** 参照。ある立論パターンの中で、その資料が何番として何を支えるか */
export interface SourceRequirement {
  id: string;
  /** 【資料N参照】のN。CaseVariant内で1..Nの連番（不変条件1） */
  number: number;
  materialId: string;
  supportsClaimIds: string[];
  categoryIds: string[];
  description: string;
  searchKeywords: string[];
  /** §2.4のホワイトリストのIDのみ。LLMの自由記述は許さない */
  suggestedSourceIds: string[];
  formatHint: "quote" | "chart" | "table" | "law_text" | "self_made";
}

export interface CaseVariant {
  id: string;
  side: Side;
  framework: string;
  approach: string; // "環境変化型・DX重視"
  debateCase: DebateCase;
  /** 資料番号はここでスコープされる */
  sourceRefs: SourceRequirement[];
  qualityScore?: number;
  role: VariantRole;
}

// ── 質疑 ─────────────────────────────────────────────────
export interface CrossExamBranch {
  expectedAnswer: string;
  followUpNodeId?: string;
  exposedWeakness?: string;
}

export interface CrossExamNode {
  id: string;
  /** attack=相手立論を攻める / defense=自側への想定質問と回答準備 */
  direction: "attack" | "defense";
  targetVariantId?: string;
  categoryIds: string[];
  targetClaimId?: string;
  question: string;
  purpose: string;
  branches: CrossExamBranch[]; // 保存時に循環参照を検証する（不変条件3）
}

// ── 反駁・ブロック ────────────────────────────────────────
export interface Rebuttal {
  id: string;
  /** どの相手想定パターンへの反駁か。複数パターンがあるため必須 */
  targetVariantId: string;
  targetClaimId: string;
  categoryIds: string[];
  attackPoint: AttackPoint;
  argument: string;
  sourceRefIds: string[];
}

/** 本番で引く単位。複数パターン由来の反駁を1ブロックに集約する（§8-7） */
export interface BlockEntry {
  id: string;
  categoryIds: string[];
  opponentArgument: string; // 類型化した代表形
  summary: string; // 本番モードの一覧カードに出す「返しの要点」
  myRebuttalIds: string[];
  myCrossExamIds: string[];
  myMaterialIds: string[];
  /** 事前計算した検索用テキスト（本番モードの即応答用） */
  searchText: string;
}

export interface Comparison {
  criteria: {
    categoryId: string; // 争点カテゴリと紐づける（§14 カテゴリ軸ルール）
    name: string;
    affirmative: string;
    negative: string;
  }[];
  verdictLogic: string;
}

// ── プロジェクト ──────────────────────────────────────────
export interface DebateProject {
  id: string;
  title: string;
  resolution: string;
  mySide: Side;
  teamName?: string;
  members?: string[];
  ownerTeamId: string;
  /** パスコードは平文保存しない */
  passcodeHash: string;
  /** true=本番論題。事例DBでの教材公開を禁止（不変条件5） */
  isCompetitionTopic: boolean;
  status: ProjectStatus;
  analysis: ResolutionAnalysis;
  categories: IssueCategory[];
  caseVariants: CaseVariant[];
  adoptedCaseId?: string;
  opponentCaseIds: string[];
  sourceMaterials: SourceMaterial[];
  crossExam: CrossExamNode[];
  rebuttals: Rebuttal[];
  blocks: BlockEntry[];
  comparison: Comparison;
  createdAt: string;
  updatedAt: string;
}

// ── 生成ジョブ ───────────────────────────────────────────
export interface GenerationStepState {
  step: GenStep;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  /** ユーザー向け日本語メッセージ。スタックトレースは入れない */
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface GenerationJob {
  id: string;
  projectId: string;
  variantId?: string;
  steps: GenerationStepState[];
  status: "queued" | "running" | "partial" | "done" | "failed";
  startedAt?: string;
  finishedAt?: string;
  createdBy: string;
}

// ── 完全性・責任追跡性 ────────────────────────────────────
export interface Revision {
  id: string;
  projectId: string;
  entityType:
    | "case"
    | "claim"
    | "source"
    | "rebuttal"
    | "block"
    | "analysis";
  entityId: string;
  snapshot: unknown;
  changedBy: string;
  changedAt: string;
  /** AI生成か人の編集か（§6.2 信頼性） */
  origin: "ai" | "human";
}

/** 追記専用。UPDATE/DELETEしない（不変条件6） */
export interface ActivityLog {
  id: string;
  projectId?: string;
  userId: string;
  action: "generate" | "edit" | "export" | "verify" | "login" | "pack_build";
  target: string;
  detail?: string;
  at: string;
}
