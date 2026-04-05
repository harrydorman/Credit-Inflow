/**
 * pipeline/types.ts
 *
 * Shared types and enums for the Phase 2 stage-based article processing pipeline.
 */

// ---------------------------------------------------------------------------
// Processing stage enum
// ---------------------------------------------------------------------------

/**
 * The stage an article has reached in the pipeline.
 *
 * Stages progress in this order:
 *   raw → enriched → issuer_identified → classified → scored → validated
 *
 * An article may be stopped at "filtered" if it fails the eligibility check
 * at any point.
 */
export type ProcessingStage =
  | "raw"
  | "filtered"
  | "enriched"
  | "issuer_identified"
  | "classified"
  | "scored"
  | "validated";

/** Ordered sequence of non-terminal stages (skipping "filtered"). */
export const STAGE_ORDER: readonly ProcessingStage[] = [
  "enriched",
  "issuer_identified",
  "classified",
  "scored",
  "validated",
] as const;

// ---------------------------------------------------------------------------
// Processing status enum
// ---------------------------------------------------------------------------

/**
 * The processing lifecycle status.
 *
 * "processed" is kept for Phase 1b backward compatibility.
 * New pipeline code uses "success".
 */
export type ArticleProcessingStatus =
  | "pending"
  | "processing"
  | "success"
  | "processed" // legacy — kept for backward compatibility
  | "failed"
  | "filtered";

// ---------------------------------------------------------------------------
// Stage result types
// ---------------------------------------------------------------------------

/**
 * Metadata emitted by each stage and accumulated into processingMetadata.
 */
export interface StageOutput {
  stage: ProcessingStage;
  durationMs: number;
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/**
 * Result returned by each individual stage function.
 */
export interface StageResult<T = Record<string, unknown>> {
  stage: ProcessingStage;
  durationMs: number;
  data: T;
}

// ---------------------------------------------------------------------------
// Stage-specific data types
// ---------------------------------------------------------------------------

export interface EligibilityData {
  eligible: boolean;
  reason?: string;
  noiseScore?: number;
  titleOverride?: boolean;
}

export interface EnrichmentData {
  rawContent: string;
  contentSourceType: "rss_snippet" | "expanded_article" | "api_fulltext";
  contentDepthScore: number;
}

export interface IssuerData {
  issuerName: string | null;
  source: "ai" | "rule" | "none";
}

export interface ClassificationData {
  eventType: string;
  sector: string;
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  whyItMatters: string;
  urgencyScore: number;
  finalUrgencyScore: number;
  creditSignalScore: number;
  ruleOverrides: import("./deterministicRules").RuleMatch[];
  // Full AI analysis kept for downstream stages
  aiAnalysis: import("../../../lib/aiProcessing").AIAnalysis;
}

export interface ScoringData {
  classificationConfidence: number;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface MarketValidationData {
  stockMove1D: number | null;
  stockMove5D: number | null;
  hyETFMove: number | null;
  validationSignal: "confirmed" | "mixed" | "unconfirmed";
  confidenceScore: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface PipelineResult {
  articleId: number;
  jobId: string;
  finalStage: ProcessingStage;
  finalStatus: ArticleProcessingStatus;
  totalDurationMs: number;
  stageOutputs: StageOutput[];
  classificationConfidence?: number;
  needsReview?: boolean;
}

// ---------------------------------------------------------------------------
// Article input type for pipeline
// ---------------------------------------------------------------------------

/** Minimal fields required to start a pipeline run for an article. */
export interface PipelineArticleInput {
  id: number;
  title: string;
  url: string;
  source: string;
  rawContent: string | null;
  rawSnippet: string | null;
  // May already be present from a prior run
  processingStage: ProcessingStage | null;
}
