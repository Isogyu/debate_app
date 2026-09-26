/**
 * DBスキーマ（v6。docs/IMPLEMENTATION_PLAN_v6.md §3）
 *
 * ハイブリッド構成:
 *  - リレーショナル列 … 検索・集計・相互リンクの対象
 *  - JSON列          … まとめて読み書きし部分検索しないもの（立論本文ツリー等）
 *
 * テーブル名 `projects` は v5 からの名残で、中身は「テーマ」。
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CaseStrategy,
  ClosingPerspective,
  CrossExamBranch,
  DebateCase,
  GenerationStepState,
  ImportIssue,
  JobParams,
  PracticeFeedback,
  PracticeReflection,
  PracticeTurn,
  ResolutionAnalysis,
  SourceProcedure,
  SourceRequirement,
  StatisticData,
} from "@/domain/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["member", "admin"] })
    .notNull()
    .default("member"),
  createdAt: text("created_at").notNull().default(now),
});

/** テーマ。現テーマ（active）は常に1件だけ（§2 F1） */
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    resolution: text("resolution").notNull(),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    /** 論題分析で止めて人が確認するか（§3.3 任意の確認関門） */
    reviewAnalysis: integer("review_analysis", { mode: "boolean" })
      .notNull()
      .default(false),
    analysis: text("analysis", { mode: "json" }).$type<ResolutionAnalysis>(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    archivedAt: text("archived_at"),
  },
  (t) => [
    // 現テーマが2件になる不整合をDBでも防ぐ
    uniqueIndex("projects_one_active_idx")
      .on(t.status)
      .where(sql`status = 'active'`),
  ],
);

export const issueCategories = sqliteTable(
  "issue_categories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_project_name_idx").on(t.projectId, t.name)],
);

/** 立論。登録・生成を同じテーブルで持つ（§3.1）。削除機能は持たない */
export const caseVariants = sqliteTable(
  "case_variants",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["affirmative", "negative"] }).notNull(),
    origin: text("origin", { enum: ["uploaded", "generated"] }).notNull(),
    /** 一覧での呼び名（生成: 切り口 / 登録: ファイル名など） */
    label: text("label").notNull(),
    framework: text("framework").notNull().default(""),
    approach: text("approach").notNull().default(""),
    debateCase: text("debate_case", { mode: "json" })
      .$type<DebateCase>()
      .notNull(),
    sourceRefs: text("source_refs", { mode: "json" })
      .$type<SourceRequirement[]>()
      .notNull(),
    lengthWarning: text("length_warning"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    questionsVerified: integer("questions_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("variants_project_idx").on(t.projectId, t.side, t.origin)],
);

/** 資料の実体 */
export const sourceMaterials = sqliteTable(
  "source_materials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provesWhat: text("proves_what").notNull(),
    sourceType: text("source_type").notNull(),
    status: text("status", { enum: ["procedure", "unverified", "verified"] })
      .notNull()
      .default("procedure"),
    origin: text("origin", { enum: ["ai_fetched", "uploaded", "copied", "manual"] })
      .notNull()
      .default("ai_fetched"),
    citation: text("citation"),
    quote: text("quote"),
    url: text("url"),
    lastCheckedAt: text("last_checked_at"),
    sourceDomain: text("source_domain"),
    withinAllowedSources: integer("within_allowed_sources", { mode: "boolean" })
      .notNull()
      .default(true),
    procedure: text("procedure", { mode: "json" }).$type<SourceProcedure>(),
    statistic: text("statistic", { mode: "json" }).$type<StatisticData>(),
    copiedFromMaterialId: text("copied_from_material_id"),
    isModified: integer("is_modified", { mode: "boolean" })
      .notNull()
      .default(false),
    modificationNote: text("modification_note"),
    verifiedAt: text("verified_at"),
  },
  (t) => [index("materials_project_idx").on(t.projectId, t.status)],
);

/** 取得したページ・PDFの本文。引用文の照合元（§1-3） */
export const fetchedDocuments = sqliteTable(
  "fetched_documents",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    contentType: text("content_type").notNull(),
    text: text("text").notNull(),
    /** PDFのページ境界（text 内の開始位置） */
    pageOffsets: text("page_offsets", { mode: "json" }).$type<number[]>(),
    sha256: text("sha256").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("fetched_url_idx").on(t.url)],
);

/** 質疑。全立論が対象（§4） */
export const crossExamNodes = sqliteTable(
  "cross_exam_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetVariantId: text("target_variant_id")
      .notNull()
      .references(() => caseVariants.id, { onDelete: "cascade" }),
    chainId: text("chain_id").notNull(),
    chainOrder: integer("chain_order").notNull().default(0),
    targetClaimId: text("target_claim_id"),
    targetParagraph: text("target_paragraph").notNull().default(""),
    attackPoint: text("attack_point", {
      enum: ["premise", "evidence", "causality", "impact", "numbers"],
    }).notNull(),
    question: text("question").notNull(),
    purpose: text("purpose").notNull().default(""),
    modelAnswer: text("model_answer").notNull().default(""),
    goal: text("goal"),
    priority: integer("priority").notNull().default(3),
    setOrder: integer("set_order"),
    origin: text("origin", { enum: ["generated", "practice"] })
      .notNull()
      .default("generated"),
    stuckCount: integer("stuck_count").notNull().default(0),
    categoryIds: text("category_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    branches: text("branches", { mode: "json" })
      .$type<CrossExamBranch[]>()
      .notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("cx_variant_idx").on(t.targetVariantId, t.chainId),
    index("cx_project_idx").on(t.projectId),
  ],
);

/** 数字の検査結果（§1-9） */
export const numberFindings = sqliteTable(
  "number_findings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => caseVariants.id, { onDelete: "cascade" }),
    aspect: text("aspect", {
      enum: ["source", "calculation", "comparability", "usage"],
    }).notNull(),
    severity: text("severity", { enum: ["high", "medium", "low"] }).notNull(),
    location: text("location").notNull(),
    claimId: text("claim_id"),
    value: text("value").notNull().default(""),
    message: text("message").notNull(),
    resolution: text("resolution"),
  },
  (t) => [index("findings_variant_idx").on(t.variantId)],
);

/** 最終弁論の雛形（§6） */
export const closingTemplates = sqliteTable("closing_templates", {
  variantId: text("variant_id")
    .primaryKey()
    .references(() => caseVariants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  own: text("own", { mode: "json" }).$type<ClosingPerspective>().notNull(),
  opponent: text("opponent", { mode: "json" })
    .$type<ClosingPerspective>()
    .notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

/** 特徴と戦い方（§7） */
export const caseStrategies = sqliteTable("case_strategies", {
  variantId: text("variant_id")
    .primaryKey()
    .references(() => caseVariants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" })
    .$type<Omit<CaseStrategy, "variantId" | "verified">>()
    .notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

/** 登録ファイル（§3.2） */
export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    variantId: text("variant_id"),
    side: text("side", { enum: ["affirmative", "negative"] }).notNull(),
    label: text("label").notNull(),
    caseFileName: text("case_file_name").notNull(),
    caseFilePath: text("case_file_path").notNull(),
    caseText: text("case_text").notNull(),
    materialsFileName: text("materials_file_name"),
    materialsFilePath: text("materials_file_path"),
    materialsText: text("materials_text"),
    issues: text("issues", { mode: "json" }).$type<ImportIssue[]>().notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("uploads_project_idx").on(t.projectId)],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["analysis", "generate", "import", "more_questions"],
    }).notNull(),
    variantId: text("variant_id"),
    params: text("params", { mode: "json" }).$type<JobParams>(),
    steps: text("steps", { mode: "json" })
      .$type<GenerationStepState[]>()
      .notNull(),
    status: text("status", {
      // awaiting_review = 論題分析だけ済み、人の確認待ち（§3.3 任意の確認関門）
      enum: [
        "queued",
        "running",
        "awaiting_review",
        "partial",
        "done",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("jobs_project_idx").on(t.projectId, t.status)],
);

/** 完全性: 変更前スナップショットを残す */
export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull().default(now),
    origin: text("origin", { enum: ["ai", "human"] }).notNull(),
  },
  (t) => [index("revisions_entity_idx").on(t.projectId, t.entityId)],
);

/** 追記専用。UPDATE/DELETEしない */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    userId: text("user_id").notNull(),
    action: text("action", {
      enum: ["generate", "edit", "export", "verify", "login", "upload", "copy"],
    }).notNull(),
    target: text("target").notNull(),
    detail: text("detail"),
    at: text("at").notNull().default(now),
  },
  (t) => [index("logs_project_idx").on(t.projectId, t.at)],
);

/** 質疑の練習記録（F11） */
export const practiceSessions = sqliteTable(
  "practice_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    mode: text("mode", { enum: ["attack", "defense"] }).notNull(),
    /** 自分が守る立論 */
    userVariantId: text("user_variant_id")
      .notNull()
      .references(() => caseVariants.id, { onDelete: "cascade" }),
    /** AIが演じる相手の立論 */
    opponentVariantId: text("opponent_variant_id")
      .notNull()
      .references(() => caseVariants.id, { onDelete: "cascade" }),
    turns: text("turns", { mode: "json" }).$type<PracticeTurn[]>().notNull(),
    feedback: text("feedback", { mode: "json" }).$type<PracticeFeedback>(),
    reflection: text("reflection", { mode: "json" }).$type<PracticeReflection>(),
    createdAt: text("created_at").notNull().default(now),
    finishedAt: text("finished_at"),
  },
  (t) => [index("practice_project_idx").on(t.projectId, t.userId)],
);

/** API使用量の記録（画面には出さない。費用の調査用） */
export const apiUsage = sqliteTable(
  "api_usage",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    jobId: text("job_id"),
    step: text("step").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    at: text("at").notNull().default(now),
  },
  (t) => [index("usage_at_idx").on(t.at)],
);
