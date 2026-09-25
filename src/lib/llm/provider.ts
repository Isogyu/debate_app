/**
 * LLM抽象化レイヤ（REQUIREMENTS.md §4「将来のコスト対策としてモデル呼出は抽象化レイヤ経由にする」）
 *
 * 呼び出し側はこのインターフェースだけを見る。
 * Claude API → 他社API → ローカルモデル の差し替えをアプリ本体に波及させない。
 */

import { z } from "zod";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmResult<T> {
  data: T;
  usage: LlmUsage;
}

export interface StructuredRequest<T> {
  /** 役割・守るべきフォーマットなど */
  system: string;
  /** 実際の指示 */
  prompt: string;
  /** 出力の検証スキーマ。落ちたら呼び出し側がリトライする */
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** 機能ごとにモデルを変えられるようにする（A4 モデル割当設定） */
  model?: string;
}

/** Web検索の結果1件。URL と見出しだけで、本文はこちらで取りに行く */
export interface WebSearchHit {
  url: string;
  title: string;
}

export interface WebSearchRequest {
  query: string;
  /** 検索対象をこのドメインに限る（v6 要件 §1-3a） */
  allowedDomains: string[];
  maxUses?: number;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>>;
  /**
   * 情報源のURLを探す。本文の取得と引用の照合は呼び出し側がコードで行う。
   * ここで返った本文や要約は使わない（捏造の入り口になるため）。
   */
  searchWeb(req: WebSearchRequest): Promise<LlmResult<WebSearchHit[]>>;
}

/** 検証に落ちたときの専用エラー。呼び出し側はこれを見てリトライする */
export class LlmSchemaError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "LlmSchemaError";
    this.raw = raw;
  }
}

/** APIキー未設定など、リトライしても無駄な設定エラー */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/**
 * 出力が上限に達して途中で切れた。
 * JSONとしては必ず壊れるが、原因は「形式ミス」ではなく「長すぎ」なので区別する。
 * 同じ上限でリトライしても必ず同じ結果になるため、リトライしない。
 */
export class LlmTruncatedError extends Error {
  readonly outputTokens: number;
  constructor(message: string, outputTokens: number) {
    super(message);
    this.name = "LlmTruncatedError";
    this.outputTokens = outputTokens;
  }
}
