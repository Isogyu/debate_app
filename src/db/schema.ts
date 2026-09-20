/**
 * DBスキーマ（REQUIREMENTS.md §4 永続化方式）
 *
 * ハイブリッド構成:
 *  - リレーショナル列 … 検索・集計・相互リンクの対象
 *  - JSON列          … まとめて読み書きし部分検索しないもの（立論本文ツリー等）
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
  Comparison,
  CrossExamBranch,
  DebateCase,
  GenerationStepState,
  ResolutionAnalysis,
  SourceRequirement,
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

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    resolution: text("resolution").notNull(),
    mySide: text("my_side", { enum: ["affirmative", "negative"] }).notNull(),
    teamName: text("team_name"),
    members: text("members", { mode: "json" }).$type<string[]>(),
    ownerTeamId: text("owner_team_id")
      .notNull()
      .references(() => teams.id),
    /** 平文は保存しない（§6.2 機密性） */
    passcodeHash: text("passcode_hash").notNull(),
    /** true=本番論題。教材公開を禁止（不変条件5） */
    isCompetitionTopic: integer("is_competition_topic", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", {
      enum: ["analyzing", "generating", "ready", "archived"],
    })
      .notNull()
      .default("analyzing"),
    analysis: text("analysis", { mode: "json" }).$type<ResolutionAnalysis>(),
    comparison: text("comparison", { mode: "json" }).$type<Comparison>(),
    adoptedCaseId: text("adopted_case_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("projects_team_idx").on(t.ownerTeamId)],
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

export const caseVariants = sqliteTable(
  "case_variants",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["affirmative", "negative"] }).notNull(),
    framework: text("framework").notNull(),
    approach: text("approach").notNull(),
    /** 立論本文ツリーはまとめて読み書きするのでJSON */
    debateCase: text("debate_case", { mode: "json" })
      .$type<DebateCase>()
      .notNull(),
    /** 資料番号はこのバリエーション内でスコープされる（不変条件1） */
    sourceRefs: text("source_refs", { mode: "json" })
      .$type<SourceRequirement[]>()
      .notNull(),
    qualityScore: integer("quality_score"),
    role: text("role", {
      enum: ["candidate", "adopted", "opponent_prediction", "practice"],
    })
      .notNull()
      .default("candidate"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("variants_project_idx").on(t.projectId, t.side)],
);

/** 資料の実体。プロジェクト内で複数パターンから再利用する */
export const sourceMaterials = sqliteTable(
  "source_materials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provesWhat: text("proves_what").notNull(),
    sourceType: text("source_type").notNull(),
    status: text("status", { enum: ["needed", "found", "verified"] })
      .notNull()
      .default("needed"),
    citation: text("citation"),
    quote: text("quote"),
    isModified: integer("is_modified", { mode: "boolean" })
      .notNull()
      .default(false),
    modificationNote: text("modification_note"),
    verifiedBy: text("verified_by").references(() => users.id),
    verifiedAt: text("verified_at"),
  },
  (t) => [index("materials_project_idx").on(t.projectId, t.status)],
);

export const crossExamNodes = sqliteTable(
  "cross_exam_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetVariantId: text("target_variant_id").references(() => caseVariants.id),
    direction: text("direction", { enum: ["attack", "defense"] }).notNull(),
    targetClaimId: text("target_claim_id"),
    question: text("question").notNull(),
    purpose: text("purpose").notNull().default(""),
    categoryIds: text("category_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    branches: text("branches", { mode: "json" })
      .$type<CrossExamBranch[]>()
      .notNull(),
  },
  (t) => [index("cx_project_idx").on(t.projectId, t.direction)],
);

export const rebuttals = sqliteTable(
  "rebuttals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** どの相手想定パターンへの反駁か（レビュー M-2） */
    targetVariantId: text("target_variant_id")
      .notNull()
      .references(() => caseVariants.id, { onDelete: "cascade" }),
    targetClaimId: text("target_claim_id").notNull(),
    attackPoint: text("attack_point", {
      enum: ["premise", "evidence", "causality", "impact"],
    }).notNull(),
    argument: text("argument").notNull(),
    categoryIds: text("category_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    sourceRefIds: text("source_ref_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
  },
  (t) => [index("rebuttals_project_idx").on(t.projectId)],
);

/** 本番で引く単位。複数パターン由来の反駁を集約済みのもの */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    opponentArgument: text("opponent_argument").notNull(),
    /** 本番モードの一覧カードに出す「返しの要点」。2タップで読めることの実体 */
    summary: text("summary").notNull(),
    categoryIds: text("category_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    myRebuttalIds: text("my_rebuttal_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    myCrossExamIds: text("my_cross_exam_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    myMaterialIds: text("my_material_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    /** 事前計算した検索用テキスト（本番モード200ms以内の担保） */
    searchText: text("search_text").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("blocks_project_idx").on(t.projectId)],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    variantId: text("variant_id"),
    /** 8ステップの状態。DESIGN §1/§4の「5/8」表示の実体 */
    steps: text("steps", { mode: "json" })
      .$type<GenerationStepState[]>()
      .notNull(),
    status: text("status", {
      // awaiting_review = 論題分析だけ済み、人の確認待ち（DESIGN §3 品質ゲート）
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

/** 完全性: 変更前スナップショットを残し、改ざん検知と復元を可能にする */
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

/** 責任追跡性・否認防止: 追記専用。UPDATE/DELETEしない（不変条件6） */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    userId: text("user_id").notNull(),
    action: text("action", {
      enum: ["generate", "edit", "export", "verify", "login", "pack_build"],
    }).notNull(),
    target: text("target").notNull(),
    detail: text("detail"),
    at: text("at").notNull().default(now),
  },
  (t) => [index("logs_project_idx").on(t.projectId, t.at)],
);

/** A6 コスト可視化。管理画面のみに表示し一般ユーザーには出さない */
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
