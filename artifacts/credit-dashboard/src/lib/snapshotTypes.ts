/**
 * lib/snapshotTypes.ts
 *
 * Phase 12: Shared snapshot metric types used by rankingRecommendations.ts,
 * snapshotComparison.ts, and the API client hooks.
 *
 * These mirror the server-side RankingSnapshotMetrics shape (lib/db/src/schema/
 * rankingEvalSnapshots.ts) and the dashboard API client types.
 */

export interface RankingSnapshotMetrics {
  totalAlerts: number;
  adjustedFraction: number;
  averagePositiveAdjustment: number;
  averageNegativeAdjustment: number;
  usefulFeedbackRateAmongBoosted: number;
  noiseRateAmongPenalised: number;
  investigateRateAmongPortfolioLinkedBoosted: number;
  topBoostedEventTypes: { eventType: string; totalBoost: number }[];
  topPenalisedRules: { ruleName: string; totalPenalty: number }[];
}

/** A persisted ranking evaluation snapshot (as returned by the API). */
export interface RankingEvalSnapshotRecord {
  id: number;
  organizationId: string;
  rankingModelVersion: string;
  timeWindow: "7d" | "30d" | "all";
  snapshotType: "manual" | "scheduled";
  metricsJson: RankingSnapshotMetrics;
  createdAt: string;
}
