/**
 * services/outcomeAttributionService.ts
 *
 * Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Pure utility functions that answer outcome attribution questions from
 * persisted DB data.  All functions are org-scoped, async, and have no
 * side effects.
 *
 * Questions answered:
 * - Among alerts moved up (boosted), how many were later investigated?
 * - Among alerts moved down (penalised), how many were later marked noise?
 * - Which event types most often produce boosted-useful alerts?
 * - Which rules most often produce penalised-noisy alerts?
 */

import {
  db,
  alertRulesTable,
  alertEventsTable,
  alertFeedbackTable,
  alertWorkflowStateTable,
} from "@workspace/db";
import { and, eq, count } from "drizzle-orm";
import type { CalibrationConfig } from "./snapshotMetricsService";
import { DEFAULT_CALIBRATION_CONFIG } from "./snapshotMetricsService";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** Attribution stats for a single event type or rule. */
export interface AttributionRow {
  label: string;
  boostedOrPenalisedCount: number;
  outcomeFavourableCount: number;
  /** favourableCount / boostedOrPenalisedCount */
  favourableRate: number;
}

/** Full outcome attribution summary for an org. */
export interface OutcomeAttributionSummary {
  /** Total alerts in scope */
  totalAlerts: number;

  /** How many alerts were classified as "boosted" by the model */
  boostedCount: number;
  /** Among boosted alerts with workflow state, how many were investigated */
  boostedInvestigatedCount: number;
  /** investigatedCount / boostedWithWorkflow */
  boostedInvestigateRate: number;

  /** How many alerts were classified as "penalised" by the model */
  penalisedCount: number;
  /** Among penalised alerts with feedback, how many were marked noise */
  penalisedNoiseCount: number;
  /** noiseCount / penalisedWithFeedback */
  penalisedNoiseRate: number;

  /**
   * Top event types where boosted alerts received "useful" feedback —
   * sorted by favourableRate descending.
   */
  topBoostedUsefulEventTypes: AttributionRow[];

  /**
   * Top rules where penalised alerts received "noise" feedback —
   * sorted by favourableRate descending.
   */
  topPenalisedNoisyRules: AttributionRow[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compute outcome attribution for the given org.
 *
 * Uses calibration config thresholds to identify boosted and penalised
 * alerts, then checks feedback and workflow outcomes.
 */
export async function computeOutcomeAttribution(
  orgId: string,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): Promise<OutcomeAttributionSummary> {
  // ── 1. Usefulness scores per event type ────────────────────────────────
  const etFeedback = await db
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
  for (const row of etFeedback) {
    const et = row.eventType ?? "(unknown)";
    if (!etFeedbackMap.has(et)) etFeedbackMap.set(et, { useful: 0, noise: 0, total: 0 });
    const e = etFeedbackMap.get(et)!;
    const n = Number(row.cnt);
    if (row.rating === "useful") e.useful += n;
    if (row.rating === "noise") e.noise += n;
    e.total += n;
  }
  const etUsefulnessScore = new Map<string, number>();
  for (const [et, c] of etFeedbackMap) {
    etUsefulnessScore.set(et, c.total > 0 ? c.useful / c.total : 0);
  }

  // ── 2. Noise scores per rule ────────────────────────────────────────────
  const ruleFeedback = await db
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
  for (const row of ruleFeedback) {
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
  for (const [rule, c] of ruleFeedbackMap) {
    ruleNoiseScore.set(rule, c.total > 0 ? c.noise / c.total : 0);
  }

  // ── 3. Fetch all alert events for the org with feedback + workflow ───────
  const alertRows = await db
    .select({
      alertEventId: alertEventsTable.id,
      eventType: alertEventsTable.eventType,
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
    .where(eq(alertRulesTable.organizationId, orgId));

  // Deduplicate (left joins may multiply rows)
  const alertMap = new Map<
    number,
    { eventType: string | null; ruleName: string; feedbackRating: string | null; workflowAction: string | null }
  >();
  for (const row of alertRows) {
    if (!alertMap.has(row.alertEventId)) {
      alertMap.set(row.alertEventId, {
        eventType: row.eventType,
        ruleName: row.ruleName,
        feedbackRating: row.feedbackRating ?? null,
        workflowAction: row.workflowAction ?? null,
      });
    } else {
      const e = alertMap.get(row.alertEventId)!;
      if (!e.feedbackRating && row.feedbackRating) e.feedbackRating = row.feedbackRating;
      if (!e.workflowAction && row.workflowAction) e.workflowAction = row.workflowAction;
    }
  }

  const alerts = [...alertMap.values()];
  const totalAlerts = alerts.length;

  // ── 4. Classify and accumulate ─────────────────────────────────────────
  let boostedCount = 0;
  let boostedWithWorkflow = 0;
  let boostedInvestigatedCount = 0;

  let penalisedCount = 0;
  let penalisedWithFeedback = 0;
  let penalisedNoiseCount = 0;

  // Per-event-type: boosted alerts that got useful feedback
  const etBoostedUseful = new Map<string, { boosted: number; useful: number }>();
  // Per-rule: penalised alerts that got noise feedback
  const rulePenalisedNoisy = new Map<string, { penalised: number; noisy: number }>();

  for (const alert of alerts) {
    const et = alert.eventType ?? "(unknown)";
    const rule = alert.ruleName;
    const etScore = etUsefulnessScore.get(et) ?? 0;
    const ruleScore = ruleNoiseScore.get(rule) ?? 0;

    const isBoosted = etScore >= config.eventTypeBoost.threshold;
    const isPenalised = ruleScore >= config.ruleNoisePenalty.threshold;

    if (isBoosted) {
      boostedCount++;
      if (!etBoostedUseful.has(et)) etBoostedUseful.set(et, { boosted: 0, useful: 0 });
      const e = etBoostedUseful.get(et)!;
      e.boosted++;
      if (alert.feedbackRating === "useful") e.useful++;

      if (alert.workflowAction) {
        boostedWithWorkflow++;
        if (alert.workflowAction === "investigate") boostedInvestigatedCount++;
      }
    }

    if (isPenalised) {
      penalisedCount++;
      if (!rulePenalisedNoisy.has(rule)) rulePenalisedNoisy.set(rule, { penalised: 0, noisy: 0 });
      const e = rulePenalisedNoisy.get(rule)!;
      e.penalised++;
      if (alert.feedbackRating === "noise") {
        e.noisy++;
        penalisedNoiseCount++;
      }
      if (alert.feedbackRating) penalisedWithFeedback++;
    }
  }

  // ── 5. Derived rates ───────────────────────────────────────────────────
  const boostedInvestigateRate =
    boostedWithWorkflow > 0 ? round4(boostedInvestigatedCount / boostedWithWorkflow) : 0;
  const penalisedNoiseRate =
    penalisedWithFeedback > 0 ? round4(penalisedNoiseCount / penalisedWithFeedback) : 0;

  // ── 6. Top lists ───────────────────────────────────────────────────────
  const topBoostedUsefulEventTypes: AttributionRow[] = [...etBoostedUseful.entries()]
    .map(([label, { boosted, useful }]) => ({
      label,
      boostedOrPenalisedCount: boosted,
      outcomeFavourableCount: useful,
      favourableRate: boosted > 0 ? round4(useful / boosted) : 0,
    }))
    .sort((a, b) => b.favourableRate - a.favourableRate)
    .slice(0, 5);

  const topPenalisedNoisyRules: AttributionRow[] = [...rulePenalisedNoisy.entries()]
    .map(([label, { penalised, noisy }]) => ({
      label,
      boostedOrPenalisedCount: penalised,
      outcomeFavourableCount: noisy,
      favourableRate: penalised > 0 ? round4(noisy / penalised) : 0,
    }))
    .sort((a, b) => b.favourableRate - a.favourableRate)
    .slice(0, 5);

  return {
    totalAlerts,
    boostedCount,
    boostedInvestigatedCount,
    boostedInvestigateRate,
    penalisedCount,
    penalisedNoiseCount,
    penalisedNoiseRate,
    topBoostedUsefulEventTypes,
    topPenalisedNoisyRules,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
