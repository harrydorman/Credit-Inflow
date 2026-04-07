/**
 * Tests for Phase 12 dashboard utilities:
 * - rankingRecommendations.ts
 * - snapshotComparison.ts
 */

import { describe, it, expect } from "vitest";
import {
  generateRecommendations,
  generateTrendRecommendations,
  getAllRecommendations,
} from "@/lib/rankingRecommendations";
import { compareSnapshots } from "@/lib/snapshotComparison";
import type { RankingAggregateMetrics, TrendMetrics } from "@/lib/rankingEvaluation";
import type { RankingSnapshotMetrics } from "@/lib/snapshotTypes";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<RankingAggregateMetrics> = {}): RankingAggregateMetrics {
  return {
    totalAlerts: 100,
    adjustedCount: 20,
    adjustedFraction: 0.2,
    boostedCount: 10,
    penalisedCount: 10,
    averagePositiveAdjustment: 4,
    averageNegativeAdjustment: -3,
    topBoostedEventTypes: [{ eventType: "downgrade", totalBoost: 20 }],
    topPenalisedRules: [{ ruleName: "Rule A", totalPenalty: 10 }],
    ...overrides,
  };
}

function makeTrend(overrides: Partial<TrendMetrics> = {}): TrendMetrics {
  return {
    window: "30d",
    alertCount: 100,
    usefulFeedbackRateAmongBoosted: 0.65,
    noiseRateAmongPenalised: 0.55,
    investigateRateAmongPortfolioLinkedBoosted: 0.5,
    ...overrides,
  };
}

function makeSnapshotMetrics(overrides: Partial<RankingSnapshotMetrics> = {}): RankingSnapshotMetrics {
  return {
    totalAlerts: 80,
    adjustedFraction: 0.15,
    averagePositiveAdjustment: 3.0,
    averageNegativeAdjustment: -2.5,
    usefulFeedbackRateAmongBoosted: 0.5,
    noiseRateAmongPenalised: 0.4,
    investigateRateAmongPortfolioLinkedBoosted: 0.35,
    topBoostedEventTypes: [{ eventType: "downgrade", totalBoost: 15 }],
    topPenalisedRules: [{ ruleName: "Rule A", totalPenalty: 8 }],
    ...overrides,
  };
}

// ─── generateRecommendations ──────────────────────────────────────────────────

describe("generateRecommendations", () => {
  it("returns no recommendations for nominal metrics", () => {
    const recs = generateRecommendations(
      makeMetrics({
        // Use multiple penalised rules so the concentrated-rules check doesn't fire
        topPenalisedRules: [
          { ruleName: "Rule A", totalPenalty: 10 },
          { ruleName: "Rule B", totalPenalty: 8 },
          { ruleName: "Rule C", totalPenalty: 5 },
        ],
      }),
    );
    // 0.2 adjusted fraction is within normal range → no urgent recs from fraction alone
    // With multiple penalised rules no action rec; with boosted event type → info rec only
    const nonInfo = recs.filter((r) => r.severity !== "info");
    expect(nonInfo).toHaveLength(0);
  });

  it("recommends lowering thresholds when adjustedFraction is very low", () => {
    const recs = generateRecommendations(
      makeMetrics({ adjustedFraction: 0.02, adjustedCount: 2 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("adjustedFraction") && r.severity === "warning");
    expect(rec).toBeTruthy();
    expect(rec!.suggestion).toMatch(/threshold/i);
  });

  it("recommends raising thresholds when adjustedFraction is very high", () => {
    const recs = generateRecommendations(
      makeMetrics({ adjustedFraction: 0.75, adjustedCount: 75 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("adjustedFraction") && r.severity === "warning");
    expect(rec).toBeTruthy();
    expect(rec!.suggestion).toMatch(/rais/i);
  });

  it("recommends targeted rule review when only 1 or 2 rules are penalised", () => {
    const recs = generateRecommendations(
      makeMetrics({
        topPenalisedRules: [{ ruleName: "Rule A", totalPenalty: 10 }],
      }),
    );
    const rec = recs.find((r) => r.basedOn.includes("topPenalisedRules") && r.severity === "action");
    expect(rec).toBeTruthy();
    expect(rec!.suggestion).toMatch(/rule/i);
  });

  it("does not recommend targeted rule review when many rules are penalised", () => {
    const recs = generateRecommendations(
      makeMetrics({
        topPenalisedRules: [
          { ruleName: "Rule A", totalPenalty: 10 },
          { ruleName: "Rule B", totalPenalty: 8 },
          { ruleName: "Rule C", totalPenalty: 5 },
        ],
      }),
    );
    const rec = recs.find((r) => r.basedOn.includes("topPenalisedRules") && r.severity === "action");
    expect(rec).toBeUndefined();
  });

  it("includes metric values in recommendation detail", () => {
    const recs = generateRecommendations(
      makeMetrics({ adjustedFraction: 0.02, adjustedCount: 2, totalAlerts: 100 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("adjustedFraction"));
    expect(rec!.detail).toMatch(/2%/);
    expect(rec!.detail).toMatch(/2\/100/);
  });

  it("returns an info recommendation when boosted event types exist", () => {
    const recs = generateRecommendations(
      makeMetrics({
        boostedCount: 5,
        averagePositiveAdjustment: 3,
        topBoostedEventTypes: [{ eventType: "downgrade", totalBoost: 15 }],
      }),
    );
    const rec = recs.find((r) => r.basedOn.includes("topBoostedEventTypes"));
    expect(rec).toBeTruthy();
    expect(rec!.severity).toBe("info");
  });

  it("returns no recommendations when there are no alerts", () => {
    const recs = generateRecommendations(
      makeMetrics({
        totalAlerts: 0,
        adjustedCount: 0,
        adjustedFraction: 0,
        boostedCount: 0,
        averagePositiveAdjustment: 0,
        topBoostedEventTypes: [],
        topPenalisedRules: [],
      }),
    );
    const urgentRecs = recs.filter((r) => r.severity === "warning" || r.severity === "action");
    expect(urgentRecs).toHaveLength(0);
  });
});

// ─── generateTrendRecommendations ─────────────────────────────────────────────

describe("generateTrendRecommendations", () => {
  it("returns no recommendations when all trend rates are healthy", () => {
    const recs = generateTrendRecommendations(
      makeTrend({
        usefulFeedbackRateAmongBoosted: 0.75,
        noiseRateAmongPenalised: 0.65,
        investigateRateAmongPortfolioLinkedBoosted: 0.6,
      }),
    );
    expect(recs).toHaveLength(0);
  });

  it("recommends raising boost threshold when useful feedback rate is low", () => {
    const recs = generateTrendRecommendations(
      makeTrend({ usefulFeedbackRateAmongBoosted: 0.2 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("usefulFeedbackRateAmongBoosted"));
    expect(rec).toBeTruthy();
    expect(rec!.severity).toBe("action");
    expect(rec!.suggestion).toMatch(/eventTypeBoost.threshold/i);
  });

  it("recommends raising penalty threshold when noise rate among penalised is low", () => {
    const recs = generateTrendRecommendations(
      makeTrend({ noiseRateAmongPenalised: 0.1 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("noiseRateAmongPenalised"));
    expect(rec).toBeTruthy();
    expect(rec!.severity).toBe("action");
    expect(rec!.suggestion).toMatch(/ruleNoisePenalty/i);
  });

  it("recommends increasing issuer influence when portfolio-linked rate is low", () => {
    const recs = generateTrendRecommendations(
      makeTrend({ investigateRateAmongPortfolioLinkedBoosted: 0.1 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("investigateRateAmongPortfolioLinkedBoosted"));
    expect(rec).toBeTruthy();
    expect(rec!.severity).toBe("warning");
    expect(rec!.suggestion).toMatch(/issuer/i);
  });

  it("includes percentage values in recommendation detail", () => {
    const recs = generateTrendRecommendations(
      makeTrend({ usefulFeedbackRateAmongBoosted: 0.2 }),
    );
    const rec = recs.find((r) => r.basedOn.includes("usefulFeedbackRateAmongBoosted"));
    expect(rec!.detail).toMatch(/20%/);
  });

  it("returns empty when alertCount is 0", () => {
    const recs = generateTrendRecommendations(makeTrend({ alertCount: 0 }));
    expect(recs).toHaveLength(0);
  });
});

// ─── getAllRecommendations ─────────────────────────────────────────────────────

describe("getAllRecommendations", () => {
  it("merges metrics and trend recommendations", () => {
    const metrics = makeMetrics({ adjustedFraction: 0.02, adjustedCount: 2 });
    const trend = makeTrend({ usefulFeedbackRateAmongBoosted: 0.2 });
    const recs = getAllRecommendations(metrics, trend);
    expect(recs.length).toBeGreaterThan(1);
  });

  it("sorts by severity: action > warning > info", () => {
    const metrics = makeMetrics({ adjustedFraction: 0.02, adjustedCount: 2 });
    const trend = makeTrend({ usefulFeedbackRateAmongBoosted: 0.2, noiseRateAmongPenalised: 0.1 });
    const recs = getAllRecommendations(metrics, trend);
    const severityOrder = { action: 0, warning: 1, info: 2 };
    for (let i = 1; i < recs.length; i++) {
      expect(severityOrder[recs[i].severity]).toBeGreaterThanOrEqual(
        severityOrder[recs[i - 1].severity],
      );
    }
  });

  it("works without trend metrics", () => {
    const recs = getAllRecommendations(makeMetrics({ adjustedFraction: 0.02, adjustedCount: 2 }));
    expect(Array.isArray(recs)).toBe(true);
  });

  it("works with null trend", () => {
    const recs = getAllRecommendations(makeMetrics(), null);
    expect(Array.isArray(recs)).toBe(true);
  });
});

// ─── compareSnapshots ─────────────────────────────────────────────────────────

describe("compareSnapshots", () => {
  it("returns improved when all three signal metrics increased", () => {
    const baseline = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.4,
      noiseRateAmongPenalised: 0.4,
      investigateRateAmongPortfolioLinkedBoosted: 0.3,
    });
    const current = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.7,
      noiseRateAmongPenalised: 0.7,
      investigateRateAmongPortfolioLinkedBoosted: 0.6,
    });
    const result = compareSnapshots(baseline, current, "v1.0.0", "v1.1.0", "30d");
    expect(result.overallAssessment).toBe("improved");
  });

  it("returns worsened when all three signal metrics decreased", () => {
    const baseline = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.7,
      noiseRateAmongPenalised: 0.7,
      investigateRateAmongPortfolioLinkedBoosted: 0.6,
    });
    const current = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.3,
      noiseRateAmongPenalised: 0.3,
      investigateRateAmongPortfolioLinkedBoosted: 0.2,
    });
    const result = compareSnapshots(baseline, current, "v1.0.0", "v1.1.0", "30d");
    expect(result.overallAssessment).toBe("worsened");
  });

  it("returns mixed when signals are a mix of improved and worsened", () => {
    const baseline = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.7,
      noiseRateAmongPenalised: 0.3,
      investigateRateAmongPortfolioLinkedBoosted: 0.5,
    });
    const current = makeSnapshotMetrics({
      usefulFeedbackRateAmongBoosted: 0.4,
      noiseRateAmongPenalised: 0.7,
      investigateRateAmongPortfolioLinkedBoosted: 0.5,
    });
    const result = compareSnapshots(baseline, current, "v1.0.0", "v1.1.0", "30d");
    expect(result.overallAssessment).toBe("mixed");
  });

  it("returns unchanged when deltas are below threshold", () => {
    const base = makeSnapshotMetrics();
    const result = compareSnapshots(base, base, "v1.0.0", "v1.0.0", "all");
    expect(result.overallAssessment).toBe("unchanged");
  });

  it("computes correct metric deltas", () => {
    const baseline = makeSnapshotMetrics({ usefulFeedbackRateAmongBoosted: 0.5 });
    const current = makeSnapshotMetrics({ usefulFeedbackRateAmongBoosted: 0.7 });
    const result = compareSnapshots(baseline, current, "v1.0.0", "v1.1.0", "30d");
    const delta = result.signalDeltas.usefulFeedbackRateAmongBoosted;
    expect(delta.delta).toBeCloseTo(0.2);
    expect(delta.direction).toBe("improved");
  });

  it("marks a decrease in usefulFeedbackRateAmongBoosted as worsened", () => {
    const baseline = makeSnapshotMetrics({ usefulFeedbackRateAmongBoosted: 0.7 });
    const current = makeSnapshotMetrics({ usefulFeedbackRateAmongBoosted: 0.3 });
    const result = compareSnapshots(baseline, current, "v1.0.0", "v1.1.0", "30d");
    expect(result.signalDeltas.usefulFeedbackRateAmongBoosted.direction).toBe("worsened");
  });

  it("includes 7 numeric deltas total", () => {
    const result = compareSnapshots(makeSnapshotMetrics(), makeSnapshotMetrics(), "v1.0.0", "v1.1.0", "all");
    expect(result.deltas).toHaveLength(7);
  });

  it("preserves model version labels", () => {
    const result = compareSnapshots(makeSnapshotMetrics(), makeSnapshotMetrics(), "v1.0.0", "v1.1.0", "7d");
    expect(result.baselineModelVersion).toBe("v1.0.0");
    expect(result.currentModelVersion).toBe("v1.1.0");
    expect(result.timeWindow).toBe("7d");
  });
});
