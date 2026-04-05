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

/** Ordered sequence of non-terminal, non-raw stages (the progression through the pipeline). */
export const STAGE_ORDER: readonly ProcessingStage[] = [
  "enriched",
  "issuer_identified",
  "classified",
  "scored",
  "validated",
] as const;

/**
 * Returns the next stage after `current` in the pipeline, or null if `current`
 * is the final stage or a terminal stage (raw / filtered).
 *
 * Used by the pipeline runner to implement partial resume.
 */
export function getNextStage(current: ProcessingStage): ProcessingStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1) return STAGE_ORDER[0] ?? null; // "raw" or "filtered" → start from enriched
  return STAGE_ORDER[idx + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Per-stage retry policy
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts per individual stage before permanent failure. */
export const STAGE_RETRY_MAX = 3;

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
  source: "ai" | "rule" | "heuristic" | "none";
  /** "early" = heuristic pass before classification; "refined" = AI-assisted pass after classification. */
  mode: "early" | "refined";
}

/** Issuer tracking across both extraction passes (stored in processingMetadata). */
export interface IssuerTracking {
  initialGuess: string | null;
  initialGuessSource: "heuristic" | "none";
  final: string | null;
  finalSource: "ai" | "heuristic" | "none";
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
  confidenceBreakdown: {
    llmComponent: number;
    rulesComponent: number;
    completenessComponent: number;
    marketComponent: number;
  };
}

export interface MarketValidationData {
  stockMove1D: number | null;
  stockMove5D: number | null;
  hyETFMove: number | null;
  validationSignal: "confirmed" | "mixed" | "unconfirmed";
  confidenceScore: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Standardized processingMetadata shape
// ---------------------------------------------------------------------------

/**
 * Canonical shape for the processingMetadata JSON column.
 *
 * This structure is enforced by the pipeline runner. Old runs may have a
 * subset of these fields; consumers should treat all fields as optional.
 */
export interface ProcessingMetadata {
  pipelineVersion: string;
  ruleSetVersion: string;
  confidenceVersion: string;
  stageOutputs: StageOutput[];
  confidenceBreakdown?: {
    llmComponent: number;
    rulesComponent: number;
    completenessComponent: number;
    marketComponent: number;
  };
  issuerTracking?: IssuerTracking;
  /** The stage at which the pipeline failed, if applicable. */
  failedAtStage?: ProcessingStage;
  /** Matched rule names for auditing. */
  rulesMatched?: string[];
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
  /** True when the pipeline was resumed from a previous partial run. */
  resumed?: boolean;
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
  processingStatus: string | null;
  stageRetryCounts: Record<string, number> | null;
}
