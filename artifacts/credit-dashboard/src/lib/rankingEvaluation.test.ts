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
  filterAlertsByTimeWindow,
  computeWindowedMetrics,
  computeTrendMetrics,
  computeMultiWindowTrends,
  type TimeWindow,
  TIME_WINDOW_LABELS,
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

// ─── TIME_WINDOW_LABELS ───────────────────────────────────────────────────────

describe("TIME_WINDOW_LABELS", () => {
  it("has labels for all three windows", () => {
    const windows: TimeWindow[] = ["7d", "30d", "all"];
    for (const w of windows) {
      expect(typeof TIME_WINDOW_LABELS[w]).toBe("string");
      expect(TIME_WINDOW_LABELS[w].length).toBeGreaterThan(0);
    }
  });
});

// ─── filterAlertsByTimeWindow ─────────────────────────────────────────────────

describe("filterAlertsByTimeWindow", () => {
  const now = new Date("2024-03-15T12:00:00Z");

  const alertRecent3d = makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T10:00:00Z").toISOString() });
  const alertRecent10d = makeAlert({ id: 2, triggeredAt: new Date("2024-03-05T10:00:00Z").toISOString() });
  const alertOld60d = makeAlert({ id: 3, triggeredAt: new Date("2024-01-14T10:00:00Z").toISOString() });
  const alertNoTimestamp = makeAlert({ id: 4, triggeredAt: undefined as unknown as string });

  it("'all' returns all alerts including those without timestamps", () => {
    const result = filterAlertsByTimeWindow(
      [alertRecent3d, alertRecent10d, alertOld60d, alertNoTimestamp],
      "all",
      now,
    );
    expect(result).toHaveLength(4);
  });

  it("'7d' returns only alerts within the last 7 days", () => {
    const result = filterAlertsByTimeWindow(
      [alertRecent3d, alertRecent10d, alertOld60d],
      "7d",
      now,
    );
    expect(result.map((a) => a.id)).toContain(1);
    expect(result.map((a) => a.id)).not.toContain(2);
    expect(result.map((a) => a.id)).not.toContain(3);
  });

  it("'30d' returns only alerts within the last 30 days", () => {
    const result = filterAlertsByTimeWindow(
      [alertRecent3d, alertRecent10d, alertOld60d],
      "30d",
      now,
    );
    expect(result.map((a) => a.id)).toContain(1);
    expect(result.map((a) => a.id)).toContain(2);
    expect(result.map((a) => a.id)).not.toContain(3);
  });

  it("'7d' excludes alerts without triggeredAt", () => {
    const result = filterAlertsByTimeWindow([alertNoTimestamp], "7d", now);
    expect(result).toHaveLength(0);
  });

  it("'30d' excludes alerts without triggeredAt", () => {
    const result = filterAlertsByTimeWindow([alertNoTimestamp], "30d", now);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no alerts match the window", () => {
    const result = filterAlertsByTimeWindow([alertOld60d], "7d", now);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterAlertsByTimeWindow([], "7d", now)).toHaveLength(0);
    expect(filterAlertsByTimeWindow([], "30d", now)).toHaveLength(0);
    expect(filterAlertsByTimeWindow([], "all", now)).toHaveLength(0);
  });

  it("alert exactly at the 7d boundary is included", () => {
    const exactBoundary = makeAlert({
      id: 10,
      triggeredAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = filterAlertsByTimeWindow([exactBoundary], "7d", now);
    expect(result).toHaveLength(1);
  });
});

// ─── computeWindowedMetrics ───────────────────────────────────────────────────

describe("computeWindowedMetrics", () => {
  const now = new Date("2024-03-15T12:00:00Z");

  it("returns zero-metrics for an empty time window", () => {
    const alert = makeAlert({
      id: 1,
      triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    });
    const metrics = computeWindowedMetrics([alert], undefined, "7d", now);
    expect(metrics.totalAlerts).toBe(0);
  });

  it("counts only alerts inside the window", () => {
    const recent = makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() });
    const old = makeAlert({ id: 2, triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString() });
    const metrics = computeWindowedMetrics([recent, old], undefined, "7d", now);
    expect(metrics.totalAlerts).toBe(1);
  });

  it("'all' window includes all alerts", () => {
    const alerts = [
      makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() }),
      makeAlert({ id: 2, triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString() }),
      makeAlert({ id: 3, triggeredAt: new Date("2023-06-01T00:00:00Z").toISOString() }),
    ];
    const metrics = computeWindowedMetrics(alerts, undefined, "all", now);
    expect(metrics.totalAlerts).toBe(3);
  });
});

// ─── computeTrendMetrics ──────────────────────────────────────────────────────

describe("computeTrendMetrics", () => {
  const now = new Date("2024-03-15T12:00:00Z");

  it("returns correct window identifier", () => {
    const result = computeTrendMetrics([], undefined, "7d", () => false, () => false, now);
    expect(result.window).toBe("7d");
  });

  it("returns zero alertCount for empty input", () => {
    const result = computeTrendMetrics([], undefined, "all", () => false, () => false, now);
    expect(result.alertCount).toBe(0);
    expect(result.usefulFeedbackRateAmongBoosted).toBe(0);
    expect(result.noiseRateAmongPenalised).toBe(0);
    expect(result.investigateRateAmongPortfolioLinkedBoosted).toBe(0);
  });

  it("alertCount reflects only alerts within the time window", () => {
    const recent = makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() });
    const old = makeAlert({ id: 2, triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString() });
    const result = computeTrendMetrics(
      [recent, old],
      undefined,
      "7d",
      () => false,
      () => false,
      now,
    );
    expect(result.alertCount).toBe(1);
  });

  it("usefulFeedbackRateAmongBoosted is 0 when no boosted alerts", () => {
    const alert = makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() });
    const result = computeTrendMetrics([alert], undefined, "7d", () => true, () => false, now);
    expect(result.usefulFeedbackRateAmongBoosted).toBe(0);
  });

  it("noiseRateAmongPenalised is 0 when no penalised alerts", () => {
    const alert = makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() });
    const result = computeTrendMetrics([alert], undefined, "7d", () => false, () => true, now);
    expect(result.noiseRateAmongPenalised).toBe(0);
  });

  it("all metric values are in [0, 1] range", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({
      id: 1,
      severity: "low",
      confidence: 0.2,
      portfolioLinked: true,
      triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString(),
    });
    const getCtx = () => ({ eventTypeUsefulnessScore: 1.0 } as RankingContext);
    const result = computeTrendMetrics([alert], getCtx, "7d", () => true, () => true, now);
    expect(result.usefulFeedbackRateAmongBoosted).toBeGreaterThanOrEqual(0);
    expect(result.usefulFeedbackRateAmongBoosted).toBeLessThanOrEqual(1);
    expect(result.noiseRateAmongPenalised).toBeGreaterThanOrEqual(0);
    expect(result.noiseRateAmongPenalised).toBeLessThanOrEqual(1);
    expect(result.investigateRateAmongPortfolioLinkedBoosted).toBeGreaterThanOrEqual(0);
    expect(result.investigateRateAmongPortfolioLinkedBoosted).toBeLessThanOrEqual(1);
  });
});

// ─── computeMultiWindowTrends ─────────────────────────────────────────────────

describe("computeMultiWindowTrends", () => {
  const now = new Date("2024-03-15T12:00:00Z");

  it("returns one result per requested window", () => {
    const windows: TimeWindow[] = ["7d", "30d", "all"];
    const results = computeMultiWindowTrends([], undefined, windows, () => false, () => false, now);
    expect(results).toHaveLength(3);
    expect(results[0].window).toBe("7d");
    expect(results[1].window).toBe("30d");
    expect(results[2].window).toBe("all");
  });

  it("7d result has fewer or equal alerts than 30d result", () => {
    const alerts = [
      makeAlert({ id: 1, triggeredAt: new Date("2024-03-13T00:00:00Z").toISOString() }),
      makeAlert({ id: 2, triggeredAt: new Date("2024-02-20T00:00:00Z").toISOString() }),
      makeAlert({ id: 3, triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString() }),
    ];
    const [w7, w30] = computeMultiWindowTrends(
      alerts,
      undefined,
      ["7d", "30d"],
      () => false,
      () => false,
      now,
    );
    expect(w7.alertCount).toBeLessThanOrEqual(w30.alertCount);
  });

  it("returns empty array for empty windows list", () => {
    const results = computeMultiWindowTrends([], undefined, [], () => false, () => false, now);
    expect(results).toHaveLength(0);
  });
});
