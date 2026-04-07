/**
 * lib/rankingEvaluation.ts
 *
 * Phase 10: Ranking Evaluation + Observability.
 * Phase 11: Ranking Calibration + Time-Windowed Evaluation.
 *
 * Utilities for comparing baseline vs analytics-informed ranking scores,
 * computing aggregate adjustment metrics, time-windowed evaluation, and
 * trend metrics for calibration.
 *
 * All functions are pure — they take alert data and optional ranking context
 * and return structured results without side effects.
 */

import type { AlertEvent } from "@workspace/api-client-react";
import {
  computeRankingBreakdown,
  type RankingBreakdown,
  type RankingContext,
} from "./alertPriority";

// ─── time windows ─────────────────────────────────────────────────────────────

/**
 * Supported evaluation time windows.
 *
 * - `"7d"`  – last 7 days (rolling from now)
 * - `"30d"` – last 30 days (rolling from now)
 * - `"all"` – all available history (default)
 */
export type TimeWindow = "7d" | "30d" | "all";

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "all": "All time",
};

/**
 * Filter an alert list to only those whose `triggeredAt` timestamp falls
 * within the specified time window (relative to `now`, or `Date.now()` if
 * omitted).
 *
 * Alerts with a missing or unparseable `triggeredAt` are included only for
 * the `"all"` window.
 */
export function filterAlertsByTimeWindow(
  alerts: AlertEvent[],
  window: TimeWindow,
  now: Date = new Date(),
): AlertEvent[] {
  if (window === "all") return alerts;

  const cutoffMs =
    window === "7d"
      ? now.getTime() - 7 * 24 * 60 * 60 * 1000
      : now.getTime() - 30 * 24 * 60 * 60 * 1000;

  return alerts.filter((a) => {
    if (!a.triggeredAt) return false;
    const ts = new Date(a.triggeredAt).getTime();
    return !isNaN(ts) && ts >= cutoffMs;
  });
}

// ─── per-alert comparison ─────────────────────────────────────────────────────

/**
 * Side-by-side comparison of baseline vs analytics-informed scores for one alert.
 */
export interface AlertRankingComparison {
  alertId: number;
  issuerName: string;
  title: string;
  /** Pure base score (no analytics adjustment) */
  baselineScore: number;
  /** Final score after analytics adjustment */
  analyticsScore: number;
  /** analyticsScore - baselineScore (positive = moved up, negative = moved down) */
  scoreDelta: number;
  /** Full structured breakdown (analytics-informed) */
  breakdown: RankingBreakdown;
}

/**
 * Compute a baseline-vs-analytics comparison for a single alert.
 *
 * @param alert   The alert to evaluate.
 * @param ctx     The ranking context for the alert.  When omitted the
 *                analytics score equals the baseline score (delta = 0).
 */
export function compareAlertRanking(
  alert: AlertEvent,
  ctx?: RankingContext,
): AlertRankingComparison {
  const baselineBreakdown = computeRankingBreakdown(alert);
  const analyticsBreakdown = computeRankingBreakdown(alert, ctx);

  return {
    alertId: alert.id,
    issuerName: alert.issuerName,
    title: alert.title,
    baselineScore: baselineBreakdown.finalScore,
    analyticsScore: analyticsBreakdown.finalScore,
    scoreDelta: analyticsBreakdown.finalScore - baselineBreakdown.finalScore,
    breakdown: analyticsBreakdown,
  };
}

/**
 * Compute comparisons for a list of alerts.
 * Results are sorted by absolute score delta descending (largest movers first).
 *
 * @param alerts   Alert list.
 * @param getCtx   Optional function returning a RankingContext per alert.
 */
export function compareAlertRankings(
  alerts: AlertEvent[],
  getCtx?: (alert: AlertEvent) => RankingContext | undefined,
): AlertRankingComparison[] {
  return alerts
    .map((a) => compareAlertRanking(a, getCtx?.(a)))
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta));
}

// ─── aggregate metrics ────────────────────────────────────────────────────────

/**
 * Summary metrics over a list of alert comparisons.
 * Use these to gauge whether analytics-informed ranking is adding value.
 */
export interface RankingAggregateMetrics {
  /** Total alerts evaluated */
  totalAlerts: number;
  /** Alerts with a nonzero analytics adjustment */
  adjustedCount: number;
  /** Fraction of alerts that received any adjustment (0–1) */
  adjustedFraction: number;
  /** Alerts whose score moved up (delta > 0) */
  boostedCount: number;
  /** Alerts whose score moved down (delta < 0) */
  penalisedCount: number;
  /** Mean positive delta across boosted alerts (0 when none) */
  averagePositiveAdjustment: number;
  /** Mean negative delta across penalised alerts (stored as negative, 0 when none) */
  averageNegativeAdjustment: number;
  /** Top event types receiving the most cumulative boost, sorted descending */
  topBoostedEventTypes: { eventType: string; totalBoost: number }[];
  /** Top rules receiving the most cumulative penalty, sorted descending */
  topPenalisedRules: { ruleName: string; totalPenalty: number }[];
}

/**
 * Compute aggregate ranking metrics from a list of comparisons and the
 * corresponding alert list (needed for event-type / rule attribution).
 *
 * @param comparisons  Output of `compareAlertRankings`.
 * @param alerts       The matching alert list (same order, same length).
 */
export function computeRankingMetrics(
  comparisons: AlertRankingComparison[],
  alerts: AlertEvent[],
): RankingAggregateMetrics {
  const total = comparisons.length;
  const adjusted = comparisons.filter((c) => c.scoreDelta !== 0);
  const boosted = comparisons.filter((c) => c.scoreDelta > 0);
  const penalised = comparisons.filter((c) => c.scoreDelta < 0);

  const averagePositiveAdjustment =
    boosted.length > 0
      ? boosted.reduce((s, c) => s + c.scoreDelta, 0) / boosted.length
      : 0;

  const averageNegativeAdjustment =
    penalised.length > 0
      ? penalised.reduce((s, c) => s + c.scoreDelta, 0) / penalised.length
      : 0;

  // Build a map from alertId → alert for O(1) lookup (avoids index alignment issues
  // since compareAlertRankings sorts comparisons by |delta|, not by input order).
  const alertById = new Map<number, AlertEvent & { ruleName?: string | null }>();
  for (const alert of alerts) {
    alertById.set(alert.id, alert as AlertEvent & { ruleName?: string | null });
  }

  // Accumulate event-type boosts and rule penalties from breakdowns
  const eventTypeBoostMap = new Map<string, number>();
  const rulePenaltyMap = new Map<string, number>();

  for (const comparison of comparisons) {
    const alert = alertById.get(comparison.alertId);
    if (!alert) continue;
    const breakdown = comparison.breakdown;

    if (breakdown.eventTypeBoost > 0 && alert.eventType) {
      const prev = eventTypeBoostMap.get(alert.eventType) ?? 0;
      eventTypeBoostMap.set(alert.eventType, prev + breakdown.eventTypeBoost);
    }

    if (breakdown.ruleNoisePenalty > 0) {
      const ruleName = alert.ruleName;
      if (ruleName) {
        const prev = rulePenaltyMap.get(ruleName) ?? 0;
        rulePenaltyMap.set(ruleName, prev + breakdown.ruleNoisePenalty);
      }
    }
  }

  const topBoostedEventTypes = [...eventTypeBoostMap.entries()]
    .map(([eventType, totalBoost]) => ({ eventType, totalBoost }))
    .sort((a, b) => b.totalBoost - a.totalBoost);

  const topPenalisedRules = [...rulePenaltyMap.entries()]
    .map(([ruleName, totalPenalty]) => ({ ruleName, totalPenalty }))
    .sort((a, b) => b.totalPenalty - a.totalPenalty);

  return {
    totalAlerts: total,
    adjustedCount: adjusted.length,
    adjustedFraction: total > 0 ? adjusted.length / total : 0,
    boostedCount: boosted.length,
    penalisedCount: penalised.length,
    averagePositiveAdjustment,
    averageNegativeAdjustment,
    topBoostedEventTypes,
    topPenalisedRules,
  };
}

// ─── evaluation hooks ─────────────────────────────────────────────────────────

/**
 * Did analytics-informed ranking move useful alerts higher?
 *
 * Returns the proportion of alerts where:
 *   - the analytics score is higher than the baseline score, AND
 *   - the alert was later marked as useful feedback or investigated.
 *
 * A higher value means the model is surfacing genuinely useful alerts.
 *
 * @param comparisons        Ranking comparisons.
 * @param isUsefulOrInvestigated  Predicate: returns true if an alert was
 *                                rated useful or had an investigate action.
 */
export function fractionBoostedAndUseful(
  comparisons: AlertRankingComparison[],
  isUsefulOrInvestigated: (alertId: number) => boolean,
): number {
  const boosted = comparisons.filter((c) => c.scoreDelta > 0);
  if (boosted.length === 0) return 0;
  const useful = boosted.filter((c) => isUsefulOrInvestigated(c.alertId));
  return useful.length / boosted.length;
}

/**
 * Are penalised noisy rules actually being deprioritised?
 *
 * Returns the proportion of alerts where:
 *   - the analytics score is lower than the baseline score, AND
 *   - the alert was later marked as noise feedback or ignored.
 *
 * A higher value means the model is correctly suppressing noisy signals.
 */
export function fractionPenalisedAndNoisy(
  comparisons: AlertRankingComparison[],
  isNoisyOrIgnored: (alertId: number) => boolean,
): number {
  const penalised = comparisons.filter((c) => c.scoreDelta < 0);
  if (penalised.length === 0) return 0;
  const noisy = penalised.filter((c) => isNoisyOrIgnored(c.alertId));
  return noisy.length / penalised.length;
}

/**
 * Are portfolio-linked investigated alerts benefiting from the model?
 *
 * Returns the proportion of portfolio-linked alerts where the analytics score
 * is higher than the baseline score.
 */
export function fractionPortfolioLinkedBoosted(
  comparisons: AlertRankingComparison[],
  alerts: AlertEvent[],
): number {
  // Build a set of portfolio-linked alert IDs for O(1) lookup
  const portfolioLinkedIds = new Set<number>(
    alerts.filter((a) => a.portfolioLinked).map((a) => a.id),
  );
  const portfolioLinked = comparisons.filter((c) => portfolioLinkedIds.has(c.alertId));
  if (portfolioLinked.length === 0) return 0;
  const boosted = portfolioLinked.filter((c) => c.scoreDelta > 0);
  return boosted.length / portfolioLinked.length;
}

// ─── windowed evaluation ──────────────────────────────────────────────────────

/**
 * Compute ranking metrics for a specific time window.
 *
 * Convenience wrapper that filters `alerts` to the given `window` before
 * running comparisons and computing aggregate metrics.
 *
 * @param alerts   Full alert list.
 * @param getCtx   Optional function returning a RankingContext per alert.
 * @param window   Time window to restrict evaluation to.
 * @param now      Reference time for window boundaries (defaults to now).
 */
export function computeWindowedMetrics(
  alerts: AlertEvent[],
  getCtx: ((alert: AlertEvent) => RankingContext | undefined) | undefined,
  window: TimeWindow,
  now: Date = new Date(),
): RankingAggregateMetrics {
  const filtered = filterAlertsByTimeWindow(alerts, window, now);
  const comparisons = compareAlertRankings(filtered, getCtx);
  return computeRankingMetrics(comparisons, filtered);
}

// ─── trend metrics ────────────────────────────────────────────────────────────

/**
 * Simple trend metrics computed over a time window for calibration comparisons.
 */
export interface TrendMetrics {
  /** Time window these metrics cover */
  window: TimeWindow;
  /** Number of alerts in the window */
  alertCount: number;
  /** Fraction of boosted alerts that were marked useful or investigated (0–1) */
  usefulFeedbackRateAmongBoosted: number;
  /** Fraction of penalised alerts that were marked noisy or ignored (0–1) */
  noiseRateAmongPenalised: number;
  /** Fraction of portfolio-linked alerts whose analytics score > baseline score (0–1) */
  investigateRateAmongPortfolioLinkedBoosted: number;
}

/**
 * Compute trend metrics for a given time window.
 *
 * @param alerts                Full alert list.
 * @param getCtx                Optional ranking context getter.
 * @param window                Time window to evaluate over.
 * @param isUsefulOrInvestigated  Predicate: true if alert was rated useful or investigated.
 * @param isNoisyOrIgnored        Predicate: true if alert was rated noisy or ignored.
 * @param now                   Reference time for window boundaries.
 */
export function computeTrendMetrics(
  alerts: AlertEvent[],
  getCtx: ((alert: AlertEvent) => RankingContext | undefined) | undefined,
  window: TimeWindow,
  isUsefulOrInvestigated: (alertId: number) => boolean,
  isNoisyOrIgnored: (alertId: number) => boolean,
  now: Date = new Date(),
): TrendMetrics {
  const filtered = filterAlertsByTimeWindow(alerts, window, now);
  const comparisons = compareAlertRankings(filtered, getCtx);

  return {
    window,
    alertCount: filtered.length,
    usefulFeedbackRateAmongBoosted: fractionBoostedAndUseful(comparisons, isUsefulOrInvestigated),
    noiseRateAmongPenalised: fractionPenalisedAndNoisy(comparisons, isNoisyOrIgnored),
    investigateRateAmongPortfolioLinkedBoosted: fractionPortfolioLinkedBoosted(comparisons, filtered),
  };
}

/**
 * Compute trend metrics for multiple time windows in one call.
 * Useful for side-by-side comparisons (e.g. last 7 days vs last 30 days).
 *
 * @param windows  Time windows to compute metrics for.
 */
export function computeMultiWindowTrends(
  alerts: AlertEvent[],
  getCtx: ((alert: AlertEvent) => RankingContext | undefined) | undefined,
  windows: TimeWindow[],
  isUsefulOrInvestigated: (alertId: number) => boolean,
  isNoisyOrIgnored: (alertId: number) => boolean,
  now: Date = new Date(),
): TrendMetrics[] {
  return windows.map((w) =>
    computeTrendMetrics(alerts, getCtx, w, isUsefulOrInvestigated, isNoisyOrIgnored, now),
  );
}
