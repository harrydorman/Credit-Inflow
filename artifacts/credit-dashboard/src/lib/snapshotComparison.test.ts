/**
 * Tests for lib/snapshotComparison.ts (Phase 12 + Phase 13).
 *
 * Phase 13 additions:
 * - Threshold-based judgment (MEANINGFUL_SIGNAL_DELTA = 0.02)
 * - 2-of-3 majority vote
 * - explanations array
 */

import { describe, it, expect } from "vitest";
import { compareSnapshots } from "./snapshotComparison";
import type { RankingSnapshotMetrics } from "./snapshotTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: RankingSnapshotMetrics = {
  totalAlerts: 100,
  adjustedFraction: 0.3,
  averagePositiveAdjustment: 4.0,
  averageNegativeAdjustment: -2.5,
  usefulFeedbackRateAmongBoosted: 0.6,
  noiseRateAmongPenalised: 0.5,
  investigateRateAmongPortfolioLinkedBoosted: 0.4,
  topBoostedEventTypes: [],
  topPenalisedRules: [],
};

function withSignals(
  useful: number,
  noise: number,
  investigate: number,
): RankingSnapshotMetrics {
  return {
    ...BASE,
    usefulFeedbackRateAmongBoosted: useful,
    noiseRateAmongPenalised: noise,
    investigateRateAmongPortfolioLinkedBoosted: investigate,
  };
}

// ---------------------------------------------------------------------------
// Overall assessment — Phase 13 threshold logic
// ---------------------------------------------------------------------------

describe("compareSnapshots — overallAssessment (Phase 13 thresholds)", () => {
  it("is 'unchanged' when all signal deltas are below threshold (< 0.02)", () => {
    const current = withSignals(0.609, 0.509, 0.409); // tiny changes < 0.02
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("unchanged");
  });

  it("is 'unchanged' when all signals are identical", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("unchanged");
  });

  it("is 'improved' when all 3 signal metrics improve by ≥ 0.02", () => {
    const current = withSignals(0.65, 0.55, 0.45);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("improved");
  });

  it("is 'improved' when exactly 2 of 3 signal metrics improve meaningfully", () => {
    // 2 improve, 1 unchanged (delta = 0)
    const current = withSignals(0.65, 0.55, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("improved");
  });

  it("is 'worsened' when all 3 signal metrics worsen by ≥ 0.02", () => {
    const current = withSignals(0.55, 0.45, 0.35);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("worsened");
  });

  it("is 'worsened' when exactly 2 of 3 signal metrics worsen meaningfully", () => {
    // 2 worsen, 1 unchanged
    const current = withSignals(0.55, 0.45, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("worsened");
  });

  it("is 'mixed' when 1 improves and 1 worsens", () => {
    // useful: +0.05 (improved), noise: -0.05 (worsened), investigate unchanged
    const current = withSignals(0.65, 0.45, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("mixed");
  });

  it("is 'improved' when only 1 signal improves and none worsen", () => {
    // 1 improve, 2 unchanged
    const current = withSignals(0.65, 0.5, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("improved");
  });

  it("is 'worsened' when only 1 signal worsens and none improve", () => {
    // 1 worsen, 2 unchanged
    const current = withSignals(0.55, 0.5, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.overallAssessment).toBe("worsened");
  });
});

// ---------------------------------------------------------------------------
// explanations array — Phase 13
// ---------------------------------------------------------------------------

describe("compareSnapshots — explanations (Phase 13)", () => {
  it("returns at least one explanation", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.1.0", "all");
    expect(result.explanations.length).toBeGreaterThan(0);
  });

  it("mentions 'unchanged' in explanation when assessment is unchanged", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.1.0", "all");
    expect(result.explanations.some((e) => /unchanged/i.test(e))).toBe(true);
  });

  it("mentions 'improved' in explanation when assessment is improved", () => {
    const current = withSignals(0.65, 0.55, 0.45);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.explanations.some((e) => /improved/i.test(e))).toBe(true);
  });

  it("mentions 'worsened' in explanation when assessment is worsened", () => {
    const current = withSignals(0.55, 0.45, 0.35);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.explanations.some((e) => /worsened/i.test(e))).toBe(true);
  });

  it("mentions 'mixed' in explanation when assessment is mixed", () => {
    const current = withSignals(0.65, 0.45, 0.4);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    expect(result.explanations.some((e) => /mixed/i.test(e))).toBe(true);
  });

  it("includes metric-specific notes when changes exceed threshold", () => {
    const current = withSignals(0.7, 0.5, 0.4); // useful improved by 0.1
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");
    // Should mention the useful feedback rate metric
    expect(result.explanations.some((e) => /useful feedback/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signal deltas structure
// ---------------------------------------------------------------------------

describe("compareSnapshots — signal deltas", () => {
  it("computes correct delta values for each signal metric", () => {
    const current = withSignals(0.7, 0.6, 0.5);
    const result = compareSnapshots(BASE, current, "v1.0.0", "v1.1.0", "all");

    const ufr = result.signalDeltas.usefulFeedbackRateAmongBoosted;
    expect(ufr.baselineValue).toBeCloseTo(0.6);
    expect(ufr.currentValue).toBeCloseTo(0.7);
    expect(ufr.delta).toBeCloseTo(0.1);

    const nrp = result.signalDeltas.noiseRateAmongPenalised;
    expect(nrp.delta).toBeCloseTo(0.1);
  });

  it("exposes all three signal delta keys", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.1.0", "all");
    expect(result.signalDeltas.usefulFeedbackRateAmongBoosted).toBeTruthy();
    expect(result.signalDeltas.noiseRateAmongPenalised).toBeTruthy();
    expect(result.signalDeltas.investigateRateAmongPortfolioLinkedBoosted).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe("compareSnapshots — metadata", () => {
  it("passes through model versions and time window", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.2.0", "Last 7 days");
    expect(result.baselineModelVersion).toBe("v1.0.0");
    expect(result.currentModelVersion).toBe("v1.2.0");
    expect(result.timeWindow).toBe("Last 7 days");
  });

  it("includes deltas for all numeric metrics", () => {
    const result = compareSnapshots(BASE, BASE, "v1.0.0", "v1.1.0", "all");
    const keys = result.deltas.map((d) => d.key);
    expect(keys).toContain("totalAlerts");
    expect(keys).toContain("adjustedFraction");
    expect(keys).toContain("usefulFeedbackRateAmongBoosted");
  });
});
