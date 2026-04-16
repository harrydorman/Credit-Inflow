/**
 * lib/outcomeAttribution.ts
 *
 * Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Pure, testable utility for computing outcome attribution from alert
 * comparisons and enriched alert data.
 *
 * "Attribution" answers questions like:
 * - Among alerts moved up (boosted), how many were later investigated?
 * - Among alerts moved down (penalised), how many were later marked noise?
 * - Which event types most often produce boosted-useful alerts?
 * - Which rules most often produce penalised-noisy alerts?
 *
 * All functions are pure: they take data and return results without side effects.
 */

import type { AlertEvent } from "@workspace/api-client-react";
import type { AlertRankingComparison } from "./rankingEvaluation";

// ─── types ────────────────────────────────────────────────────────────────────

/** Attribution row for a single event type or rule. */
export interface AttributionRow {
  label: string;
  /** Alerts that were boosted (event type rows) or penalised (rule rows) */
  count: number;
  /** Alerts with a favourable outcome (investigated for boosted; noise for penalised) */
  favourableCount: number;
  /** favourableCount / count (0 when count === 0) */
  favourableRate: number;
}

/** Full outcome attribution summary derived from alert comparisons. */
export interface OutcomeAttributionSummary {
  /** Total alerts in scope */
  totalAlerts: number;

  /** Alerts with scoreDelta > 0 (moved up) */
  boostedCount: number;
  /** Among boosted, how many had workflowAction === "investigate" */
  boostedInvestigatedCount: number;
  /** boostedInvestigatedCount / boosted-with-workflow (0 when none have workflow) */
  boostedInvestigateRate: number;

  /** Alerts with scoreDelta < 0 (moved down) */
  penalisedCount: number;
  /** Among penalised, how many had feedbackRating === "noise" */
  penalisedNoiseCount: number;
  /** penalisedNoiseCount / penalised-with-feedback (0 when none have feedback) */
  penalisedNoiseRate: number;

  /** Top event types where boosted alerts were investigated, sorted by rate desc */
  topBoostedInvestigatedEventTypes: AttributionRow[];
  /** Top rules where penalised alerts were marked noise, sorted by rate desc */
  topPenalisedNoisyRules: AttributionRow[];
}

// ─── main function ────────────────────────────────────────────────────────────

/**
 * Compute outcome attribution from a list of alert ranking comparisons and
 * their corresponding alert data.
 *
 * The `alerts` array must contain alerts with `workflowAction` and
 * `feedbackRating` populated (as returned by GET /api/alerts with those
 * fields joined in).  Alerts without these fields simply don't contribute
 * to outcome counts.
 *
 * @param comparisons  Output of `compareAlertRankings` — scoreDelta shows direction.
 * @param alerts       Full alert records with optional workflowAction + feedbackRating.
 */
export function computeOutcomeAttribution(
  comparisons: AlertRankingComparison[],
  alerts: (AlertEvent & { ruleName?: string | null })[],
): OutcomeAttributionSummary {
  // Build alertId → alert lookup for O(1) access
  const alertById = new Map<number, AlertEvent & { ruleName?: string | null }>();
  for (const a of alerts) alertById.set(a.id, a);

  const boosted = comparisons.filter((c) => c.scoreDelta > 0);
  const penalised = comparisons.filter((c) => c.scoreDelta < 0);

  // ── Boosted alert outcomes ─────────────────────────────────────────────
  let boostedInvestigatedCount = 0;
  let boostedWithWorkflow = 0;

  // eventType → { count, investigated }
  const etStats = new Map<string, { count: number; investigated: number }>();

  for (const c of boosted) {
    const alert = alertById.get(c.alertId);
    if (!alert) continue;

    const et = alert.eventType ?? "(unknown)";
    if (!etStats.has(et)) etStats.set(et, { count: 0, investigated: 0 });
    const e = etStats.get(et)!;
    e.count++;

    if (alert.workflowAction) {
      boostedWithWorkflow++;
      if (alert.workflowAction === "investigate") {
        boostedInvestigatedCount++;
        e.investigated++;
      }
    }
  }

  const boostedInvestigateRate =
    boostedWithWorkflow > 0 ? round4(boostedInvestigatedCount / boostedWithWorkflow) : 0;

  // ── Penalised alert outcomes ───────────────────────────────────────────
  let penalisedNoiseCount = 0;
  let penalisedWithFeedback = 0;

  // ruleName → { count, noisy }
  const ruleStats = new Map<string, { count: number; noisy: number }>();

  for (const c of penalised) {
    const alert = alertById.get(c.alertId);
    if (!alert) continue;

    const rule = alert.ruleName ?? "(unknown rule)";
    if (!ruleStats.has(rule)) ruleStats.set(rule, { count: 0, noisy: 0 });
    const e = ruleStats.get(rule)!;
    e.count++;

    if (alert.feedbackRating) {
      penalisedWithFeedback++;
      if (alert.feedbackRating === "noise") {
        penalisedNoiseCount++;
        e.noisy++;
      }
    }
  }

  const penalisedNoiseRate =
    penalisedWithFeedback > 0 ? round4(penalisedNoiseCount / penalisedWithFeedback) : 0;

  // ── Top lists ─────────────────────────────────────────────────────────
  const topBoostedInvestigatedEventTypes: AttributionRow[] = [...etStats.entries()]
    .map(([label, { count, investigated }]) => ({
      label,
      count,
      favourableCount: investigated,
      favourableRate: count > 0 ? round4(investigated / count) : 0,
    }))
    .sort((a, b) => b.favourableRate - a.favourableRate)
    .slice(0, 5);

  const topPenalisedNoisyRules: AttributionRow[] = [...ruleStats.entries()]
    .map(([label, { count, noisy }]) => ({
      label,
      count,
      favourableCount: noisy,
      favourableRate: count > 0 ? round4(noisy / count) : 0,
    }))
    .sort((a, b) => b.favourableRate - a.favourableRate)
    .slice(0, 5);

  return {
    totalAlerts: comparisons.length,
    boostedCount: boosted.length,
    boostedInvestigatedCount,
    boostedInvestigateRate,
    penalisedCount: penalised.length,
    penalisedNoiseCount,
    penalisedNoiseRate,
    topBoostedInvestigatedEventTypes,
    topPenalisedNoisyRules,
  };
}

// ─── helper ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
