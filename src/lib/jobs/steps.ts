/**
 * 生成ステップの一覧（v6）。ジョブの進行・リトライ・失敗の扱いは runner.ts の責務。
 */

import "server-only";
import type { GenStep } from "@/domain/types";
import type { LlmUsage } from "@/lib/llm/provider";
import type { StepContext } from "./common";
import { stepAnalysis, stepCaseBody, stepCaseOutline } from "./steps-case";
import { stepSourceFetch, stepSourcePlan } from "./steps-sources";
import { stepNumberCheck } from "./steps-numbers";
import {
  stepClosing,
  stepCrossExam,
  stepMoreQuestions,
  stepStrategy,
} from "./steps-questions";
import { stepImport } from "./steps-import";

const HANDLERS: Record<GenStep, (ctx: StepContext) => Promise<LlmUsage>> = {
  analysis: stepAnalysis,
  case_outline: stepCaseOutline,
  case_body: stepCaseBody,
  source_plan: stepSourcePlan,
  source_fetch: stepSourceFetch,
  number_check: stepNumberCheck,
  cross_exam: stepCrossExam,
  closing: stepClosing,
  strategy: stepStrategy,
  import: stepImport,
  more_questions: stepMoreQuestions,
};

export async function runStep(step: GenStep, ctx: StepContext): Promise<LlmUsage> {
  return HANDLERS[step](ctx);
}
