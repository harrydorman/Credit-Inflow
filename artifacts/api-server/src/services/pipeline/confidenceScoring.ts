/**
 * pipeline/confidenceScoring.ts
 *
 * Computes a 0.0 – 1.0 classification confidence score by combining signals:
 *  1. LLM urgency score (normalised to 0-0.4 range)
 *  2. Deterministic rule matches (keyword hits that corroborate LLM output)
 *  3. Data completeness (issuer found, content enriched beyond snippet)
 *  4. Market validation signal
 *
 * When the final score falls below REVIEW_THRESHOLD, or when specific
 * conditions indicate conflicting / incomplete signals, `needsReview` is set
 * true with a human-readable `reviewReason`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Articles below this threshold are flagged for analyst review. */
export const REVIEW_THRESHOLD = 0.45;

// Score contribution weights (sum to 1.0 max)
const WEIGHT_LLM = 0.35;          // LLM urgency score contribution
const WEIGHT_RULES = 0.25;        // Deterministic rule matches
const WEIGHT_COMPLETENESS = 0.20; // Data completeness (issuer + content depth)
const WEIGHT_MARKET = 0.20;       // Market validation signal alignment

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  /** LLM-returned urgency score 1-5 (null if LLM failed). */
  llmUrgencyScore: number | null;
  /** Number of deterministic rules that matched. */
  rulesMatchedCount: number;
  /** Total confidence boost from all matched rules. */
  rulesConfidenceBoost: number;
  /** Whether a canonical issuer was identified. */
  issuerFound: boolean;
  /** Whether content was enriched beyond the RSS snippet. */
  enrichmentSucceeded: boolean;
  /** Content depth score 0-100. */
  contentDepthScore: number;
  /** Market validation signal from price data. */
  marketValidationSignal: "confirmed" | "mixed" | "unconfirmed" | null;
  /** Sentiment from LLM. */
  sentiment: "positive" | "negative" | "neutral" | null;
  /** LLM-classified event type. */
  eventType: string | null;
}

export interface ConfidenceResult {
  /** Final classification confidence 0.0 – 1.0. */
  confidence: number;
  /** True when confidence is below threshold or signals conflict. */
  needsReview: boolean;
  /** Human-readable reason for review flag (null when needsReview = false). */
  reviewReason: string | null;
  /** Breakdown of how the score was computed (for processingMetadata). */
  breakdown: {
    llmComponent: number;
    rulesComponent: number;
    completenessComponent: number;
    marketComponent: number;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Computes the classification confidence for an article.
 */
export function computeClassificationConfidence(
  input: ConfidenceInput
): ConfidenceResult {
  // ── Component 1: LLM urgency score ────────────────────────────────────────
  // Normalise 1-5 scale → 0.0-1.0, then weight
  const llmNorm = input.llmUrgencyScore != null
    ? (input.llmUrgencyScore - 1) / 4  // maps [1,5] → [0,1]
    : 0;
  const llmComponent = llmNorm * WEIGHT_LLM;

  // ── Component 2: Deterministic rule matches ────────────────────────────────
  // Each rule match gives a direct confidence boost, capped at 1.0, then weighted
  const rulesBoosted = Math.min(1.0, input.rulesConfidenceBoost);
  // Also consider rule count as a secondary factor
  const rulesCountFactor = Math.min(1.0, input.rulesMatchedCount / 3);
  const rulesRaw = (rulesBoosted + rulesCountFactor) / 2;
  const rulesComponent = rulesRaw * WEIGHT_RULES;

  // ── Component 3: Data completeness ────────────────────────────────────────
  let completenessScore = 0;
  if (input.issuerFound) completenessScore += 0.5;
  if (input.enrichmentSucceeded) completenessScore += 0.25;
  if (input.contentDepthScore >= 50) completenessScore += 0.25;
  else if (input.contentDepthScore >= 20) completenessScore += 0.12;
  const completenessComponent = completenessScore * WEIGHT_COMPLETENESS;

  // ── Component 4: Market validation ────────────────────────────────────────
  let marketScore = 0.5; // default: unconfirmed = neutral starting point
  if (input.marketValidationSignal === "confirmed") marketScore = 1.0;
  else if (input.marketValidationSignal === "mixed") marketScore = 0.3;
  else if (input.marketValidationSignal === "unconfirmed") marketScore = 0.5;
  const marketComponent = marketScore * WEIGHT_MARKET;

  // ── Final score ────────────────────────────────────────────────────────────
  const raw = llmComponent + rulesComponent + completenessComponent + marketComponent;
  const confidence = Math.max(0, Math.min(1, raw));

  // ── Review decision ────────────────────────────────────────────────────────
  const reasons: string[] = [];

  if (confidence < REVIEW_THRESHOLD) {
    reasons.push("low_confidence");
  }
  if (!input.issuerFound && input.eventType && input.eventType !== "macro") {
    reasons.push("missing_issuer");
  }
  if (input.marketValidationSignal === "mixed") {
    reasons.push("conflicting_market_signals");
  }
  if (input.llmUrgencyScore == null) {
    reasons.push("ai_unavailable");
  }
  if (input.rulesMatchedCount > 0 && input.llmUrgencyScore != null && input.llmUrgencyScore <= 2) {
    reasons.push("rule_llm_disagreement");
  }

  const needsReview = reasons.length > 0;
  const reviewReason = needsReview ? reasons.join(", ") : null;

  return {
    confidence,
    needsReview,
    reviewReason,
    breakdown: { llmComponent, rulesComponent, completenessComponent, marketComponent },
  };
}
