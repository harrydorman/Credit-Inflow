import type { AlertEvent } from "@workspace/api-client-react";

// ─── types ────────────────────────────────────────────────────────────────────

export type PriorityLabel = "Critical" | "High" | "Medium" | "Low";

export type AnalystAction = "investigate" | "monitor" | "ignore" | null;

export interface AlertPriority {
  score: number;
  label: PriorityLabel;
  explanation: string;
  /** True when the score includes analytics-informed adjustments */
  analyticsAdjusted?: boolean;
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

/** Minimum usefulness score before an event-type boost applies. */
const EVENT_TYPE_BOOST_THRESHOLD = 0.7;
/** Max points added for a highly useful event type. */
const EVENT_TYPE_BOOST_MAX = 8;

/** Minimum investigate-rate before an issuer boost applies. */
const ISSUER_INVESTIGATE_THRESHOLD = 0.6;
/** Max points added for a high-investigate-rate issuer. */
const ISSUER_INVESTIGATE_BOOST_MAX = 8;

/** Minimum noise rate before a rule penalty applies. */
const RULE_NOISE_THRESHOLD = 0.5;
/** Max points deducted for a high-noise rule. */
const RULE_NOISE_PENALTY_MAX = 8;

/** Hard cap on the absolute value of the total analytics adjustment. */
export const MAX_TOTAL_ADJUSTMENT = 15;

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
 * Returns both the numeric delta (positive = boost, negative = penalty) and
 * human-readable reasons for any non-zero contribution.
 *
 * Individual contributions are linearly scaled from their threshold to their
 * maximum, then the total is hard-capped at ±MAX_TOTAL_ADJUSTMENT.
 */
export function computeAnalyticsAdjustment(
  ctx: RankingContext,
): { delta: number; reasons: string[] } {
  const reasons: string[] = [];
  let boost = 0;
  let penalty = 0;

  // Event-type usefulness boost
  const etScore = ctx.eventTypeUsefulnessScore ?? 0;
  if (etScore >= EVENT_TYPE_BOOST_THRESHOLD) {
    const raw = Math.round(
      ((etScore - EVENT_TYPE_BOOST_THRESHOLD) /
        (1 - EVENT_TYPE_BOOST_THRESHOLD)) *
        EVENT_TYPE_BOOST_MAX,
    );
    if (raw > 0) {
      boost += raw;
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
      boost += raw;
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
      penalty += raw;
      reasons.push("reduced because this rule has a high noise ratio");
    }
  }

  const uncapped = boost - penalty;
  const delta = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, uncapped));
  return { delta, reasons };
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

  if (parts.length === 0 && (!ctx || RANKING_MODE === "baseline")) {
    return "Insufficient signal data to determine priority.";
  }

  const score = computePriorityScore(alert, ctx);
  const label = getPriorityLabel(score);

  // Analytics adjustment reasons
  if (ctx && RANKING_MODE === "analytics-informed") {
    const { reasons } = computeAnalyticsAdjustment(ctx);
    parts.push(...reasons);
  }

  if (parts.length === 0) return "Insufficient signal data to determine priority.";

  return `${label} priority because: ${parts.join(" + ")}.`;
}

// ─── getAlertPriority ─────────────────────────────────────────────────────────

export function getAlertPriority(alert: AlertEvent, ctx?: RankingContext): AlertPriority {
  const score = computePriorityScore(alert, ctx);
  const analyticsAdjusted =
    Boolean(ctx) &&
    RANKING_MODE === "analytics-informed" &&
    computeAnalyticsAdjustment(ctx!).delta !== 0;
  return {
    score,
    label: getPriorityLabel(score),
    explanation: getPriorityExplanation(alert, ctx),
    analyticsAdjusted,
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
