import type { AlertEvent } from "@workspace/api-client-react";

// ─── ranking model version ────────────────────────────────────────────────────

/**
 * Versioned identifier for the ranking model.
 *
 * Bump this constant whenever weights, thresholds, or the scoring logic
 * changes so that breakdowns and evaluation outputs can be correlated with
 * the model that produced them.
 *
 * Format: "v<major>.<minor>.<patch>"
 */
export const RANKING_MODEL_VERSION = "v1.1.0";

// ─── calibration config ───────────────────────────────────────────────────────

/**
 * Centralised ranking calibration config.
 *
 * All threshold and max-weight constants are defined here so that tuning a
 * single parameter requires a one-line change, and every compute function
 * automatically picks up the new value.
 *
 * To re-calibrate safely:
 *   1. Edit the value here.
 *   2. Bump RANKING_MODEL_VERSION.
 *   3. Run tests — score-consistency tests will confirm existing behaviour
 *      or highlight the intended change.
 */
export const RANKING_CALIBRATION_CONFIG = {
  eventTypeBoost: {
    /** Minimum usefulness score before a boost applies (0–1). */
    threshold: 0.7,
    /** Maximum points that can be added for a useful event type. */
    max: 8,
  },
  issuerBoost: {
    /** Minimum investigate-rate before a boost applies (0–1). */
    threshold: 0.6,
    /** Maximum points that can be added for a high-investigate-rate issuer. */
    max: 8,
  },
  ruleNoisePenalty: {
    /** Minimum noise-rate before a penalty applies (0–1). */
    threshold: 0.5,
    /** Maximum points that can be deducted for a high-noise rule. */
    max: 8,
  },
  /** Hard cap on the absolute value of the total analytics adjustment. */
  totalAdjustmentCap: 15,
} as const;

// ─── types ────────────────────────────────────────────────────────────────────

export type PriorityLabel = "Critical" | "High" | "Medium" | "Low";

export type AnalystAction = "investigate" | "monitor" | "ignore" | null;

export interface AlertPriority {
  score: number;
  label: PriorityLabel;
  explanation: string;
  /** True when the score includes analytics-informed adjustments */
  analyticsAdjusted?: boolean;
  /** Structured breakdown of how the score was computed */
  breakdown?: RankingBreakdown;
}

/**
 * Structured ranking breakdown for a single alert.
 * Exposes all component scores so callers can inspect, display, and
 * compare baseline vs analytics-informed ranking.
 */
export interface RankingBreakdown {
  // ── base components ────────────────────────────────────────────────
  /** Severity contribution (0/10/25/40) */
  severityScore: number;
  /** Confidence contribution (confidence × 30, 0–30) */
  confidenceScore: number;
  /** Portfolio exposure contribution (0 or 20) */
  portfolioScore: number;
  /** Urgency contribution ((urgency/10) × 10, 0–10) */
  urgencyScore: number;
  /** Sum of the four base components (before analytics, before clamping) */
  baseScore: number;

  // ── analytics adjustment components ───────────────────────────────
  /** Points added because this event type is historically useful (0–8) */
  eventTypeBoost: number;
  /** Points added because this issuer often requires investigation (0–8) */
  issuerBoost: number;
  /** Points deducted because this rule has a high noise ratio (0–8, stored as positive) */
  ruleNoisePenalty: number;
  /** Net analytics delta after capping (analyticsAdjustment = eventTypeBoost + issuerBoost - ruleNoisePenalty, capped at ±MAX_TOTAL_ADJUSTMENT) */
  analyticsAdjustment: number;

  // ── final ──────────────────────────────────────────────────────────
  /** baseScore + analyticsAdjustment, clamped to [0, 100] */
  finalScore: number;
  /** Priority label derived from finalScore */
  finalLabel: PriorityLabel;
  /** True when analyticsAdjustment !== 0 */
  analyticsAdjusted: boolean;
  /** Ranking model version that produced this breakdown */
  modelVersion: string;
}

/**
 * Per-alert analytics context used to compute ranking adjustments.
 * All fields are optional — missing scores simply produce no adjustment.
 */
export interface RankingContext {
  /** Fraction 0–1: how often this event type is rated "useful" */
  eventTypeUsefulnessScore?: number;
  /** Fraction 0–1: how often this issuer triggers an investigate action */
  issuerInvestigateScore?: number;
  /** Fraction 0–1: how often alerts from the triggering rule are rated "noise" */
  ruleNoiseScore?: number;
}

/**
 * Controls whether analytics adjustments are layered onto the base score.
 *
 * - `"baseline"`          – pure base score, no adjustments (default)
 * - `"analytics-informed"` – base score + capped analytics adjustment
 *
 * Change this constant to roll out / roll back analytics-informed ranking.
 */
export const RANKING_MODE: "baseline" | "analytics-informed" =
  "analytics-informed";

// ─── base scoring weights ────────────────────────────────────────────────────

const SEVERITY_SCORE: Record<string, number> = {
  high: 40,
  medium: 25,
  low: 10,
};

const PORTFOLIO_BONUS = 20;
const MAX_CONFIDENCE_SCORE = 30;
const MAX_URGENCY_SCORE = 10;

// ─── analytics adjustment constants ──────────────────────────────────────────

// Convenience aliases — keep these so existing code that imports
// MAX_TOTAL_ADJUSTMENT continues to compile without changes.

/** Minimum usefulness score before an event-type boost applies. */
const EVENT_TYPE_BOOST_THRESHOLD = RANKING_CALIBRATION_CONFIG.eventTypeBoost.threshold;
/** Max points added for a highly useful event type. */
const EVENT_TYPE_BOOST_MAX = RANKING_CALIBRATION_CONFIG.eventTypeBoost.max;

/** Minimum investigate-rate before an issuer boost applies. */
const ISSUER_INVESTIGATE_THRESHOLD = RANKING_CALIBRATION_CONFIG.issuerBoost.threshold;
/** Max points added for a high-investigate-rate issuer. */
const ISSUER_INVESTIGATE_BOOST_MAX = RANKING_CALIBRATION_CONFIG.issuerBoost.max;

/** Minimum noise rate before a rule penalty applies. */
const RULE_NOISE_THRESHOLD = RANKING_CALIBRATION_CONFIG.ruleNoisePenalty.threshold;
/** Max points deducted for a high-noise rule. */
const RULE_NOISE_PENALTY_MAX = RANKING_CALIBRATION_CONFIG.ruleNoisePenalty.max;

/** Hard cap on the absolute value of the total analytics adjustment. */
export const MAX_TOTAL_ADJUSTMENT = RANKING_CALIBRATION_CONFIG.totalAdjustmentCap;

// ─── helpers ──────────────────────────────────────────────────────────────────

function deriveSeverity(alert: AlertEvent): "high" | "medium" | "low" | null {
  if (alert.severity) return alert.severity;
  const u = alert.urgency ?? null;
  if (u == null) return null;
  if (u >= 8) return "high";
  if (u >= 5) return "medium";
  return "low";
}

// ─── analytics adjustment ─────────────────────────────────────────────────────

/**
 * Compute an analytics-informed adjustment for an alert given optional context.
 * Returns the numeric delta, human-readable reasons, and individual component
 * values so callers can build structured breakdowns.
 *
 * Individual contributions are linearly scaled from their threshold to their
 * maximum, then the total is hard-capped at ±MAX_TOTAL_ADJUSTMENT.
 */
export function computeAnalyticsAdjustment(ctx: RankingContext): {
  delta: number;
  reasons: string[];
  eventTypeBoost: number;
  issuerBoost: number;
  ruleNoisePenalty: number;
} {
  const reasons: string[] = [];
  let eventTypeBoost = 0;
  let issuerBoost = 0;
  let ruleNoisePenalty = 0;

  // Event-type usefulness boost
  const etScore = ctx.eventTypeUsefulnessScore ?? 0;
  if (etScore >= EVENT_TYPE_BOOST_THRESHOLD) {
    const raw = Math.round(
      ((etScore - EVENT_TYPE_BOOST_THRESHOLD) /
        (1 - EVENT_TYPE_BOOST_THRESHOLD)) *
        EVENT_TYPE_BOOST_MAX,
    );
    if (raw > 0) {
      eventTypeBoost = raw;
      reasons.push("boosted because this event type is historically useful");
    }
  }

  // Issuer investigate boost
  const issuerScore = ctx.issuerInvestigateScore ?? 0;
  if (issuerScore >= ISSUER_INVESTIGATE_THRESHOLD) {
    const raw = Math.round(
      ((issuerScore - ISSUER_INVESTIGATE_THRESHOLD) /
        (1 - ISSUER_INVESTIGATE_THRESHOLD)) *
        ISSUER_INVESTIGATE_BOOST_MAX,
    );
    if (raw > 0) {
      issuerBoost = raw;
      reasons.push("boosted because this issuer often requires investigation");
    }
  }

  // Rule noise penalty
  const noiseScore = ctx.ruleNoiseScore ?? 0;
  if (noiseScore >= RULE_NOISE_THRESHOLD) {
    const raw = Math.round(
      ((noiseScore - RULE_NOISE_THRESHOLD) / (1 - RULE_NOISE_THRESHOLD)) *
        RULE_NOISE_PENALTY_MAX,
    );
    if (raw > 0) {
      ruleNoisePenalty = raw;
      reasons.push("reduced because this rule has a high noise ratio");
    }
  }

  const uncapped = eventTypeBoost + issuerBoost - ruleNoisePenalty;
  const delta = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, uncapped));
  return { delta, reasons, eventTypeBoost, issuerBoost, ruleNoisePenalty };
}

// ─── computeRankingBreakdown ──────────────────────────────────────────────────

/**
 * Compute a fully structured ranking breakdown for an alert.
 *
 * This is the single source of truth for both the final score and all
 * intermediate components. `getAlertPriority` delegates to this function.
 */
export function computeRankingBreakdown(
  alert: AlertEvent,
  ctx?: RankingContext,
): RankingBreakdown {
  const severity = deriveSeverity(alert);
  const severityScore = severity ? (SEVERITY_SCORE[severity] ?? 0) : 0;
  const confidenceScore = Math.round((alert.confidence ?? 0) * MAX_CONFIDENCE_SCORE * 100) / 100;
  const portfolioScore = alert.portfolioLinked ? PORTFOLIO_BONUS : 0;
  const urgencyScore = ((alert.urgency ?? 0) / 10) * MAX_URGENCY_SCORE;
  const baseScore = Math.round(severityScore + confidenceScore + portfolioScore + urgencyScore);

  let eventTypeBoost = 0;
  let issuerBoost = 0;
  let ruleNoisePenalty = 0;
  let analyticsAdjustment = 0;

  if (ctx && RANKING_MODE === "analytics-informed") {
    const adj = computeAnalyticsAdjustment(ctx);
    eventTypeBoost = adj.eventTypeBoost;
    issuerBoost = adj.issuerBoost;
    ruleNoisePenalty = adj.ruleNoisePenalty;
    analyticsAdjustment = adj.delta;
  }

  const finalScore = Math.max(0, Math.min(100, baseScore + analyticsAdjustment));
  const finalLabel = getPriorityLabel(finalScore);
  const analyticsAdjusted = analyticsAdjustment !== 0;

  return {
    severityScore,
    confidenceScore,
    portfolioScore,
    urgencyScore,
    baseScore,
    eventTypeBoost,
    issuerBoost,
    ruleNoisePenalty,
    analyticsAdjustment,
    finalScore,
    finalLabel,
    analyticsAdjusted,
    modelVersion: RANKING_MODEL_VERSION,
  };
}

// ─── computePriorityScore ─────────────────────────────────────────────────────

/**
 * Compute a 0-100 priority score for an alert.
 *
 * Base components:
 *   - Severity  : high=40, medium=25, low=10
 *   - Confidence: confidence * 30  (0–30); confidence is a 0–1 fraction
 *   - Portfolio : portfolioLinked  → +20
 *   - Urgency   : (urgency/10) * 10 (0–10); urgency is expected in range 0–10
 *
 * When `ctx` is supplied and RANKING_MODE is "analytics-informed", an
 * analytics adjustment (capped at ±MAX_TOTAL_ADJUSTMENT) is layered on top.
 * The final score is clamped to [0, 100].
 */
export function computePriorityScore(alert: AlertEvent, ctx?: RankingContext): number {
  const severity = deriveSeverity(alert);
  const severityScore = severity ? (SEVERITY_SCORE[severity] ?? 0) : 0;
  const confidenceScore = (alert.confidence ?? 0) * MAX_CONFIDENCE_SCORE;
  const portfolioScore = alert.portfolioLinked ? PORTFOLIO_BONUS : 0;
  const urgencyScore = ((alert.urgency ?? 0) / 10) * MAX_URGENCY_SCORE;

  const base = Math.round(severityScore + confidenceScore + portfolioScore + urgencyScore);

  if (!ctx || RANKING_MODE === "baseline") return base;

  const { delta } = computeAnalyticsAdjustment(ctx);
  return Math.max(0, Math.min(100, base + delta));
}

// ─── getPriorityLabel ─────────────────────────────────────────────────────────

export function getPriorityLabel(score: number): PriorityLabel {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

// ─── getPriorityExplanation ───────────────────────────────────────────────────

export function getPriorityExplanation(alert: AlertEvent, ctx?: RankingContext): string {
  const severity = deriveSeverity(alert);
  const parts: string[] = [];

  if (severity === "high") parts.push("high severity");
  else if (severity === "medium") parts.push("medium severity");
  else if (severity === "low") parts.push("low severity");

  if (alert.portfolioLinked) parts.push("portfolio exposure");

  const conf = alert.confidence ?? 0;
  if (conf >= 0.8) parts.push("high confidence");
  else if (conf >= 0.5) parts.push("moderate confidence");

  // Analytics adjustment reasons (analytics-informed mode only)
  if (ctx && RANKING_MODE === "analytics-informed") {
    const { reasons } = computeAnalyticsAdjustment(ctx);
    parts.push(...reasons);
  }

  if (parts.length === 0) return "Insufficient signal data to determine priority.";

  const score = computePriorityScore(alert, ctx);
  const label = getPriorityLabel(score);
  return `${label} priority because: ${parts.join(" + ")}.`;
}

// ─── getAlertPriority ─────────────────────────────────────────────────────────

export function getAlertPriority(alert: AlertEvent, ctx?: RankingContext): AlertPriority {
  const breakdown = computeRankingBreakdown(alert, ctx);
  return {
    score: breakdown.finalScore,
    label: breakdown.finalLabel,
    explanation: getPriorityExplanation(alert, ctx),
    analyticsAdjusted: breakdown.analyticsAdjusted,
    breakdown,
  };
}

// ─── sortAlertsByPriority ─────────────────────────────────────────────────────

/**
 * Sort alerts from highest to lowest priority score.
 *
 * @param getCtx  Optional function that returns a RankingContext for each alert.
 *                When omitted, sorts by base score only.
 */
export function sortAlertsByPriority(
  alerts: AlertEvent[],
  getCtx?: (alert: AlertEvent) => RankingContext | undefined,
): AlertEvent[] {
  return [...alerts].sort(
    (a, b) =>
      computePriorityScore(b, getCtx?.(b)) -
      computePriorityScore(a, getCtx?.(a)),
  );
}

// ─── priority badge styles ────────────────────────────────────────────────────

export const PRIORITY_BADGE_STYLES: Record<PriorityLabel, string> = {
  Critical: "bg-red-700 text-white border-red-700",
  High: "bg-orange-500 text-white border-orange-500",
  Medium: "bg-yellow-500 text-black border-yellow-500",
  Low: "bg-slate-500 text-white border-slate-500",
};

// ─── action helpers ───────────────────────────────────────────────────────────

export const ANALYST_ACTION_LABELS: Record<NonNullable<AnalystAction>, string> = {
  investigate: "Investigating",
  monitor: "Monitoring",
  ignore: "Ignored",
};

export const ANALYST_ACTION_STYLES: Record<NonNullable<AnalystAction>, string> = {
  investigate: "bg-blue-600 text-white border-blue-600",
  monitor: "bg-teal-600 text-white border-teal-600",
  ignore: "bg-secondary text-muted-foreground border-border",
};

// ─── buildRankingContext ──────────────────────────────────────────────────────

/**
 * Compact analytics index used by buildRankingContext.
 * Build it once from the analytics API response, then pass to each alert.
 */
export interface AnalyticsIndex {
  /** eventType → usefulnessScore (0–1) */
  eventTypeUsefulness: Map<string, number>;
  /** issuerName → investigateScore (0–1) */
  issuerInvestigate: Map<string, number>;
  /** ruleName → noiseScore (0–1) */
  ruleNoise: Map<string, number>;
}

/**
 * Build an AnalyticsIndex from the `rankingPrep` slice of the analytics
 * API response.  Call this once after fetching analytics, then use it with
 * `buildRankingContext` for each alert.
 */
export function buildAnalyticsIndex(rankingPrep: {
  eventTypeUsefulnessScores: { eventType: string; usefulnessScore: number }[];
  issuerInvestigateScores: { issuerName: string; investigateScore: number }[];
  ruleNoiseScores: { ruleName: string; noiseScore: number }[];
}): AnalyticsIndex {
  return {
    eventTypeUsefulness: new Map(
      rankingPrep.eventTypeUsefulnessScores.map((e) => [e.eventType, e.usefulnessScore]),
    ),
    issuerInvestigate: new Map(
      rankingPrep.issuerInvestigateScores.map((i) => [i.issuerName, i.investigateScore]),
    ),
    ruleNoise: new Map(
      rankingPrep.ruleNoiseScores.map((r) => [r.ruleName, r.noiseScore]),
    ),
  };
}

/**
 * Extract a per-alert RankingContext by looking up the alert's event type,
 * issuer name, and rule name in the analytics index.
 */
export function buildRankingContext(
  alert: AlertEvent & { ruleName?: string | null },
  index: AnalyticsIndex,
): RankingContext {
  return {
    eventTypeUsefulnessScore: alert.eventType
      ? index.eventTypeUsefulness.get(alert.eventType)
      : undefined,
    issuerInvestigateScore: index.issuerInvestigate.get(alert.issuerName),
    ruleNoiseScore:
      alert.ruleName ? index.ruleNoise.get(alert.ruleName) : undefined,
  };
}
