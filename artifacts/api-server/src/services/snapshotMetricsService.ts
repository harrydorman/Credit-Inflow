/**
 * services/snapshotMetricsService.ts
 *
 * Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Computes RankingSnapshotMetrics directly from persisted DB data (alert events,
 * workflow state, feedback) for a given org, model version, and time window.
 *
 * This avoids relying on frontend approximations — metrics here reflect
 * real analyst outcomes, not score-deltas estimated in the browser.
 *
 * All functions are async and accept an orgId as first argument.
 */

import {
  db,
  alertRulesTable,
  alertEventsTable,
  alertFeedbackTable,
  alertWorkflowStateTable,
  portfolioIssuerMapTable,
  portfolioHoldingsTable,
  portfoliosTable,
} from "@workspace/db";
import type { SnapshotTimeWindow, RankingSnapshotMetrics } from "@workspace/db";
import { and, eq, gte, count, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Calibration config type
// ---------------------------------------------------------------------------

/**
 * The calibration thresholds used by the ranking model.
 *
 * These mirror RANKING_CALIBRATION_CONFIG in the dashboard alertPriority.ts.
 * Defaults match the current v1.1.0 settings.
 */
export interface CalibrationConfig {
  eventTypeBoost: { threshold: number; max: number };
  issuerBoost: { threshold: number; max: number };
  ruleNoisePenalty: { threshold: number; max: number };
  totalAdjustmentCap: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  eventTypeBoost: { threshold: 0.7, max: 8 },
  issuerBoost: { threshold: 0.6, max: 8 },
  ruleNoisePenalty: { threshold: 0.5, max: 8 },
  totalAdjustmentCap: 15,
};

// ---------------------------------------------------------------------------
// Time window helpers
// ---------------------------------------------------------------------------

function windowCutoffDate(window: SnapshotTimeWindow): Date | null {
  if (window === "all") return null;
  const msAgo = window === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute RankingSnapshotMetrics for the given org and time window directly
 * from persisted data.
 *
 * Strategy:
 * - totalAlerts: count of alert events in the window.
 * - "Boosted" alert: its event type has usefulnessScore >= eventTypeBoost.threshold.
 * - "Penalised" alert: its rule has noiseScore >= ruleNoisePenalty.threshold.
 * - adjustedFraction: fraction of alerts that are boosted OR penalised.
 * - averagePositiveAdjustment: for boosted alerts, linearly scale boost by
 *   (usefulnessScore / 1.0) * max, average across boosted group.
 * - averageNegativeAdjustment: similarly for penalised alerts (stored negative).
 * - usefulFeedbackRateAmongBoosted: among boosted alerts with feedback, fraction "useful".
 * - noiseRateAmongPenalised: among penalised alerts with feedback, fraction "noise".
 * - investigateRateAmongPortfolioLinkedBoosted: among portfolio-linked boosted alerts
 *   with workflow state, fraction "investigate".
 * - topBoostedEventTypes / topPenalisedRules: top-5 by cumulative score.
 */
export async function computeSnapshotMetrics(
  orgId: string,
  window: SnapshotTimeWindow,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): Promise<RankingSnapshotMetrics & { metricSource: "server-computed" }> {
  const cutoff = windowCutoffDate(window);

  // ── 1. Fetch usefulness scores per event type ───────────────────────────
  const feedbackByET = await db
    .select({
      eventType: alertEventsTable.eventType,
      rating: alertFeedbackTable.rating,
      cnt: count(),
    })
    .from(alertFeedbackTable)
    .innerJoin(alertEventsTable, eq(alertFeedbackTable.alertEventId, alertEventsTable.id))
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(
      and(
        eq(alertFeedbackTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertEventsTable.eventType, alertFeedbackTable.rating);

  const etFeedbackMap = new Map<string, { useful: number; noise: number; total: number }>();
  for (const row of feedbackByET) {
    const et = row.eventType ?? "(unknown)";
    if (!etFeedbackMap.has(et)) etFeedbackMap.set(et, { useful: 0, noise: 0, total: 0 });
    const e = etFeedbackMap.get(et)!;
    const n = Number(row.cnt);
    if (row.rating === "useful") e.useful += n;
    if (row.rating === "noise") e.noise += n;
    e.total += n;
  }
  const etUsefulnessScore = new Map<string, number>();
  for (const [et, counts] of etFeedbackMap) {
    etUsefulnessScore.set(et, counts.total > 0 ? counts.useful / counts.total : 0);
  }

  // ── 2. Fetch noise scores per rule ──────────────────────────────────────
  const feedbackByRule = await db
    .select({
      ruleName: alertRulesTable.name,
      rating: alertFeedbackTable.rating,
      cnt: count(),
    })
    .from(alertFeedbackTable)
    .innerJoin(alertEventsTable, eq(alertFeedbackTable.alertEventId, alertEventsTable.id))
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(
      and(
        eq(alertFeedbackTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertRulesTable.name, alertFeedbackTable.rating);

  const ruleFeedbackMap = new Map<string, { useful: number; noise: number; total: number }>();
  for (const row of feedbackByRule) {
    if (!ruleFeedbackMap.has(row.ruleName)) {
      ruleFeedbackMap.set(row.ruleName, { useful: 0, noise: 0, total: 0 });
    }
    const e = ruleFeedbackMap.get(row.ruleName)!;
    const n = Number(row.cnt);
    if (row.rating === "useful") e.useful += n;
    if (row.rating === "noise") e.noise += n;
    e.total += n;
  }
  const ruleNoiseScore = new Map<string, number>();
  for (const [rule, counts] of ruleFeedbackMap) {
    ruleNoiseScore.set(rule, counts.total > 0 ? counts.noise / counts.total : 0);
  }

  // ── 3. Fetch alert events in window with joined rule + feedback + workflow ─
  const alertConditions = [eq(alertRulesTable.organizationId, orgId)];
  if (cutoff) {
    alertConditions.push(gte(alertEventsTable.triggeredAt, cutoff));
  }

  const alertRows = await db
    .select({
      alertEventId: alertEventsTable.id,
      eventType: alertEventsTable.eventType,
      issuerName: alertEventsTable.issuerName,
      ruleName: alertRulesTable.name,
      feedbackRating: alertFeedbackTable.rating,
      workflowAction: alertWorkflowStateTable.action,
    })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .leftJoin(
      alertFeedbackTable,
      and(
        eq(alertFeedbackTable.alertEventId, alertEventsTable.id),
        eq(alertFeedbackTable.organizationId, orgId),
      ),
    )
    .leftJoin(
      alertWorkflowStateTable,
      and(
        eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
        eq(alertWorkflowStateTable.organizationId, orgId),
      ),
    )
    .where(and(...alertConditions));

  // ── 4. Deduplicate (left joins may produce multiple rows per alert event) ─
  const alertMap = new Map<
    number,
    {
      eventType: string | null;
      issuerName: string;
      ruleName: string;
      feedbackRating: string | null;
      workflowAction: string | null;
    }
  >();
  for (const row of alertRows) {
    if (!alertMap.has(row.alertEventId)) {
      alertMap.set(row.alertEventId, {
        eventType: row.eventType,
        issuerName: row.issuerName,
        ruleName: row.ruleName,
        feedbackRating: row.feedbackRating ?? null,
        workflowAction: row.workflowAction ?? null,
      });
    } else {
      // Prefer non-null values from subsequent rows
      const existing = alertMap.get(row.alertEventId)!;
      if (!existing.feedbackRating && row.feedbackRating) {
        existing.feedbackRating = row.feedbackRating;
      }
      if (!existing.workflowAction && row.workflowAction) {
        existing.workflowAction = row.workflowAction;
      }
    }
  }

  const alerts = [...alertMap.values()];
  const totalAlerts = alerts.length;

  if (totalAlerts === 0) {
    return {
      totalAlerts: 0,
      adjustedFraction: 0,
      averagePositiveAdjustment: 0,
      averageNegativeAdjustment: 0,
      usefulFeedbackRateAmongBoosted: 0,
      noiseRateAmongPenalised: 0,
      investigateRateAmongPortfolioLinkedBoosted: 0,
      topBoostedEventTypes: [],
      topPenalisedRules: [],
      metricSource: "server-computed",
    };
  }

  // ── 5. Fetch portfolio-linked issuers for the org ───────────────────────
  const portfolioIssuerRows = await db
    .selectDistinct({ issuerName: portfolioIssuerMapTable.canonicalIssuerName })
    .from(portfolioIssuerMapTable)
    .innerJoin(portfolioHoldingsTable, eq(portfolioIssuerMapTable.portfolioHoldingId, portfolioHoldingsTable.id))
    .innerJoin(portfoliosTable, eq(portfolioHoldingsTable.portfolioId, portfoliosTable.id))
    .where(eq(portfoliosTable.organizationId, orgId));

  const portfolioIssuerSet = new Set(portfolioIssuerRows.map((r) => r.issuerName));

  // ── 6. Classify alerts + accumulate metrics ─────────────────────────────
  let boostedCount = 0;
  let penalisedCount = 0;
  let adjustedCount = 0;

  let boostedFeedbackUseful = 0;
  let boostedFeedbackTotal = 0;

  let penalisedFeedbackNoise = 0;
  let penalisedFeedbackTotal = 0;

  let plBoostedInvestigate = 0;
  let plBoostedWorkflowTotal = 0;

  const etBoostAccum = new Map<string, number>();
  const rulePenaltyAccum = new Map<string, number>();

  let totalPositiveAdj = 0;
  let totalNegativeAdj = 0;

  for (const alert of alerts) {
    const et = alert.eventType ?? "(unknown)";
    const rule = alert.ruleName;
    const etScore = etUsefulnessScore.get(et) ?? 0;
    const ruleScore = ruleNoiseScore.get(rule) ?? 0;

    const isBoosted = etScore >= config.eventTypeBoost.threshold;
    const isPenalised = ruleScore >= config.ruleNoisePenalty.threshold;

    if (isBoosted || isPenalised) adjustedCount++;

    if (isBoosted) {
      boostedCount++;
      // Proportional boost: (score - threshold) / (1 - threshold) * max
      // Guard against threshold === 1.0 (division by zero)
      const thresholdRange = Math.max(1 - config.eventTypeBoost.threshold, 0.0001);
      const rawBoost =
        ((etScore - config.eventTypeBoost.threshold) / thresholdRange) *
        config.eventTypeBoost.max;
      const boost = Math.min(rawBoost, config.eventTypeBoost.max);
      totalPositiveAdj += boost;
      etBoostAccum.set(et, (etBoostAccum.get(et) ?? 0) + boost);

      if (alert.feedbackRating) {
        boostedFeedbackTotal++;
        if (alert.feedbackRating === "useful") boostedFeedbackUseful++;
      }

      const isPortfolioLinked = portfolioIssuerSet.has(alert.issuerName);
      if (isPortfolioLinked) {
        if (alert.workflowAction) {
          plBoostedWorkflowTotal++;
          if (alert.workflowAction === "investigate") plBoostedInvestigate++;
        }
      }
    }

    if (isPenalised) {
      penalisedCount++;
      // Guard against threshold === 1.0 (division by zero)
      const thresholdRange = Math.max(1 - config.ruleNoisePenalty.threshold, 0.0001);
      const rawPenalty =
        ((ruleScore - config.ruleNoisePenalty.threshold) / thresholdRange) *
        config.ruleNoisePenalty.max;
      const penalty = Math.min(rawPenalty, config.ruleNoisePenalty.max);
      totalNegativeAdj -= penalty;
      rulePenaltyAccum.set(rule, (rulePenaltyAccum.get(rule) ?? 0) + penalty);

      if (alert.feedbackRating) {
        penalisedFeedbackTotal++;
        if (alert.feedbackRating === "noise") penalisedFeedbackNoise++;
      }
    }
  }

  // ── 7. Compute rates ────────────────────────────────────────────────────
  const adjustedFraction = round4(totalAlerts > 0 ? adjustedCount / totalAlerts : 0);
  const averagePositiveAdjustment = round4(boostedCount > 0 ? totalPositiveAdj / boostedCount : 0);
  const averageNegativeAdjustment = round4(penalisedCount > 0 ? totalNegativeAdj / penalisedCount : 0);
  const usefulFeedbackRateAmongBoosted = round4(
    boostedFeedbackTotal > 0 ? boostedFeedbackUseful / boostedFeedbackTotal : 0,
  );
  const noiseRateAmongPenalised = round4(
    penalisedFeedbackTotal > 0 ? penalisedFeedbackNoise / penalisedFeedbackTotal : 0,
  );
  const investigateRateAmongPortfolioLinkedBoosted = round4(
    plBoostedWorkflowTotal > 0 ? plBoostedInvestigate / plBoostedWorkflowTotal : 0,
  );

  // ── 8. Top lists ────────────────────────────────────────────────────────
  const topBoostedEventTypes = [...etBoostAccum.entries()]
    .map(([eventType, totalBoost]) => ({ eventType, totalBoost: round4(totalBoost) }))
    .sort((a, b) => b.totalBoost - a.totalBoost)
    .slice(0, 5);

  const topPenalisedRules = [...rulePenaltyAccum.entries()]
    .map(([ruleName, totalPenalty]) => ({ ruleName, totalPenalty: round4(totalPenalty) }))
    .sort((a, b) => b.totalPenalty - a.totalPenalty)
    .slice(0, 5);

  return {
    totalAlerts,
    adjustedFraction,
    averagePositiveAdjustment,
    averageNegativeAdjustment,
    usefulFeedbackRateAmongBoosted,
    noiseRateAmongPenalised,
    investigateRateAmongPortfolioLinkedBoosted,
    topBoostedEventTypes,
    topPenalisedRules,
    metricSource: "server-computed",
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
