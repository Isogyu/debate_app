/**
 * LLM構造化出力のスキーマ（v6）
 *
 * LLMの出力は必ずここを通す。検証に落ちたら自動リトライ1回、
 * それでも駄目ならそのステップだけ failed にして他は続行する。
 */

import { z } from "zod";

/**
 * 任意の文字列項目。LLMは「値なし」を null で表現することが多いので undefined に寄せる。
 */
const optionalText = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v ?? undefined);

const optionalTextArray = z
  .array(z.string())
  .optional()
  .nullable()
  .transform((v) => v ?? undefined);

const sideSchema = z.enum(["affirmative", "negative"]);

const sectionTypeSchema = z
  .string()
  .transform((v) =>
    (["criteria", "environment", "comparison", "other"] as const).includes(
      v as "criteria",
    )
      ? (v as "criteria" | "environment" | "comparison" | "other")
      : "other",
  );

export const sourceTypeSchema = z.enum([
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

const attackPointSchema = z.enum([
  "premise",
  "evidence",
  "causality",
  "impact",
  "numbers",
]);

const evaluationFrameworkSchema = z.object({
  name: z.string().min(1),
  basisLaw: optionalText,
  criteria: z.array(z.string().min(1)).min(1),
});

export const analysisOutputSchema = z.object({
  policyChange: z.string().min(1),
  statusQuo: z.string().min(1),
  relatedLaws: z.array(z.object({ name: z.string().min(1), article: z.string() })),
  stakeholders: z.array(z.string()),
  coreIssues: z.array(z.string()),
  categories: z
    .array(z.object({ name: z.string().min(1), description: z.string() }))
    .min(1),
  frameworks: z.object({
    affirmative: evaluationFrameworkSchema,
    negative: evaluationFrameworkSchema,
  }),
});

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
          refSlots: z.array(
            z.object({
              slot: z.string().min(1),
              provesWhat: z.string().min(1),
              kind: optionalText,
            }),
          ),
        }),
      ),
    }),
  ),
});

export const lengthAdjustSchema = z.object({
  paragraphs: z.array(
    z.object({
      id: z.string().min(1),
      claim: z.string().min(1),
      warrant: z.string(),
      impact: z.string(),
    }),
  ),
});

export const paragraphTextSchema = z.object({
  claim: z.string().min(1),
  warrant: z.string(),
  impact: z.string(),
});

export const claimRegenerationSchema = z.object({
  claim: z.string().min(1),
  warrant: z.string(),
  causalChain: z.array(z.string()),
  impact: z.string(),
});

export const importStructureSchema = z.object({
  claim: z.tuple([z.number().int(), z.number().int()]),
  sections: z
    .array(
      z.object({
        titleLine: z.number().int(),
        type: sectionTypeSchema,
        intro: z.tuple([z.number().int(), z.number().int()]).nullable().optional(),
        subsections: z
          .array(
            z.object({
              titleLine: z.number().int(),
              body: z.tuple([z.number().int(), z.number().int()]),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  conclusion: z.tuple([z.number().int(), z.number().int()]),
});

// ── 資料 ─────────────────────────────────────────────
export const sourcePlanSchema = z.object({
  requirements: z.array(
    z.object({
      slot: z.string().min(1),
      provesWhat: z.string().min(1),
      sourceType: sourceTypeSchema.catch("govt_doc"),
      description: z.string(),
      searchKeywords: z.array(z.string()),
      suggestedSourceIds: z.array(z.string()),
      formatHint: z
        .enum(["quote", "chart", "table", "law_text", "self_made"])
        .catch("quote"),
      categoryNames: z.array(z.string()),
      lawName: optionalText,
      article: optionalText,
      statKeywords: optionalTextArray,
      statisticSteps: optionalTextArray,
      webQuery: optionalText,
      whatToExtract: z.string().default(""),
    }),
  ),
});

export const pickQuoteSchema = z.object({
  found: z.boolean(),
  quote: optionalText,
  why: optionalText,
});

export const pickSpeechSchema = z.object({
  found: z.boolean(),
  index: z.number().int().optional().nullable(),
  quote: optionalText,
  why: optionalText,
});

export const pickStatTableSchema = z.object({
  found: z.boolean(),
  tableId: optionalText,
  why: optionalText,
});

export const buildStatisticSchema = z.object({
  found: z.boolean(),
  inputs: z
    .array(z.object({ key: z.string().min(1), row: z.string().min(1), label: z.string().min(1) }))
    .default([]),
  formulas: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        operation: z.enum(["ratio", "percent", "growth", "difference", "per_capita", "share"]),
        a: z.string().min(1),
        b: z.string().min(1),
        unit: z.string().default(""),
      }),
    )
    .default([]),
  chart: z
    .object({
      type: z.enum(["bar", "line"]).catch("bar"),
      title: z.string().default(""),
      points: z.array(z.string()),
    })
    .optional()
    .nullable(),
  tableRows: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

export const numberUsageSchema = z.object({
  findings: z.array(
    z.object({
      index: z.number().int(),
      severity: z.enum(["high", "medium", "low"]).catch("medium"),
      message: z.string().min(1),
    }),
  ),
});

// ── 質疑 ─────────────────────────────────────────────
export const crossExamChainsSchema = z.object({
  chains: z.array(
    z.object({
      attackPoint: attackPointSchema.catch("premise"),
      goal: z.string().default(""),
      priority: z.coerce.number().int().min(1).max(5).catch(3),
      categoryNames: z.array(z.string()).default([]),
      nodes: z
        .array(
          z.object({
            key: z.string().min(1),
            question: z.string().min(1),
            purpose: z.string().default(""),
            modelAnswer: z.string().default(""),
            branches: z
              .array(
                z.object({
                  kind: z.enum(["admit", "deny", "evade"]).catch("admit"),
                  expectedAnswer: z.string().min(1),
                  followUpKey: optionalText,
                  exposedWeakness: optionalText,
                }),
              )
              .default([]),
          }),
        )
        .min(1),
    }),
  ),
});

const closingPerspectiveSchema = z.object({
  frame: z.string().min(1),
  blanks: z.array(
    z.object({ key: z.string().min(1), label: z.string().min(1), hint: z.string().default("") }),
  ),
  examples: z.array(
    z.object({
      pathLabel: z.string().min(1),
      chainId: optionalText,
      text: z.string().min(1),
    }),
  ),
});

export const closingSchema = z.object({
  own: closingPerspectiveSchema,
  opponent: closingPerspectiveSchema,
});

export const strategySchema = z.object({
  summary: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.object({ point: z.string().min(1), why: z.string() })),
  defend: z.array(z.string()),
  neverConcede: z.array(z.string()),
  winningPath: z.string(),
  howToAttack: z.array(z.string()),
});

// ── 質疑シミュレーター ─────────────────────────────────
export const simulatorReplySchema = z.object({
  reply: z.string().min(1),
  /** 生成済みの質疑を使った場合、そのノードのキー */
  usedKey: optionalText,
});

export const simulatorFeedbackSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
  chains: z
    .array(
      z.object({
        key: z.string(),
        reached: z.boolean(),
        note: z.string().default(""),
      }),
    )
    .default([]),
  stuckKeys: z.array(z.string()).default([]),
  newQuestions: z
    .array(
      z.object({
        question: z.string().min(1),
        modelAnswer: z.string().default(""),
        paragraph: z.string().default(""),
        attackPoint: attackPointSchema.catch("premise"),
      }),
    )
    .default([]),
  closingExample: optionalText,
});
