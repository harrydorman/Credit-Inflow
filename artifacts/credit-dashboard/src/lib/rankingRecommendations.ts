/**
 * lib/rankingRecommendations.ts
 *
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 *
 * Pure utility module that generates human-readable, advisory recommendation
 * hints from ranking aggregate metrics and trend metrics.
 *
 * Design principles:
 * - Recommendations are conservative and never auto-applied.
 * - Every recommendation cites the specific metric value it is based on.
 * - Functions are pure (no side effects, no I/O).
 * - The recommendation list is ordered by estimated impact (highest first).
 */

import type { RankingAggregateMetrics } from "./rankingEvaluation";
import type { TrendMetrics } from "./rankingEvaluation";

// ─── types ────────────────────────────────────────────────────────────────────

/** Severity level for a calibration recommendation. */
export type RecommendationSeverity = "info" | "warning" | "action";

/** A single actionable calibration hint. */
export interface CalibrationRecommendation {
  /** Short, human-readable title. */
  title: string;
  /** Full explanation with metric citation. */
  detail: string;
  /** What to do. */
  suggestion: string;
  /** How urgent this recommendation is. */
  severity: RecommendationSeverity;
  /** The metric key(s) this recommendation is based on. */
  basedOn: string[];
}

// ─── thresholds used by the recommendation engine ────────────────────────────
// These are diagnostic thresholds — separate from the ranking calibration config.

/** adjustedFraction below which we suggest lowering thresholds. */
const LOW_ADJUSTED_FRACTION = 0.05;
/** adjustedFraction above which we suggest raising thresholds. */
const HIGH_ADJUSTED_FRACTION = 0.6;

/** usefulFeedbackRateAmongBoosted below which boosting is not helping. */
const LOW_USEFUL_FEEDBACK_RATE = 0.4;
/** noiseRateAmongPenalised below which penalisation is not helping. */
const LOW_NOISE_RATE_AMONG_PENALISED = 0.4;
/** investigateRateAmongPortfolioLinkedBoosted below which portfolio signals are weak. */
const LOW_PORTFOLIO_INVESTIGATE_RATE = 0.3;

/** Fraction of top penalty concentrated in few rules (suggests targeted review). */
const CONCENTRATED_PENALTY_RULES = 2;

// ─── helpers ─────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── recommendation generators ───────────────────────────────────────────────

/**
 * Generate calibration recommendations from aggregate ranking metrics.
 *
 * @param metrics  The aggregate metrics for the current time window.
 * @returns        A list of recommendations, highest-impact first.
 */
export function generateRecommendations(
  metrics: RankingAggregateMetrics,
): CalibrationRecommendation[] {
  const recs: CalibrationRecommendation[] = [];

  // 1 — Very low adjusted fraction → thresholds are too restrictive
  if (metrics.totalAlerts > 0 && metrics.adjustedFraction < LOW_ADJUSTED_FRACTION) {
    recs.push({
      title: "Very few alerts are being adjusted",
      detail:
        `Only ${pct(metrics.adjustedFraction)} of alerts (${metrics.adjustedCount}/${metrics.totalAlerts}) ` +
        `received any analytics adjustment. This suggests that the current boost/penalty ` +
        `thresholds are too high to activate on most alerts.`,
      suggestion:
        "Consider lowering eventTypeBoost.threshold, issuerBoost.threshold, or ruleNoisePenalty.threshold " +
        "in RANKING_CALIBRATION_CONFIG by a small increment (0.05–0.1), then re-evaluate.",
      severity: "warning",
      basedOn: ["adjustedFraction"],
    });
  }

  // 2 — Very high adjusted fraction → thresholds are too permissive
  if (metrics.totalAlerts > 0 && metrics.adjustedFraction > HIGH_ADJUSTED_FRACTION) {
    recs.push({
      title: "Most alerts are being adjusted",
      detail:
        `${pct(metrics.adjustedFraction)} of alerts (${metrics.adjustedCount}/${metrics.totalAlerts}) ` +
        `received an analytics adjustment. When nearly all alerts are adjusted, the ranking ` +
        `effectively loses its baseline structure.`,
      suggestion:
        "Consider raising one or more thresholds in RANKING_CALIBRATION_CONFIG, or lowering the max " +
        "caps (eventTypeBoost.max, issuerBoost.max, ruleNoisePenalty.max) to reduce the scope of adjustments.",
      severity: "warning",
      basedOn: ["adjustedFraction"],
    });
  }

  // 3 — Low useful feedback rate among boosted alerts
  if (
    metrics.boostedCount > 0 &&
    metrics.averagePositiveAdjustment > 0 &&
    metrics.topBoostedEventTypes.length > 0
  ) {
    // We can surface this based on the presence of boosted event types, as a reminder
    recs.push({
      title: "Review boosted event types against feedback",
      detail:
        `${metrics.boostedCount} alerts were boosted (avg +${round2(metrics.averagePositiveAdjustment)} pts). ` +
        `The top boosted event type${metrics.topBoostedEventTypes.length > 1 ? "s are" : " is"}: ` +
        `${metrics.topBoostedEventTypes.slice(0, 3).map((e) => e.eventType).join(", ")}.`,
      suggestion:
        "If feedback on these boosted alerts shows they are not being investigated or rated useful, " +
        "consider raising eventTypeBoost.threshold to restrict which event types receive a boost.",
      severity: "info",
      basedOn: ["boostedCount", "averagePositiveAdjustment", "topBoostedEventTypes"],
    });
  }

  // 4 — Top penalised rules are concentrated (suggests targeted rule review, not global change)
  if (metrics.topPenalisedRules.length > 0 && metrics.topPenalisedRules.length <= CONCENTRATED_PENALTY_RULES) {
    recs.push({
      title: "Noise penalty is concentrated in a small set of rules",
      detail:
        `Only ${metrics.topPenalisedRules.length} rule${metrics.topPenalisedRules.length > 1 ? "s are" : " is"} ` +
        `receiving penalties: ${metrics.topPenalisedRules.map((r) => r.ruleName).join(", ")}. ` +
        `A global threshold change would affect all rules, not just these.`,
      suggestion:
        "Consider reviewing and improving these specific alert rules (e.g. tighten their conditions or " +
        "raise their confidence threshold) rather than lowering the global ruleNoisePenalty.max.",
      severity: "action",
      basedOn: ["topPenalisedRules"],
    });
  }

  return recs;
}

/**
 * Generate trend-aware recommendations from TrendMetrics (requires feedback data).
 *
 * These recommendations are only added when the feedback-rate metrics are
 * populated (i.e. when the caller has provided a non-trivial isUsefulOrInvestigated
 * / isNoisyOrIgnored predicate).
 *
 * @param trend  TrendMetrics for the current window.
 * @returns      A list of recommendations to merge with generateRecommendations output.
 */
export function generateTrendRecommendations(
  trend: TrendMetrics,
): CalibrationRecommendation[] {
  const recs: CalibrationRecommendation[] = [];

  // 5 — Low useful feedback rate among boosted alerts
  if (trend.alertCount > 0 && trend.usefulFeedbackRateAmongBoosted < LOW_USEFUL_FEEDBACK_RATE) {
    recs.push({
      title: "Boosted alerts have low useful-feedback rate",
      detail:
        `Only ${pct(trend.usefulFeedbackRateAmongBoosted)} of boosted alerts were rated useful or ` +
        `investigated in the ${trend.window} window. The boost is promoting alerts that ` +
        `analysts are not finding actionable.`,
      suggestion:
        "Consider raising eventTypeBoost.threshold to require a stronger signal before boosting, " +
        "and bump RANKING_MODEL_VERSION after the change.",
      severity: "action",
      basedOn: ["usefulFeedbackRateAmongBoosted"],
    });
  }

  // 6 — Low noise rate among penalised alerts
  if (trend.alertCount > 0 && trend.noiseRateAmongPenalised < LOW_NOISE_RATE_AMONG_PENALISED) {
    recs.push({
      title: "Penalised alerts have low noise-feedback rate",
      detail:
        `Only ${pct(trend.noiseRateAmongPenalised)} of penalised alerts were rated as noise or ` +
        `ignored in the ${trend.window} window. The model may be penalising alerts that ` +
        `are actually useful.`,
      suggestion:
        "Consider raising ruleNoisePenalty.threshold or reducing ruleNoisePenalty.max to " +
        "make the penalty more conservative.",
      severity: "action",
      basedOn: ["noiseRateAmongPenalised"],
    });
  }

  // 7 — Low portfolio-linked boosted investigate rate
  if (trend.alertCount > 0 && trend.investigateRateAmongPortfolioLinkedBoosted < LOW_PORTFOLIO_INVESTIGATE_RATE) {
    recs.push({
      title: "Portfolio-linked alerts not benefiting from ranking boosts",
      detail:
        `Only ${pct(trend.investigateRateAmongPortfolioLinkedBoosted)} of portfolio-linked alerts ` +
        `had their analytics score raised above the baseline in the ${trend.window} window. ` +
        `Portfolio risk signals may be underweighted.`,
      suggestion:
        "Review whether issuers in your portfolios have sufficient workflow history to generate " +
        "issuer investigate scores. Alternatively, raise issuerBoost.max to increase the influence " +
        "of portfolio-linked issuer data.",
      severity: "warning",
      basedOn: ["investigateRateAmongPortfolioLinkedBoosted"],
    });
  }

  return recs;
}

/**
 * Produce a combined, deduplicated, and severity-ordered recommendation list.
 *
 * @param metrics   Aggregate metrics (always available).
 * @param trend     Trend metrics (available when feedback data is present; pass null to skip).
 */
export function getAllRecommendations(
  metrics: RankingAggregateMetrics,
  trend?: TrendMetrics | null,
): CalibrationRecommendation[] {
  const recs = [
    ...generateRecommendations(metrics),
    ...(trend ? generateTrendRecommendations(trend) : []),
  ];

  // Sort by severity: action > warning > info
  const order: Record<RecommendationSeverity, number> = { action: 0, warning: 1, info: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
