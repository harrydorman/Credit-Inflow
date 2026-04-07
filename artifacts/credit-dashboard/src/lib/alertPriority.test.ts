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
