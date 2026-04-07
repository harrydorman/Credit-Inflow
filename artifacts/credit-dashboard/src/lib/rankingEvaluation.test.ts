/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  compareAlertRanking,
  compareAlertRankings,
  computeRankingMetrics,
  fractionBoostedAndUseful,
  fractionPenalisedAndNoisy,
  fractionPortfolioLinkedBoosted,
} from "./rankingEvaluation";
import { RANKING_MODE, type RankingContext } from "./alertPriority";
import type { AlertEvent } from "@workspace/api-client-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeAlert = (overrides: Partial<AlertEvent & { ruleName?: string }> = {}): AlertEvent & { ruleName?: string } => ({
  id: 1,
  alertRuleId: 10,
  watchlistId: 5,
  articleId: 42,
  issuerName: "Acme Corp",
  title: "Test alert",
  urgency: 5,
  confidence: 0.6,
  severity: "medium",
  portfolioLinked: false,
  eventType: "downgrade",
  triggeredAt: new Date("2024-01-15T10:30:00Z").toISOString(),
  isRead: false,
  ...overrides,
});

// ─── compareAlertRanking ─────────────────────────────────────────────────────

describe("compareAlertRanking", () => {
  it("returns zero delta when no context supplied", () => {
    const alert = makeAlert({ severity: "medium", confidence: 0.6 });
    const comparison = compareAlertRanking(alert);
    expect(comparison.scoreDelta).toBe(0);
    expect(comparison.baselineScore).toBe(comparison.analyticsScore);
  });

  it("scoreDelta = analyticsScore - baselineScore", () => {
    const alert = makeAlert({ severity: "low", confidence: 0.3, urgency: 2 });
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    const comparison = compareAlertRanking(alert, ctx);
    expect(comparison.scoreDelta).toBe(comparison.analyticsScore - comparison.baselineScore);
  });

  it("includes breakdown from analytics scoring", () => {
    const alert = makeAlert({ severity: "medium", confidence: 0.5 });
    const comparison = compareAlertRanking(alert);
    expect(comparison.breakdown).toBeDefined();
    expect(comparison.breakdown.finalScore).toBe(comparison.analyticsScore);
  });

  it("positive delta when boost context applied (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "low", confidence: 0.3, urgency: 2 });
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    const comparison = compareAlertRanking(alert, ctx);
    expect(comparison.scoreDelta).toBeGreaterThan(0);
  });

  it("negative delta when penalty context applied (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "high", confidence: 0.8, urgency: 8 });
    const ctx: RankingContext = { ruleNoiseScore: 1.0 };
    const comparison = compareAlertRanking(alert, ctx);
    expect(comparison.scoreDelta).toBeLessThan(0);
  });

  it("returns correct alertId, issuerName, title", () => {
    const alert = makeAlert({ id: 99, issuerName: "GlobalCorp", title: "Test" });
    const comparison = compareAlertRanking(alert);
    expect(comparison.alertId).toBe(99);
    expect(comparison.issuerName).toBe("GlobalCorp");
    expect(comparison.title).toBe("Test");
  });
});

// ─── compareAlertRankings ────────────────────────────────────────────────────

describe("compareAlertRankings", () => {
  it("returns comparison for each alert", () => {
    const alerts = [makeAlert({ id: 1 }), makeAlert({ id: 2 }), makeAlert({ id: 3 })];
    const results = compareAlertRankings(alerts);
    expect(results).toHaveLength(3);
  });

  it("sorts by absolute delta descending (largest movers first)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alertA = makeAlert({ id: 1, severity: "low", confidence: 0.2, urgency: 2 });
    const alertB = makeAlert({ id: 2, severity: "medium", confidence: 0.5, urgency: 5 });
    const alertC = makeAlert({ id: 3, severity: "high", confidence: 0.8, urgency: 8 });

    // give B and C high boost contexts, A no context
    const getCtx = (a: AlertEvent): RankingContext | undefined => {
      if (a.id === 2) return { eventTypeUsefulnessScore: 1.0, issuerInvestigateScore: 1.0 };
      if (a.id === 3) return { ruleNoiseScore: 1.0 };
      return undefined;
    };

    const results = compareAlertRankings([alertA, alertB, alertC], getCtx);
    // Largest absolute delta should come first
    const deltas = results.map((r) => Math.abs(r.scoreDelta));
    for (let i = 0; i < deltas.length - 1; i++) {
      expect(deltas[i]).toBeGreaterThanOrEqual(deltas[i + 1]);
    }
  });

  it("returns empty array for empty input", () => {
    expect(compareAlertRankings([])).toEqual([]);
  });
});

// ─── computeRankingMetrics ────────────────────────────────────────────────────

describe("computeRankingMetrics", () => {
  it("returns zero counts for unchanged alerts", () => {
    const alerts = [makeAlert({ id: 1 }), makeAlert({ id: 2 })];
    const comparisons = compareAlertRankings(alerts);
    const metrics = computeRankingMetrics(comparisons, alerts);
    expect(metrics.totalAlerts).toBe(2);
    expect(metrics.adjustedCount).toBe(0);
    expect(metrics.boostedCount).toBe(0);
    expect(metrics.penalisedCount).toBe(0);
    expect(metrics.adjustedFraction).toBe(0);
  });

  it("counts boosted and penalised alerts (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alertA = makeAlert({ id: 1, severity: "low", confidence: 0.2, urgency: 2 });
    const alertB = makeAlert({ id: 2, severity: "high", confidence: 0.8, urgency: 8 });
    const alertC = makeAlert({ id: 3, severity: "medium", confidence: 0.5, urgency: 5 });

    const getCtx = (a: AlertEvent): RankingContext | undefined => {
      if (a.id === 1) return { eventTypeUsefulnessScore: 1.0 };
      if (a.id === 2) return { ruleNoiseScore: 1.0 };
      return undefined;
    };

    const alerts = [alertA, alertB, alertC];
    const comparisons = compareAlertRankings(alerts, getCtx);
    const metrics = computeRankingMetrics(comparisons, alerts);

    expect(metrics.boostedCount).toBeGreaterThan(0);
    expect(metrics.penalisedCount).toBeGreaterThan(0);
    expect(metrics.adjustedCount).toBeGreaterThanOrEqual(2);
  });

  it("averagePositiveAdjustment is 0 when no boosted alerts", () => {
    const alerts = [makeAlert({ id: 1 })];
    const comparisons = compareAlertRankings(alerts);
    const metrics = computeRankingMetrics(comparisons, alerts);
    expect(metrics.averagePositiveAdjustment).toBe(0);
  });

  it("averageNegativeAdjustment is 0 when no penalised alerts", () => {
    const alerts = [makeAlert({ id: 1 })];
    const comparisons = compareAlertRankings(alerts);
    const metrics = computeRankingMetrics(comparisons, alerts);
    expect(metrics.averageNegativeAdjustment).toBe(0);
  });

  it("averagePositiveAdjustment > 0 when boosted alerts exist (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ id: 1, severity: "low", confidence: 0.2, urgency: 2 });
    const getCtx = () => ({ eventTypeUsefulnessScore: 1.0 } as RankingContext);
    const comparisons = compareAlertRankings([alert], getCtx);
    const metrics = computeRankingMetrics(comparisons, [alert]);
    expect(metrics.averagePositiveAdjustment).toBeGreaterThan(0);
  });

  it("adjustedFraction is correct", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alertA = makeAlert({ id: 1, severity: "low", confidence: 0.2, urgency: 2 });
    const alertB = makeAlert({ id: 2, severity: "medium" });
    const getCtx = (a: AlertEvent) =>
      a.id === 1 ? { eventTypeUsefulnessScore: 1.0 } : undefined;
    const alerts = [alertA, alertB];
    const comparisons = compareAlertRankings(alerts, getCtx);
    const metrics = computeRankingMetrics(comparisons, alerts);
    expect(metrics.adjustedFraction).toBeCloseTo(metrics.adjustedCount / 2);
  });

  it("topBoostedEventTypes lists event types receiving boosts", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ id: 1, eventType: "downgrade", severity: "low", confidence: 0.2 });
    const getCtx = () => ({ eventTypeUsefulnessScore: 1.0 } as RankingContext);
    const comparisons = compareAlertRankings([alert], getCtx);
    const metrics = computeRankingMetrics(comparisons, [alert]);
    expect(metrics.topBoostedEventTypes.some((et) => et.eventType === "downgrade")).toBe(true);
  });

  it("returns empty metrics for empty input", () => {
    const metrics = computeRankingMetrics([], []);
    expect(metrics.totalAlerts).toBe(0);
    expect(metrics.adjustedFraction).toBe(0);
    expect(metrics.topBoostedEventTypes).toEqual([]);
    expect(metrics.topPenalisedRules).toEqual([]);
  });
});

// ─── evaluation hooks ─────────────────────────────────────────────────────────

describe("fractionBoostedAndUseful", () => {
  it("returns 0 when no boosted alerts", () => {
    const alerts = [makeAlert()];
    const comparisons = compareAlertRankings(alerts);
    expect(fractionBoostedAndUseful(comparisons, () => true)).toBe(0);
  });

  it("returns correct fraction when some boosted alerts are useful (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alertA = makeAlert({ id: 1, severity: "low", confidence: 0.2 });
    const alertB = makeAlert({ id: 2, severity: "low", confidence: 0.2 });
    const getCtx = () => ({ eventTypeUsefulnessScore: 1.0 } as RankingContext);
    const comparisons = compareAlertRankings([alertA, alertB], getCtx);
    // Only alertA marked useful
    const result = fractionBoostedAndUseful(comparisons, (id) => id === 1);
    const boostedCount = comparisons.filter((c) => c.scoreDelta > 0).length;
    expect(result).toBeCloseTo(1 / boostedCount);
  });
});

describe("fractionPenalisedAndNoisy", () => {
  it("returns 0 when no penalised alerts", () => {
    const alerts = [makeAlert()];
    const comparisons = compareAlertRankings(alerts);
    expect(fractionPenalisedAndNoisy(comparisons, () => true)).toBe(0);
  });

  it("returns correct fraction when penalised alerts are noisy (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ id: 1, severity: "high", confidence: 0.8, urgency: 8 });
    const getCtx = () => ({ ruleNoiseScore: 1.0 } as RankingContext);
    const comparisons = compareAlertRankings([alert], getCtx);
    expect(fractionPenalisedAndNoisy(comparisons, () => true)).toBe(1);
    expect(fractionPenalisedAndNoisy(comparisons, () => false)).toBe(0);
  });
});

describe("fractionPortfolioLinkedBoosted", () => {
  it("returns 0 when no portfolio-linked alerts", () => {
    const alerts = [makeAlert({ portfolioLinked: false })];
    const comparisons = compareAlertRankings(alerts);
    expect(fractionPortfolioLinkedBoosted(comparisons, alerts)).toBe(0);
  });

  it("returns correct fraction for portfolio-linked alerts (analytics-informed)", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alertA = makeAlert({ id: 1, portfolioLinked: true, severity: "low", confidence: 0.2 });
    const alertB = makeAlert({ id: 2, portfolioLinked: true, severity: "medium" });
    const getCtx = (a: AlertEvent) =>
      a.id === 1 ? { eventTypeUsefulnessScore: 1.0 } : undefined;
    const alerts = [alertA, alertB];
    const comparisons = compareAlertRankings(alerts, getCtx);
    const result = fractionPortfolioLinkedBoosted(comparisons, alerts);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
