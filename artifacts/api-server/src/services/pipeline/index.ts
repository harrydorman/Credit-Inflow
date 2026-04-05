/**
 * pipeline/index.ts
 *
 * Public re-exports for the Phase 2 / 2.5 article processing pipeline.
 */

export { processArticlePipeline } from "./pipelineRunner";
export { PipelineStageError } from "./stages";
export {
  processEligibility,
  processEnrichment,
  extractIssuerHeuristic,
  extractIssuer,
  classifyEvent,
  scoreSignal,
  validateAgainstMarket,
} from "./stages";
export { applyDeterministicRules } from "./deterministicRules";
export { computeClassificationConfidence, REVIEW_THRESHOLD } from "./confidenceScoring";
export {
  PROMPT_VERSION,
  MODEL_VERSION,
  PIPELINE_VERSION,
  RULE_SET_VERSION,
  CONFIDENCE_VERSION,
} from "./traceability";
export type {
  ProcessingStage,
  ArticleProcessingStatus,
  PipelineResult,
  StageOutput,
  StageResult,
  EligibilityData,
  EnrichmentData,
  IssuerData,
  IssuerTracking,
  ClassificationData,
  ScoringData,
  MarketValidationData,
  ProcessingMetadata,
} from "./types";
export { getNextStage, STAGE_ORDER, STAGE_RETRY_MAX } from "./types";
export type { RuleMatch, DeterministicRuleResult } from "./deterministicRules";
export type { ConfidenceInput, ConfidenceResult } from "./confidenceScoring";
