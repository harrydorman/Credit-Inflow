/**
 * pipeline/stages.ts
 *
 * Modular stage functions for the article processing pipeline.
 *
 * Each function:
 *  - accepts a typed input and returns a typed StageResult
 *  - records its own timing
 *  - throws a controlled PipelineStageError on failure (wrapping the root cause)
 *  - does NOT update the DB — that is the pipeline runner's responsibility
 */
import type { AIAnalysis } from "../../lib/aiProcessing";
import { analyzeArticle, passesNoiseFilter, isCreditTitleOverride } from "../../lib/aiProcessing";
import { enrichContent } from "../../lib/contentEnricher";
import { canonicalizeIssuer } from "../../lib/canonicalIssuers";
import { validateWithMarketData, getETFSnapshot } from "../../lib/marketData";
import { applyDeterministicRules } from "./deterministicRules";
import { computeClassificationConfidence } from "./confidenceScoring";
import type {
  StageResult,
  EligibilityData,
  EnrichmentData,
  IssuerData,
  ClassificationData,
  ScoringData,
  MarketValidationData,
} from "./types";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Thrown by stage functions when a controlled, expected failure occurs. */
export class PipelineStageError extends Error {
  override readonly name = "PipelineStageError";
  constructor(
    public readonly stage: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[${stage}] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Stage 1: Eligibility
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  title: string;
  rawContent: string | null;
}

/**
 * Checks whether the article has sufficient content and passes the noise filter.
 *
 * This stage does NOT write to the DB. When `eligible = false`, the pipeline
 * runner must set processingStage = "filtered" and stop.
 */
export async function processEligibility(
  input: EligibilityInput
): Promise<StageResult<EligibilityData>> {
  const start = Date.now();
  const { title, rawContent } = input;

  const hasContent = (rawContent?.trim().length ?? 0) > 0;
  if (!hasContent) {
    const titleOverride = isCreditTitleOverride(title);
    return {
      stage: "enriched", // next stage will handle enrichment
      durationMs: Date.now() - start,
      data: {
        eligible: titleOverride, // credit title override may save it
        reason: titleOverride ? undefined : "empty_content",
        titleOverride,
      },
    };
  }

  const noisePass = passesNoiseFilter(title, rawContent);
  const titleOverride = !noisePass && isCreditTitleOverride(title);

  if (!noisePass && !titleOverride) {
    return {
      stage: "enriched",
      durationMs: Date.now() - start,
      data: {
        eligible: false,
        reason: "noise_filtered",
        titleOverride: false,
      },
    };
  }

  return {
    stage: "enriched",
    durationMs: Date.now() - start,
    data: {
      eligible: true,
      titleOverride,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 2: Enrichment
// ---------------------------------------------------------------------------

export interface EnrichmentInput {
  url: string;
  source: string;
  rawSnippet: string;
}

/**
 * Attempts to enrich the article content by fetching the full article HTML.
 *
 * Falls back to the raw RSS snippet on any fetch failure (non-fatal).
 */
export async function processEnrichment(
  input: EnrichmentInput
): Promise<StageResult<EnrichmentData>> {
  const start = Date.now();
  try {
    const enriched = await enrichContent(input.url, input.source, input.rawSnippet);
    return {
      stage: "issuer_identified",
      durationMs: Date.now() - start,
      data: {
        rawContent: enriched.rawContent,
        contentSourceType: enriched.contentSourceType,
        contentDepthScore: enriched.contentDepthScore,
      },
    };
  } catch (err) {
    // Enrichment failure is non-fatal: fall back to snippet
    const fallbackDepth = Math.min(30, Math.floor(input.rawSnippet.length / 10));
    return {
      stage: "issuer_identified",
      durationMs: Date.now() - start,
      data: {
        rawContent: input.rawSnippet,
        contentSourceType: "rss_snippet",
        contentDepthScore: fallbackDepth,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 3a: Early heuristic issuer extraction (before classification)
// ---------------------------------------------------------------------------

export interface EarlyIssuerInput {
  title: string;
  rawContent: string | null;
}

/**
 * Attempts to identify the issuer using simple heuristics (regex + title
 * parsing) BEFORE the AI classification stage. This early guess is stored in
 * processingMetadata.issuerTracking.initialGuess and may be overridden by
 * the post-classification refined pass.
 *
 * Returns null issuerName when no heuristic match is found.
 */
export async function extractIssuerHeuristic(
  input: EarlyIssuerInput
): Promise<StageResult<IssuerData>> {
  const start = Date.now();
  const text = `${input.title} ${input.rawContent ?? ""}`;

  // Simple heuristic: look for capitalized proper-noun sequences that are
  // commonly issuer names (2-3 consecutive title-cased words, not all-caps
  // acronyms, not common English stop words).
  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "as", "is", "was", "are", "were", "be", "been",
    "has", "have", "had", "will", "would", "could", "should", "may", "might",
    "its", "this", "that", "these", "those", "said", "says", "after", "before",
    "amid", "over", "under", "from", "into", "per", "via",
  ]);

  const words = input.title.split(/\s+/);
  const candidates: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z'-]/g, "");
    const isCapitalized = /^[A-Z][a-z]/.test(clean);
    const isStop = STOP_WORDS.has(clean.toLowerCase());

    if (isCapitalized && !isStop && clean.length > 1) {
      current.push(clean);
    } else {
      if (current.length >= 1) candidates.push(current.join(" "));
      current = [];
    }
  }
  if (current.length >= 1) candidates.push(current.join(" "));

  // Take the longest candidate sequence from the title as the guess
  const bestGuess = candidates.sort((a, b) => b.length - a.length)[0] ?? null;

  // Try to canonicalize; if no canonical match, still return the raw guess
  const canonical = bestGuess ? (canonicalizeIssuer(bestGuess) ?? bestGuess) : null;

  return {
    stage: "issuer_identified",
    durationMs: Date.now() - start,
    data: {
      issuerName: canonical,
      source: canonical ? "heuristic" : "none",
      mode: "early",
    },
  };
}

export interface IssuerInput {
  title: string;
  rawContent: string | null;
  /** Optional issuer extracted by LLM (passed in after classifyEvent if available). */
  aiIssuerName?: string | null;
  /** Early heuristic guess from the pre-classification pass (used as fallback). */
  earlyGuess?: string | null;
}

/**
 * Refined issuer identification using the AI-extracted name (post-classification).
 *
 * Priority: AI-extracted name → early heuristic guess → null.
 * The `source` and `mode` fields record how the issuer was found.
 */
export async function extractIssuer(
  input: IssuerInput
): Promise<StageResult<IssuerData>> {
  const start = Date.now();

  if (input.aiIssuerName) {
    const canonical = canonicalizeIssuer(input.aiIssuerName.trim());
    if (canonical) {
      return {
        stage: "classified",
        durationMs: Date.now() - start,
        data: { issuerName: canonical, source: "ai", mode: "refined" },
      };
    }
  }

  // Fall back to early heuristic guess when AI didn't extract one
  if (input.earlyGuess) {
    return {
      stage: "classified",
      durationMs: Date.now() - start,
      data: { issuerName: input.earlyGuess, source: "heuristic", mode: "refined" },
    };
  }

  return {
    stage: "classified",
    durationMs: Date.now() - start,
    data: { issuerName: null, source: "none", mode: "refined" },
  };
}

// ---------------------------------------------------------------------------
// Stage 4: Classification
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  title: string;
  rawContent: string | null;
}

/**
 * Calls the AI to classify the article and applies deterministic rule overrides.
 *
 * Throws `PipelineStageError` when the AI returns null (no API key, network error).
 */
export async function classifyEvent(
  input: ClassificationInput
): Promise<StageResult<ClassificationData>> {
  const start = Date.now();

  let aiAnalysis: AIAnalysis | null;
  try {
    aiAnalysis = await analyzeArticle(input.title, input.rawContent);
  } catch (err) {
    throw new PipelineStageError(
      "classified",
      "AI analysis threw an unexpected error",
      err
    );
  }

  if (!aiAnalysis) {
    throw new PipelineStageError(
      "classified",
      "AI analysis returned null — no API key or model error"
    );
  }

  // Apply deterministic rules on top of AI output
  const combinedText = `${input.title} ${input.rawContent ?? ""}`;
  const rules = applyDeterministicRules(combinedText, aiAnalysis.eventType);

  // Merge flag overrides from rules into the analysis
  const mergedAnalysis: AIAnalysis = {
    ...aiAnalysis,
    eventType: rules.eventType,
    covenantFlag: aiAnalysis.covenantFlag || (rules.flagOverrides.covenantFlag === true),
    distressedRisk: aiAnalysis.distressedRisk || (rules.flagOverrides.distressedRisk === true),
    ratingIsDowngrade: aiAnalysis.ratingIsDowngrade || (rules.flagOverrides.ratingIsDowngrade === true),
    // Cap urgency boost at 10
    finalUrgencyScore: Math.min(10, aiAnalysis.finalUrgencyScore + rules.urgencyBoost),
  };

  return {
    stage: "scored",
    durationMs: Date.now() - start,
    data: {
      eventType: mergedAnalysis.eventType,
      sector: mergedAnalysis.sector,
      sentiment: mergedAnalysis.sentiment,
      summary: mergedAnalysis.summary,
      whyItMatters: mergedAnalysis.whyItMatters,
      urgencyScore: mergedAnalysis.urgencyScore,
      finalUrgencyScore: mergedAnalysis.finalUrgencyScore,
      creditSignalScore: mergedAnalysis.creditSignalScore,
      ruleOverrides: rules.matches,
      aiAnalysis: mergedAnalysis,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 5: Scoring
// ---------------------------------------------------------------------------

export interface ScoringInput {
  llmUrgencyScore: number | null;
  rulesMatchedCount: number;
  rulesConfidenceBoost: number;
  issuerFound: boolean;
  enrichmentSucceeded: boolean;
  contentDepthScore: number;
  marketValidationSignal: "confirmed" | "mixed" | "unconfirmed" | null;
  sentiment: "positive" | "negative" | "neutral" | null;
  eventType: string | null;
}

/**
 * Computes classification confidence and sets needsReview flag.
 */
export async function scoreSignal(
  input: ScoringInput
): Promise<StageResult<ScoringData>> {
  const start = Date.now();

  const result = computeClassificationConfidence({
    llmUrgencyScore: input.llmUrgencyScore,
    rulesMatchedCount: input.rulesMatchedCount,
    rulesConfidenceBoost: input.rulesConfidenceBoost,
    issuerFound: input.issuerFound,
    enrichmentSucceeded: input.enrichmentSucceeded,
    contentDepthScore: input.contentDepthScore,
    marketValidationSignal: input.marketValidationSignal,
    sentiment: input.sentiment,
    eventType: input.eventType,
  });

  return {
    stage: "validated",
    durationMs: Date.now() - start,
    data: {
      classificationConfidence: result.confidence,
      needsReview: result.needsReview,
      reviewReason: result.reviewReason,
      confidenceBreakdown: result.breakdown,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 6: Market validation
// ---------------------------------------------------------------------------

export interface MarketValidationInput {
  issuerName: string | null;
  sentiment: string | null;
  finalUrgencyScore: number | null;
  creditSignalScore: number | null;
}

/**
 * Fetches stock and ETF data to validate the article's credit signal against
 * live market movements.
 *
 * Failure is non-fatal — returns `unconfirmed` signal on any error.
 */
export async function validateAgainstMarket(
  input: MarketValidationInput
): Promise<StageResult<MarketValidationData>> {
  const start = Date.now();
  try {
    const etfSnapshot = await getETFSnapshot();
    const result = await validateWithMarketData({
      issuerName: input.issuerName,
      sentiment: input.sentiment,
      finalUrgencyScore: input.finalUrgencyScore,
      creditSignalScore: input.creditSignalScore,
      etfSnapshot,
    });

    return {
      stage: "validated",
      durationMs: Date.now() - start,
      data: {
        stockMove1D: result.stockMove1D,
        stockMove5D: result.stockMove5D,
        hyETFMove: result.hyETFMove,
        validationSignal: result.validationSignal,
        confidenceScore: result.confidenceScore,
      },
    };
  } catch (err) {
    // Market data failure is non-fatal
    return {
      stage: "validated",
      durationMs: Date.now() - start,
      data: {
        stockMove1D: null,
        stockMove5D: null,
        hyETFMove: null,
        validationSignal: "unconfirmed",
        confidenceScore: "low",
      },
    };
  }
}
