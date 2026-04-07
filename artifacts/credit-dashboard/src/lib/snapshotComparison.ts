/**
 * lib/snapshotComparison.ts
 *
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 *
 * Pure utilities for comparing two ranking evaluation snapshots.
 *
 * Use cases:
 * - Same time window, different model versions (did the new model improve things?)
 * - Side-by-side display on the /ranking-eval calibration page
 */

import type { RankingSnapshotMetrics } from "./snapshotTypes";

// Re-export the type so callers can import from one place.
export type { RankingSnapshotMetrics };

// ─── types ────────────────────────────────────────────────────────────────────

/** Direction of change for a single metric delta. */
export type MetricDirection = "improved" | "worsened" | "unchanged";

/** Delta for a single numeric metric. */
export interface MetricDelta {
  key: keyof RankingSnapshotMetrics;
  label: string;
  baselineValue: number;
  currentValue: number;
  /** currentValue - baselineValue */
  delta: number;
  /**
   * Whether the change is an improvement, worsening, or negligible.
   * Higher is better for: usefulFeedbackRateAmongBoosted, noiseRateAmongPenalised,
   *   investigateRateAmongPortfolioLinkedBoosted.
   * Lower is not necessarily worse for others (contextual).
   */
  direction: MetricDirection;
}

/** Full comparison result between two snapshots (or a snapshot and current metrics). */
export interface SnapshotComparison {
  baselineModelVersion: string;
  currentModelVersion: string;
  timeWindow: string;
  deltas: MetricDelta[];
  /** Subset: the three primary signal metrics */
  signalDeltas: {
    usefulFeedbackRateAmongBoosted: MetricDelta;
    noiseRateAmongPenalised: MetricDelta;
    investigateRateAmongPortfolioLinkedBoosted: MetricDelta;
  };
  /** Overall assessment based on the three signal metrics */
  overallAssessment: "improved" | "mixed" | "worsened" | "unchanged";
}

// ─── config ───────────────────────────────────────────────────────────────────

/** Minimum absolute delta to be considered a meaningful change (not "unchanged"). */
const MEANINGFUL_DELTA = 0.01;

/**
 * Metrics where higher = better (positive delta = improvement).
 */
const HIGHER_IS_BETTER = new Set<keyof RankingSnapshotMetrics>([
  "usefulFeedbackRateAmongBoosted",
  "noiseRateAmongPenalised",
  "investigateRateAmongPortfolioLinkedBoosted",
]);

/**
 * Metrics where lower is better for the analysis (only used when labelled below).
 */
const LOWER_IS_BETTER = new Set<keyof RankingSnapshotMetrics>([
  "averageNegativeAdjustment",
]);

const METRIC_LABELS: Partial<Record<keyof RankingSnapshotMetrics, string>> = {
  totalAlerts: "Total alerts",
  adjustedFraction: "Adjusted fraction",
  averagePositiveAdjustment: "Avg. positive adjustment",
  averageNegativeAdjustment: "Avg. negative adjustment",
  usefulFeedbackRateAmongBoosted: "Useful feedback rate (boosted)",
  noiseRateAmongPenalised: "Noise rate (penalised)",
  investigateRateAmongPortfolioLinkedBoosted: "Investigate rate (portfolio-linked, boosted)",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function directionFor(key: keyof RankingSnapshotMetrics, delta: number): MetricDirection {
  if (Math.abs(delta) < MEANINGFUL_DELTA) return "unchanged";
  if (HIGHER_IS_BETTER.has(key)) return delta > 0 ? "improved" : "worsened";
  if (LOWER_IS_BETTER.has(key)) return delta < 0 ? "improved" : "worsened";
  return "unchanged"; // no directional opinion for non-signal metrics
}

function makeDelta(
  key: keyof RankingSnapshotMetrics,
  baseline: number,
  current: number,
): MetricDelta {
  const delta = current - baseline;
  return {
    key,
    label: METRIC_LABELS[key] ?? String(key),
    baselineValue: baseline,
    currentValue: current,
    delta,
    direction: directionFor(key, delta),
  };
}

// ─── main comparison function ─────────────────────────────────────────────────

/**
 * Compare two sets of ranking snapshot metrics.
 *
 * @param baseline              Metrics from the earlier / reference snapshot.
 * @param current               Metrics from the newer / active evaluation.
 * @param baselineModelVersion  Model version label for the baseline.
 * @param currentModelVersion   Model version label for the current metrics.
 * @param timeWindow            The time window both snapshots share.
 */
export function compareSnapshots(
  baseline: RankingSnapshotMetrics,
  current: RankingSnapshotMetrics,
  baselineModelVersion: string,
  currentModelVersion: string,
  timeWindow: string,
): SnapshotComparison {
  const numericKeys: (keyof RankingSnapshotMetrics)[] = [
    "totalAlerts",
    "adjustedFraction",
    "averagePositiveAdjustment",
    "averageNegativeAdjustment",
    "usefulFeedbackRateAmongBoosted",
    "noiseRateAmongPenalised",
    "investigateRateAmongPortfolioLinkedBoosted",
  ];

  const deltas = numericKeys.map((k) =>
    makeDelta(k, baseline[k] as number, current[k] as number),
  );

  const signalDeltas = {
    usefulFeedbackRateAmongBoosted: makeDelta(
      "usefulFeedbackRateAmongBoosted",
      baseline.usefulFeedbackRateAmongBoosted,
      current.usefulFeedbackRateAmongBoosted,
    ),
    noiseRateAmongPenalised: makeDelta(
      "noiseRateAmongPenalised",
      baseline.noiseRateAmongPenalised,
      current.noiseRateAmongPenalised,
    ),
    investigateRateAmongPortfolioLinkedBoosted: makeDelta(
      "investigateRateAmongPortfolioLinkedBoosted",
      baseline.investigateRateAmongPortfolioLinkedBoosted,
      current.investigateRateAmongPortfolioLinkedBoosted,
    ),
  };

  const signalDirections = Object.values(signalDeltas).map((d) => d.direction);
  const improved = signalDirections.filter((d) => d === "improved").length;
  const worsened = signalDirections.filter((d) => d === "worsened").length;
  const unchanged = signalDirections.filter((d) => d === "unchanged").length;

  let overallAssessment: SnapshotComparison["overallAssessment"];
  if (unchanged === signalDirections.length) {
    overallAssessment = "unchanged";
  } else if (improved > 0 && worsened === 0) {
    overallAssessment = "improved";
  } else if (worsened > 0 && improved === 0) {
    overallAssessment = "worsened";
  } else {
    overallAssessment = "mixed";
  }

  return {
    baselineModelVersion,
    currentModelVersion,
    timeWindow,
    deltas,
    signalDeltas,
    overallAssessment,
  };
}
