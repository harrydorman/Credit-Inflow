/**
 * Tests for lib/outcomeAttribution.ts (Phase 13).
 *
 * Pure utility: computeOutcomeAttribution
 */

import { describe, it, expect } from "vitest";
import type { AlertEvent } from "@workspace/api-client-react";
import { computeOutcomeAttribution } from "./outcomeAttribution";
import type { AlertRankingComparison } from "./rankingEvaluation";
import type { RankingBreakdown } from "./alertPriority";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASELINE_BREAKDOWN: RankingBreakdown = {
  baseScore: 60,
  eventTypeBoost: 0,
  issuerBoost: 0,
  ruleNoisePenalty: 0,
  analyticsAdjustment: 0,
  finalScore: 60,
  modelVersion: "v1.1.0",
};

function makeAlert(
  id: number,
  overrides: Partial<AlertEvent & { ruleName?: string | null }> = {},
): AlertEvent & { ruleName?: string | null } {
  return {
    id,
    alertRuleId: 10,
    watchlistId: 1,
    articleId: id + 100,
    issuerName: `Issuer ${id}`,
    title: `Alert ${id}`,
    urgency: 6,
    confidence: 0.7,
    severity: "medium",
    portfolioLinked: false,
    eventType: "downgrade",
    triggeredAt: new Date().toISOString(),
    isRead: false,
    workflowAction: null,
    feedbackRating: null,
    ruleName: "Default Rule",
    ...overrides,
  };
}

function makeComparison(
  alertId: number,
  scoreDelta: number,
): AlertRankingComparison {
  return {
    alertId,
    issuerName: `Issuer ${alertId}`,
    title: `Alert ${alertId}`,
    baselineScore: 60,
    analyticsScore: 60 + scoreDelta,
    scoreDelta,
    breakdown: { ...BASELINE_BREAKDOWN, finalScore: 60 + scoreDelta, analyticsAdjustment: scoreDelta },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeOutcomeAttribution — empty inputs", () => {
  it("returns all zeros when no comparisons exist", () => {
    const result = computeOutcomeAttribution([], []);
    expect(result.totalAlerts).toBe(0);
    expect(result.boostedCount).toBe(0);
    expect(result.penalisedCount).toBe(0);
    expect(result.boostedInvestigateRate).toBe(0);
    expect(result.penalisedNoiseRate).toBe(0);
    expect(result.topBoostedInvestigatedEventTypes).toHaveLength(0);
    expect(result.topPenalisedNoisyRules).toHaveLength(0);
  });
});

describe("computeOutcomeAttribution — boosted alerts", () => {
  it("counts boosted alerts correctly", () => {
    const comparisons = [
      makeComparison(1, 5),   // boosted
      makeComparison(2, 0),   // unchanged
      makeComparison(3, -3),  // penalised
    ];
    const alerts = [
      makeAlert(1),
      makeAlert(2),
      makeAlert(3),
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.boostedCount).toBe(1);
    expect(result.penalisedCount).toBe(1);
    expect(result.totalAlerts).toBe(3);
  });

  it("computes boostedInvestigateRate from alerts with workflowAction", () => {
    const comparisons = [makeComparison(1, 5), makeComparison(2, 3)];
    const alerts = [
      makeAlert(1, { workflowAction: "investigate" }),
      makeAlert(2, { workflowAction: "monitor" }),
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.boostedCount).toBe(2);
    expect(result.boostedInvestigatedCount).toBe(1);
    expect(result.boostedInvestigateRate).toBe(0.5);
  });

  it("excludes boosted alerts without workflowAction from rate denominator", () => {
    const comparisons = [makeComparison(1, 5), makeComparison(2, 3)];
    const alerts = [
      makeAlert(1, { workflowAction: "investigate" }),
      makeAlert(2, { workflowAction: null }),  // no workflow
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    // Only alert 1 has workflow action, and it was investigated → rate = 1.0
    expect(result.boostedInvestigateRate).toBe(1.0);
  });

  it("returns boostedInvestigateRate = 0 when no boosted alerts have workflow", () => {
    const comparisons = [makeComparison(1, 5)];
    const alerts = [makeAlert(1, { workflowAction: null })];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.boostedInvestigateRate).toBe(0);
  });
});

describe("computeOutcomeAttribution — penalised alerts", () => {
  it("computes penalisedNoiseRate from alerts with feedbackRating", () => {
    const comparisons = [makeComparison(1, -4), makeComparison(2, -2)];
    const alerts = [
      makeAlert(1, { feedbackRating: "noise" }),
      makeAlert(2, { feedbackRating: "useful" }),
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.penalisedCount).toBe(2);
    expect(result.penalisedNoiseCount).toBe(1);
    expect(result.penalisedNoiseRate).toBe(0.5);
  });

  it("excludes penalised alerts without feedbackRating from rate denominator", () => {
    const comparisons = [makeComparison(1, -4), makeComparison(2, -2)];
    const alerts = [
      makeAlert(1, { feedbackRating: "noise" }),
      makeAlert(2, { feedbackRating: null }),  // no feedback
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    // Only alert 1 has feedback and it's noise → rate = 1.0
    expect(result.penalisedNoiseRate).toBe(1.0);
  });

  it("returns penalisedNoiseRate = 0 when no penalised alerts have feedback", () => {
    const comparisons = [makeComparison(1, -4)];
    const alerts = [makeAlert(1, { feedbackRating: null })];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.penalisedNoiseRate).toBe(0);
  });
});

describe("computeOutcomeAttribution — top lists", () => {
  it("groups boosted alerts by event type", () => {
    const comparisons = [makeComparison(1, 5), makeComparison(2, 3)];
    const alerts = [
      makeAlert(1, { eventType: "downgrade", workflowAction: "investigate" }),
      makeAlert(2, { eventType: "downgrade", workflowAction: "investigate" }),
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.topBoostedInvestigatedEventTypes).toHaveLength(1);
    expect(result.topBoostedInvestigatedEventTypes[0].label).toBe("downgrade");
    expect(result.topBoostedInvestigatedEventTypes[0].count).toBe(2);
    expect(result.topBoostedInvestigatedEventTypes[0].favourableCount).toBe(2);
    expect(result.topBoostedInvestigatedEventTypes[0].favourableRate).toBe(1.0);
  });

  it("groups penalised alerts by rule name", () => {
    const comparisons = [makeComparison(1, -4), makeComparison(2, -2)];
    const alerts = [
      makeAlert(1, { ruleName: "Noisy Rule", feedbackRating: "noise" }),
      makeAlert(2, { ruleName: "Noisy Rule", feedbackRating: "noise" }),
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.topPenalisedNoisyRules).toHaveLength(1);
    expect(result.topPenalisedNoisyRules[0].label).toBe("Noisy Rule");
    expect(result.topPenalisedNoisyRules[0].count).toBe(2);
    expect(result.topPenalisedNoisyRules[0].favourableRate).toBe(1.0);
  });

  it("sorts top lists by favourableRate descending", () => {
    const comparisons = [
      makeComparison(1, 5),
      makeComparison(2, 3),
      makeComparison(3, 2),
    ];
    const alerts = [
      makeAlert(1, { eventType: "downgrade", workflowAction: "investigate" }),  // 100%
      makeAlert(2, { eventType: "news", workflowAction: "monitor" }),             // 0%
      makeAlert(3, { eventType: "rating_watch", workflowAction: "investigate" }), // 100%
    ];
    const result = computeOutcomeAttribution(comparisons, alerts);
    // downgrade and rating_watch both 100%, news 0%
    const rates = result.topBoostedInvestigatedEventTypes.map((r) => r.favourableRate);
    expect(rates[0]).toBeGreaterThanOrEqual(rates[rates.length - 1]);
  });

  it("limits top lists to 5 entries", () => {
    const comparisons = Array.from({ length: 10 }, (_, i) => makeComparison(i + 1, 5));
    const alerts = Array.from({ length: 10 }, (_, i) =>
      makeAlert(i + 1, { eventType: `type_${i}`, workflowAction: "investigate" }),
    );
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.topBoostedInvestigatedEventTypes.length).toBeLessThanOrEqual(5);
  });
});

describe("computeOutcomeAttribution — alert data enrichment", () => {
  it("gracefully handles comparisons whose alertId has no matching alert", () => {
    const comparisons = [makeComparison(999, 5)];
    const alerts: (AlertEvent & { ruleName?: string | null })[] = [];
    // Should not throw
    expect(() => computeOutcomeAttribution(comparisons, alerts)).not.toThrow();
    const result = computeOutcomeAttribution(comparisons, alerts);
    expect(result.boostedCount).toBe(1);
    expect(result.boostedInvestigatedCount).toBe(0);
  });
});
