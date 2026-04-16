/**
 * lib/snapshotComparison.ts
 *
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 * Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Pure utilities for comparing two ranking evaluation snapshots.
 *
 * Use cases:
 * - Same time window, different model versions (did the new model improve things?)
 * - Side-by-side display on the /ranking-eval calibration page
 *
 * Phase 13 enhancements:
 * - Threshold-based judgment: tiny changes (< MEANINGFUL_SIGNAL_DELTA) stay "unchanged"
 * - Explicit vote counts: at least 2-of-3 signal metrics must improve for "improved"
 * - `explanations` array: human-readable reasons for the overall assessment label
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
  /**
   * Human-readable sentences explaining why this assessment was assigned.
   * Always contains at least one entry.
   */
  explanations: string[];
}

// ─── config ───────────────────────────────────────────────────────────────────

/** Minimum absolute delta to be considered a meaningful change (not "unchanged"). */
const MEANINGFUL_DELTA = 0.01;

/**
 * Minimum absolute delta for a signal metric to "vote" as improved/worsened.
 * Changes smaller than this threshold are treated as noise and count as unchanged
 * even when technically non-zero.  This is larger than MEANINGFUL_DELTA to ensure
 * small rounding fluctuations don't shift the overall assessment.
 */
const MEANINGFUL_SIGNAL_DELTA = 0.02;

/** Minimum number of signal metrics that must agree for a definitive "improved" / "worsened" verdict. */
const SIGNAL_MAJORITY = 2;

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

/**
 * Direction for signal-metric voting.
 *
 * Uses a higher threshold (MEANINGFUL_SIGNAL_DELTA) than directionFor so that
 * tiny fluctuations don't shift the majority vote.
 */
function signalDirectionFor(delta: number): MetricDirection {
  if (Math.abs(delta) < MEANINGFUL_SIGNAL_DELTA) return "unchanged";
  return delta > 0 ? "improved" : "worsened";
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

// ─── explanation builder ──────────────────────────────────────────────────────

function buildExplanations(
  signalDeltas: SnapshotComparison["signalDeltas"],
  overallAssessment: SnapshotComparison["overallAssessment"],
): string[] {
  const explanations: string[] = [];

  const { usefulFeedbackRateAmongBoosted, noiseRateAmongPenalised, investigateRateAmongPortfolioLinkedBoosted } =
    signalDeltas;

  const signalVotes = [
    usefulFeedbackRateAmongBoosted,
    noiseRateAmongPenalised,
    investigateRateAmongPortfolioLinkedBoosted,
  ].map((d) => signalDirectionFor(d.delta));

  const improvedCount = signalVotes.filter((v) => v === "improved").length;
  const worsenedCount = signalVotes.filter((v) => v === "worsened").length;
  const unchangedCount = signalVotes.filter((v) => v === "unchanged").length;

  if (overallAssessment === "unchanged") {
    if (unchangedCount === 3) {
      explanations.push("All three signal metrics changed by less than 2 pp — assessment unchanged, no meaningful shift detected.");
    } else {
      explanations.push("Signal metrics did not show a clear majority direction — assessment unchanged.");
    }
  } else if (overallAssessment === "improved") {
    explanations.push(
      `${improvedCount} of 3 signal metrics improved by at least 2 pp, meeting the threshold for a confident "improved" verdict.`,
    );
  } else if (overallAssessment === "worsened") {
    explanations.push(
      `${worsenedCount} of 3 signal metrics worsened by at least 2 pp, meeting the threshold for a confident "worsened" verdict.`,
    );
  } else {
    // mixed
    if (improvedCount > 0 && worsenedCount > 0) {
      explanations.push(
        `${improvedCount} signal metric${improvedCount > 1 ? "s" : ""} improved and ${worsenedCount} worsened — changes are mixed.`,
      );
    } else {
      explanations.push("Signal metrics show mixed or inconclusive movement.");
    }
  }

  // Metric-specific notes
  const ufr = usefulFeedbackRateAmongBoosted;
  if (Math.abs(ufr.delta) >= MEANINGFUL_SIGNAL_DELTA) {
    const dir = ufr.delta > 0 ? "↑ improved" : "↓ worsened";
    explanations.push(
      `Useful feedback rate (boosted): ${pctStr(ufr.baselineValue)} → ${pctStr(ufr.currentValue)} (${dir} by ${pctStr(Math.abs(ufr.delta))}).`,
    );
  }

  const nrp = noiseRateAmongPenalised;
  if (Math.abs(nrp.delta) >= MEANINGFUL_SIGNAL_DELTA) {
    const dir = nrp.delta > 0 ? "↑ improved" : "↓ worsened";
    explanations.push(
      `Noise rate (penalised): ${pctStr(nrp.baselineValue)} → ${pctStr(nrp.currentValue)} (${dir} by ${pctStr(Math.abs(nrp.delta))}).`,
    );
  }

  const ir = investigateRateAmongPortfolioLinkedBoosted;
  if (Math.abs(ir.delta) >= MEANINGFUL_SIGNAL_DELTA) {
    const dir = ir.delta > 0 ? "↑ improved" : "↓ worsened";
    explanations.push(
      `Investigate rate (portfolio-linked, boosted): ${pctStr(ir.baselineValue)} → ${pctStr(ir.currentValue)} (${dir} by ${pctStr(Math.abs(ir.delta))}).`,
    );
  }

  return explanations;
}

function pctStr(n: number): string {
  return `${Math.round(n * 100)}%`;
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

  // Vote using MEANINGFUL_SIGNAL_DELTA threshold (stricter than display threshold)
  const signalVotes = [
    signalDirectionFor(signalDeltas.usefulFeedbackRateAmongBoosted.delta),
    signalDirectionFor(signalDeltas.noiseRateAmongPenalised.delta),
    signalDirectionFor(signalDeltas.investigateRateAmongPortfolioLinkedBoosted.delta),
  ];

  const improved = signalVotes.filter((v) => v === "improved").length;
  const worsened = signalVotes.filter((v) => v === "worsened").length;
  const unchanged = signalVotes.filter((v) => v === "unchanged").length;

  let overallAssessment: SnapshotComparison["overallAssessment"];
  if (unchanged === signalVotes.length) {
    overallAssessment = "unchanged";
  } else if (improved >= SIGNAL_MAJORITY && worsened === 0) {
    overallAssessment = "improved";
  } else if (worsened >= SIGNAL_MAJORITY && improved === 0) {
    overallAssessment = "worsened";
  } else if (improved > 0 && worsened === 0) {
    // Minority improvement, no worsening → "improved" (e.g. 1-of-3 improved, 2 unchanged)
    overallAssessment = "improved";
  } else if (worsened > 0 && improved === 0) {
    overallAssessment = "worsened";
  } else {
    overallAssessment = "mixed";
  }

  const explanations = buildExplanations(signalDeltas, overallAssessment);

  return {
    baselineModelVersion,
    currentModelVersion,
    timeWindow,
    deltas,
    signalDeltas,
    overallAssessment,
    explanations,
  };
}
