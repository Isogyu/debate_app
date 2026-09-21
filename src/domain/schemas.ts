/**
 * LLM構造化出力のスキーマ（REQUIREMENTS.md §6.3 エラー設計）
 *
 * LLMの出力は必ずここを通す。検証に落ちたら自動リトライ1回、
 * それでも駄目ならそのステップだけ failed にして他は続行する。
 */

import { z } from "zod";

/**
 * 任意の文字列項目。
 *
 * LLMは「値なし」を項目の省略ではなく `null` で表現することが多い。
 * `.optional()` だけだと null を弾いてしまい、
 * 「分岐の終端（次の質問がない）」のような正常な出力で生成全体が失敗する。
 * 実際に質疑フローの生成がこれで落ちたため、null も受けて undefined に寄せる。
 */
const optionalText = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v ?? undefined);

const sideSchema = z.enum(["affirmative", "negative"]);

const sectionTypeSchema = z.enum([
  "criteria",
  "environment",
  "comparison",
  "other", // 実例にない構成も登録できるようにする（§8）
]);

const sourceTypeSchema = z.enum([
  "law",
  "precedent",
  "statistic",
  "paper",
  "govt_doc",
  "diet_record",
  "news",
  "book",
  "org_doc",
  "self_made",
]);

const attackPointSchema = z.enum(["premise", "evidence", "causality", "impact"]);

const evaluationFrameworkSchema = z.object({
  name: z.string().min(1),
  basisLaw: optionalText,
  criteria: z.array(z.string().min(1)).min(1),
});

/** 条文全文はLLMに書かせない。名称と条番号だけ返させ、全文は人が入れる（§13-4） */
const lawRefSchema = z.object({
  name: z.string().min(1),
  article: z.string().min(1),
});

export const analysisOutputSchema = z.object({
  policyChange: z.string().min(1),
  statusQuo: z.string().min(1),
  relatedLaws: z.array(lawRefSchema),
  stakeholders: z.array(z.string()),
  coreIssues: z.array(z.string()),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
      }),
    )
    .min(1),
  frameworks: z.object({
    affirmative: evaluationFrameworkSchema,
    negative: evaluationFrameworkSchema,
  }),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const caseOutlineOutputSchema = z.object({
  side: sideSchema,
  framework: z.string().min(1),
  approach: z.string().min(1),
  valuePremise: z.string(),
  claim: z.string().min(1),
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        type: sectionTypeSchema,
        subsectionTitles: z.array(z.string().min(1)),
      }),
    )
    .min(1),
  conclusion: z.string().min(1),
});
export type CaseOutlineOutput = z.infer<typeof caseOutlineOutputSchema>;

/**
 * 本文。資料参照は `refSlots` に宣言させ、本文中では `【資料{slot}参照】` を使わせる。
 * 実際の番号への変換は保存時に renumberSourceRefs が行う。
 */
export const caseBodyOutputSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string().min(1),
      type: sectionTypeSchema,
      subsections: z.array(
        z.object({
          title: z.string().min(1),
          claim: z.string().min(1),
          warrant: z.string(),
          causalChain: z.array(z.string()),
          impact: z.string(),
          categoryNames: z.array(z.string()),
          /** この段落が必要とする資料。後段で資料要件へ展開する */
          refSlots: z.array(
            z.object({
              slot: z.string().min(1), // 本文中の【資料{slot}参照】と対応
              provesWhat: z.string().min(1),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type CaseBodyOutput = z.infer<typeof caseBodyOutputSchema>;

export const sourceRequirementOutputSchema = z.object({
  requirements: z.array(
    z.object({
      slot: z.string().min(1),
      provesWhat: z.string().min(1),
      sourceType: sourceTypeSchema,
      description: z.string(),
      searchKeywords: z.array(z.string()),
      /** ホワイトリストのIDのみ。範囲外は sanitize で落とす */
      suggestedSourceIds: z.array(z.string()),
      formatHint: z.enum(["quote", "chart", "table", "law_text", "self_made"]),
      categoryNames: z.array(z.string()),
    }),
  ),
});
export type SourceRequirementOutput = z.infer<
  typeof sourceRequirementOutputSchema
>;

export const crossExamOutputSchema = z.object({
  nodes: z.array(
    z.object({
      key: z.string().min(1), // 出力内での一時ID
      direction: z.enum(["attack", "defense"]),
      question: z.string().min(1),
      purpose: z.string(),
      categoryNames: z.array(z.string()),
      targetClaimTitle: optionalText,
      branches: z.array(
        z.object({
          expectedAnswer: z.string().min(1),
          followUpKey: optionalText,
          exposedWeakness: optionalText,
        }),
      ),
    }),
  ),
});
export type CrossExamOutput = z.infer<typeof crossExamOutputSchema>;

export const rebuttalOutputSchema = z.object({
  rebuttals: z.array(
    z.object({
      targetClaimTitle: z.string().min(1),
      attackPoint: attackPointSchema,
      argument: z.string().min(1),
      categoryNames: z.array(z.string()),
    }),
  ),
});
export type RebuttalOutput = z.infer<typeof rebuttalOutputSchema>;

/** 複数の相手想定パターン由来の反駁を、主張の類型で集約させる（§8-7） */
export const blocksOutputSchema = z.object({
  blocks: z.array(
    z.object({
      opponentArgument: z.string().min(1),
      summary: z.string().min(1), // 本番の一覧カードに出る「返しの要点」
      categoryNames: z.array(z.string()),
      rebuttalArguments: z.array(z.string()),
    }),
  ),
});
export type BlocksOutput = z.infer<typeof blocksOutputSchema>;

export const comparisonOutputSchema = z.object({
  criteria: z.array(
    z.object({
      name: z.string().min(1),
      categoryName: z.string().min(1), // 争点カテゴリに紐づける（§14）
      affirmative: z.string(),
      negative: z.string(),
    }),
  ),
  verdictLogic: z.string(),
});
export type ComparisonOutput = z.infer<typeof comparisonOutputSchema>;

/**
 * サブセクション1つ分の再生成（DESIGN §5「この部分を再生成」）。
 * 資料参照は既存の番号をそのまま使わせるため、slot宣言は求めない。
 */
export const claimRegenerationSchema = z.object({
  claim: z.string().min(1),
  warrant: z.string(),
  causalChain: z.array(z.string()),
  impact: z.string(),
});
export type ClaimRegeneration = z.infer<typeof claimRegenerationSchema>;

// ── 質疑シミュレーター（U9） ──────────────────────────
export const simulatorReplySchema = z.object({
  reply: z.string().min(1),
});

export const simulatorFeedbackSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
});

export const STEP_SCHEMAS = {
  analysis: analysisOutputSchema,
  case_outline: caseOutlineOutputSchema,
  case_body: caseBodyOutputSchema,
  source_req: sourceRequirementOutputSchema,
  cross_exam: crossExamOutputSchema,
  rebuttal: rebuttalOutputSchema,
  blocks: blocksOutputSchema,
  comparison: comparisonOutputSchema,
} as const;
