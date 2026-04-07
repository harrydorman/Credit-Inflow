/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  getPriorityLabel,
  getPriorityExplanation,
  getAlertPriority,
  sortAlertsByPriority,
  computeAnalyticsAdjustment,
  buildAnalyticsIndex,
  buildRankingContext,
  MAX_TOTAL_ADJUSTMENT,
  RANKING_MODE,
  type RankingContext,
} from "./alertPriority";
import type { AlertEvent } from "@workspace/api-client-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
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

// ─── computePriorityScore ─────────────────────────────────────────────────────

describe("computePriorityScore", () => {
  it("returns max score for a critical alert (high severity + portfolio + high confidence + high urgency)", () => {
    const alert = makeAlert({
      severity: "high",
      portfolioLinked: true,
      confidence: 1.0,
      urgency: 10,
    });
    expect(computePriorityScore(alert)).toBe(100);
  });

  it("returns 0 for a null/missing severity, zero urgency, no portfolio, zero confidence", () => {
    const alert = makeAlert({
      severity: null,
      urgency: null,
      portfolioLinked: false,
      confidence: null,
    });
    expect(computePriorityScore(alert)).toBe(0);
  });

  it("adds portfolio bonus when portfolioLinked is true", () => {
    const base = makeAlert({ severity: null, urgency: null, confidence: null, portfolioLinked: false });
    const linked = makeAlert({ severity: null, urgency: null, confidence: null, portfolioLinked: true });
    expect(computePriorityScore(linked) - computePriorityScore(base)).toBe(20);
  });

  it("severity high contributes 40 points", () => {
    const alert = makeAlert({ severity: "high", urgency: null, confidence: null, portfolioLinked: false });
    expect(computePriorityScore(alert)).toBe(40);
  });

  it("severity medium contributes 25 points", () => {
    const alert = makeAlert({ severity: "medium", urgency: null, confidence: null, portfolioLinked: false });
    expect(computePriorityScore(alert)).toBe(25);
  });

  it("severity low contributes 10 points", () => {
    const alert = makeAlert({ severity: "low", urgency: null, confidence: null, portfolioLinked: false });
    expect(computePriorityScore(alert)).toBe(10);
  });

  it("derives severity from urgency when severity field is null", () => {
    const highUrgency = makeAlert({ severity: null, urgency: 9, confidence: null, portfolioLinked: false });
    const medUrgency = makeAlert({ severity: null, urgency: 6, confidence: null, portfolioLinked: false });
    const lowUrgency = makeAlert({ severity: null, urgency: 3, confidence: null, portfolioLinked: false });
    // Should derive high/medium/low severity
    expect(computePriorityScore(highUrgency)).toBeGreaterThan(computePriorityScore(medUrgency));
    expect(computePriorityScore(medUrgency)).toBeGreaterThan(computePriorityScore(lowUrgency));
  });

  it("confidence of 1.0 contributes 30 points", () => {
    const alert = makeAlert({ severity: null, urgency: null, confidence: 1.0, portfolioLinked: false });
    expect(computePriorityScore(alert)).toBe(30);
  });

  it("confidence of 0.5 contributes 15 points", () => {
    const alert = makeAlert({ severity: null, urgency: null, confidence: 0.5, portfolioLinked: false });
    expect(computePriorityScore(alert)).toBe(15);
  });

  it("urgency of 10 contributes 10 points via urgency component", () => {
    const alert = makeAlert({ severity: null, urgency: 10, confidence: null, portfolioLinked: false });
    // severity derived from urgency 10 = high = 40, plus urgency component = (10/10)*10 = 10
    expect(computePriorityScore(alert)).toBe(50);
  });
});

// ─── getPriorityLabel ─────────────────────────────────────────────────────────

describe("getPriorityLabel", () => {
  it("returns Critical for score >= 75", () => {
    expect(getPriorityLabel(75)).toBe("Critical");
    expect(getPriorityLabel(100)).toBe("Critical");
    expect(getPriorityLabel(80)).toBe("Critical");
  });

  it("returns High for score 50–74", () => {
    expect(getPriorityLabel(50)).toBe("High");
    expect(getPriorityLabel(74)).toBe("High");
    expect(getPriorityLabel(60)).toBe("High");
  });

  it("returns Medium for score 25–49", () => {
    expect(getPriorityLabel(25)).toBe("Medium");
    expect(getPriorityLabel(49)).toBe("Medium");
    expect(getPriorityLabel(35)).toBe("Medium");
  });

  it("returns Low for score < 25", () => {
    expect(getPriorityLabel(0)).toBe("Low");
    expect(getPriorityLabel(24)).toBe("Low");
    expect(getPriorityLabel(10)).toBe("Low");
  });
});

// ─── getPriorityExplanation ────────────────────────────────────────────────────

describe("getPriorityExplanation", () => {
  it("includes 'high severity' for high severity alerts", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.9, portfolioLinked: false });
    expect(getPriorityExplanation(alert)).toContain("high severity");
  });

  it("includes 'portfolio exposure' when portfolioLinked is true", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.9, portfolioLinked: true });
    expect(getPriorityExplanation(alert)).toContain("portfolio exposure");
  });

  it("does NOT include 'portfolio exposure' when portfolioLinked is false", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.9, portfolioLinked: false });
    expect(getPriorityExplanation(alert)).not.toContain("portfolio exposure");
  });

  it("includes 'high confidence' when confidence >= 0.8", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.85, portfolioLinked: false });
    expect(getPriorityExplanation(alert)).toContain("high confidence");
  });

  it("includes 'moderate confidence' when confidence 0.5–0.79", () => {
    const alert = makeAlert({ severity: "medium", confidence: 0.65, portfolioLinked: false });
    expect(getPriorityExplanation(alert)).toContain("moderate confidence");
  });

  it("includes the priority label in the explanation", () => {
    const alert = makeAlert({
      severity: "high",
      confidence: 1.0,
      portfolioLinked: true,
      urgency: 10,
    });
    const explanation = getPriorityExplanation(alert);
    expect(explanation).toMatch(/Critical|High|Medium|Low/);
    expect(explanation).toContain("priority because:");
  });

  it("returns fallback message when no signal data", () => {
    const alert = makeAlert({ severity: null, urgency: null, confidence: null, portfolioLinked: false });
    expect(getPriorityExplanation(alert)).toContain("Insufficient signal");
  });
});

// ─── getAlertPriority ─────────────────────────────────────────────────────────

describe("getAlertPriority", () => {
  it("returns score, label, and explanation", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.9, portfolioLinked: true, urgency: 9 });
    const result = getAlertPriority(alert);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("explanation");
    expect(result.score).toBeGreaterThan(0);
    expect(["Critical", "High", "Medium", "Low"]).toContain(result.label);
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it("label matches score", () => {
    const alert = makeAlert({ severity: "high", confidence: 1.0, portfolioLinked: true, urgency: 10 });
    const result = getAlertPriority(alert);
    expect(result.label).toBe(getPriorityLabel(result.score));
  });
});

// ─── sortAlertsByPriority ─────────────────────────────────────────────────────

describe("sortAlertsByPriority", () => {
  it("sorts alerts from highest to lowest priority", () => {
    const low = makeAlert({ id: 1, severity: "low", confidence: 0.3, portfolioLinked: false, urgency: 1 });
    const high = makeAlert({ id: 2, severity: "high", confidence: 0.9, portfolioLinked: true, urgency: 9 });
    const med = makeAlert({ id: 3, severity: "medium", confidence: 0.5, portfolioLinked: false, urgency: 5 });

    const sorted = sortAlertsByPriority([low, high, med]);
    expect(sorted[0].id).toBe(2); // high priority first
    expect(sorted[1].id).toBe(3); // medium next
    expect(sorted[2].id).toBe(1); // low last
  });

  it("does not mutate the original array", () => {
    const alerts = [
      makeAlert({ id: 1, severity: "low" }),
      makeAlert({ id: 2, severity: "high" }),
    ];
    const original = [...alerts];
    sortAlertsByPriority(alerts);
    expect(alerts[0].id).toBe(original[0].id);
    expect(alerts[1].id).toBe(original[1].id);
  });

  it("returns empty array for empty input", () => {
    expect(sortAlertsByPriority([])).toEqual([]);
  });

  it("sorts Critical before High", () => {
    const high = makeAlert({ id: 1, severity: "high", confidence: 0.5, portfolioLinked: false, urgency: 8 });
    const critical = makeAlert({ id: 2, severity: "high", confidence: 1.0, portfolioLinked: true, urgency: 10 });
    const sorted = sortAlertsByPriority([high, critical]);
    expect(sorted[0].id).toBe(2);
  });
});

// ─── computeAnalyticsAdjustment ──────────────────────────────────────────────

describe("computeAnalyticsAdjustment", () => {
  it("returns delta 0 and no reasons when context is empty", () => {
    const { delta, reasons } = computeAnalyticsAdjustment({});
    expect(delta).toBe(0);
    expect(reasons).toHaveLength(0);
  });

  it("returns delta 0 when scores are all below their thresholds", () => {
    const ctx: RankingContext = {
      eventTypeUsefulnessScore: 0.5,   // threshold is 0.7
      issuerInvestigateScore: 0.4,     // threshold is 0.6
      ruleNoiseScore: 0.3,             // threshold is 0.5
    };
    const { delta } = computeAnalyticsAdjustment(ctx);
    expect(delta).toBe(0);
  });

  it("boosts when event type usefulness >= 0.7", () => {
    const { delta, reasons } = computeAnalyticsAdjustment({ eventTypeUsefulnessScore: 1.0 });
    expect(delta).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes("event type is historically useful"))).toBe(true);
  });

  it("event type boost is 0 at threshold (0.7) and max (8) at score 1.0", () => {
    const atThreshold = computeAnalyticsAdjustment({ eventTypeUsefulnessScore: 0.7 });
    expect(atThreshold.delta).toBe(0);

    const atMax = computeAnalyticsAdjustment({ eventTypeUsefulnessScore: 1.0 });
    expect(atMax.delta).toBe(8);
  });

  it("boosts when issuer investigate score >= 0.6", () => {
    const { delta, reasons } = computeAnalyticsAdjustment({ issuerInvestigateScore: 1.0 });
    expect(delta).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes("issuer often requires investigation"))).toBe(true);
  });

  it("issuer boost is 0 at threshold (0.6) and max (8) at score 1.0", () => {
    const atThreshold = computeAnalyticsAdjustment({ issuerInvestigateScore: 0.6 });
    expect(atThreshold.delta).toBe(0);

    const atMax = computeAnalyticsAdjustment({ issuerInvestigateScore: 1.0 });
    expect(atMax.delta).toBe(8);
  });

  it("applies noise penalty when rule noise score >= 0.5", () => {
    const { delta, reasons } = computeAnalyticsAdjustment({ ruleNoiseScore: 1.0 });
    expect(delta).toBeLessThan(0);
    expect(reasons.some((r) => r.includes("high noise ratio"))).toBe(true);
  });

  it("noise penalty is 0 at threshold (0.5) and max (-8) at score 1.0", () => {
    const atThreshold = computeAnalyticsAdjustment({ ruleNoiseScore: 0.5 });
    expect(atThreshold.delta).toBe(0);

    const atMax = computeAnalyticsAdjustment({ ruleNoiseScore: 1.0 });
    expect(atMax.delta).toBe(-8);
  });

  it(`caps total adjustment at ±${MAX_TOTAL_ADJUSTMENT}`, () => {
    // max possible uncapped boost = 8 (ET) + 8 (issuer) = 16 → capped to 15
    const { delta } = computeAnalyticsAdjustment({
      eventTypeUsefulnessScore: 1.0,
      issuerInvestigateScore: 1.0,
    });
    expect(delta).toBe(MAX_TOTAL_ADJUSTMENT);
  });

  it("cap prevents penalty from exceeding -MAX_TOTAL_ADJUSTMENT", () => {
    // Only noise can go up to -8, which is within cap of -15
    const { delta } = computeAnalyticsAdjustment({ ruleNoiseScore: 1.0 });
    expect(delta).toBeGreaterThanOrEqual(-MAX_TOTAL_ADJUSTMENT);
  });

  it("net adjustment when boosts and penalties partially cancel", () => {
    // boost: ET=8, penalty: noise=8 → net=0
    const { delta } = computeAnalyticsAdjustment({
      eventTypeUsefulnessScore: 1.0,
      ruleNoiseScore: 1.0,
    });
    expect(delta).toBe(0);
  });
});

// ─── computePriorityScore with analytics context ─────────────────────────────

describe("computePriorityScore with RankingContext", () => {
  it("baseline mode: ignores context when RANKING_MODE is baseline", () => {
    // RANKING_MODE is a const; we test by verifying that without ctx score is same
    const alert = makeAlert({ severity: "medium", confidence: 0.5, urgency: 5 });
    const base = computePriorityScore(alert);
    // With analytics ctx that would boost, result should differ (or equal if mode is baseline)
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    const withCtx = computePriorityScore(alert, ctx);
    if (RANKING_MODE === "baseline") {
      expect(withCtx).toBe(base);
    } else {
      expect(withCtx).toBeGreaterThan(base);
    }
  });

  it("analytics-informed mode: boost increases score", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "low", confidence: 0.3, urgency: 2, portfolioLinked: false });
    const base = computePriorityScore(alert);
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    expect(computePriorityScore(alert, ctx)).toBeGreaterThan(base);
  });

  it("analytics-informed mode: noise penalty decreases score", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "high", confidence: 0.8, urgency: 8, portfolioLinked: false });
    const base = computePriorityScore(alert);
    const ctx: RankingContext = { ruleNoiseScore: 1.0 };
    expect(computePriorityScore(alert, ctx)).toBeLessThan(base);
  });

  it("adjusted score stays within [0, 100]", () => {
    const alert = makeAlert({ severity: "high", confidence: 1.0, urgency: 10, portfolioLinked: true });
    // Already at 100; boost should not go above 100
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0, issuerInvestigateScore: 1.0 };
    expect(computePriorityScore(alert, ctx)).toBeLessThanOrEqual(100);

    const zeroAlert = makeAlert({ severity: null, urgency: null, confidence: null, portfolioLinked: false });
    const penaltyCtx: RankingContext = { ruleNoiseScore: 1.0 };
    expect(computePriorityScore(zeroAlert, penaltyCtx)).toBeGreaterThanOrEqual(0);
  });
});

// ─── getPriorityExplanation with analytics context ────────────────────────────

describe("getPriorityExplanation with RankingContext", () => {
  it("includes event type boost reason when analytics-informed and score qualifies", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "medium", confidence: 0.5 });
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    const explanation = getPriorityExplanation(alert, ctx);
    expect(explanation).toContain("event type is historically useful");
  });

  it("includes issuer investigate boost reason when analytics-informed and score qualifies", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "medium", confidence: 0.5 });
    const ctx: RankingContext = { issuerInvestigateScore: 1.0 };
    const explanation = getPriorityExplanation(alert, ctx);
    expect(explanation).toContain("issuer often requires investigation");
  });

  it("includes noise penalty reason when analytics-informed and score qualifies", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "high", confidence: 0.8 });
    const ctx: RankingContext = { ruleNoiseScore: 1.0 };
    const explanation = getPriorityExplanation(alert, ctx);
    expect(explanation).toContain("high noise ratio");
  });

  it("does not include analytics reasons when context is missing", () => {
    const alert = makeAlert({ severity: "high", confidence: 0.8 });
    const explanation = getPriorityExplanation(alert);
    expect(explanation).not.toContain("historically useful");
    expect(explanation).not.toContain("noise ratio");
    expect(explanation).not.toContain("investigation");
  });
});

// ─── getAlertPriority – analyticsAdjusted flag ───────────────────────────────

describe("getAlertPriority analyticsAdjusted flag", () => {
  it("is false when no context is provided", () => {
    const alert = makeAlert({ severity: "high" });
    expect(getAlertPriority(alert).analyticsAdjusted).toBeFalsy();
  });

  it("is false when context causes zero adjustment", () => {
    const alert = makeAlert({ severity: "high" });
    const ctx: RankingContext = { eventTypeUsefulnessScore: 0.0 };
    expect(getAlertPriority(alert, ctx).analyticsAdjusted).toBeFalsy();
  });

  it("is true when context causes a nonzero adjustment in analytics-informed mode", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    const alert = makeAlert({ severity: "high" });
    const ctx: RankingContext = { eventTypeUsefulnessScore: 1.0 };
    expect(getAlertPriority(alert, ctx).analyticsAdjusted).toBe(true);
  });
});

// ─── sortAlertsByPriority with getCtx ────────────────────────────────────────

describe("sortAlertsByPriority with getCtx", () => {
  it("analytics boost can change sort order relative to baseline", () => {
    if (RANKING_MODE !== "analytics-informed") return;
    // alert A: base score moderate; event type is very useful → gets boosted
    const alertA = makeAlert({ id: 1, severity: "medium", confidence: 0.5, urgency: 5, eventType: "downgrade" });
    // alert B: base score slightly higher; event type has no usefulness data
    const alertB = makeAlert({ id: 2, severity: "medium", confidence: 0.7, urgency: 5, eventType: "other" });

    // Without analytics, B scores higher (more confidence)
    const baselineSorted = sortAlertsByPriority([alertA, alertB]);
    expect(baselineSorted[0].id).toBe(2);

    // With analytics: A's event type is very useful → boosted above B
    const getCtx = (a: AlertEvent) =>
      a.eventType === "downgrade" ? { eventTypeUsefulnessScore: 1.0 } : {};
    const analyticsSorted = sortAlertsByPriority([alertA, alertB], getCtx);
    expect(analyticsSorted[0].id).toBe(1);
  });

  it("baseline sort order is unchanged without getCtx", () => {
    const low = makeAlert({ id: 1, severity: "low", confidence: 0.1 });
    const high = makeAlert({ id: 2, severity: "high", confidence: 0.9 });
    const sorted = sortAlertsByPriority([low, high]);
    expect(sorted[0].id).toBe(2);
  });
});

// ─── buildAnalyticsIndex and buildRankingContext ──────────────────────────────

describe("buildAnalyticsIndex", () => {
  it("builds maps from rankingPrep", () => {
    const index = buildAnalyticsIndex({
      eventTypeUsefulnessScores: [{ eventType: "downgrade", usefulnessScore: 0.9 }],
      issuerInvestigateScores: [{ issuerName: "Acme", investigateScore: 0.75 }],
      ruleNoiseScores: [{ ruleName: "Rule1", noiseScore: 0.6 }],
    });
    expect(index.eventTypeUsefulness.get("downgrade")).toBe(0.9);
    expect(index.issuerInvestigate.get("Acme")).toBe(0.75);
    expect(index.ruleNoise.get("Rule1")).toBe(0.6);
  });

  it("returns undefined for unknown keys", () => {
    const index = buildAnalyticsIndex({
      eventTypeUsefulnessScores: [],
      issuerInvestigateScores: [],
      ruleNoiseScores: [],
    });
    expect(index.eventTypeUsefulness.get("unknown")).toBeUndefined();
  });
});

describe("buildRankingContext", () => {
  it("looks up eventType, issuerName, and ruleName from index", () => {
    const index = buildAnalyticsIndex({
      eventTypeUsefulnessScores: [{ eventType: "downgrade", usefulnessScore: 0.85 }],
      issuerInvestigateScores: [{ issuerName: "Acme Corp", investigateScore: 0.7 }],
      ruleNoiseScores: [{ ruleName: "WatchlistRule", noiseScore: 0.55 }],
    });
    const alert = makeAlert({
      eventType: "downgrade",
      issuerName: "Acme Corp",
    }) as AlertEvent & { ruleName?: string };
    alert.ruleName = "WatchlistRule";
    const ctx = buildRankingContext(alert, index);
    expect(ctx.eventTypeUsefulnessScore).toBe(0.85);
    expect(ctx.issuerInvestigateScore).toBe(0.7);
    expect(ctx.ruleNoiseScore).toBe(0.55);
  });

  it("returns undefined scores for missing keys", () => {
    const index = buildAnalyticsIndex({
      eventTypeUsefulnessScores: [],
      issuerInvestigateScores: [],
      ruleNoiseScores: [],
    });
    const alert = makeAlert({ eventType: "downgrade", issuerName: "Unknown" });
    const ctx = buildRankingContext(alert, index);
    expect(ctx.eventTypeUsefulnessScore).toBeUndefined();
    expect(ctx.issuerInvestigateScore).toBeUndefined();
    expect(ctx.ruleNoiseScore).toBeUndefined();
  });
});
