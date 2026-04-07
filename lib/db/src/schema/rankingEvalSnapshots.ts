/**
 * schema/rankingEvalSnapshots.ts
 *
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 *
 * Persists summarised ranking evaluation metrics per org, model version, and
 * time window.  Snapshots are immutable once written — create a new row rather
 * than updating an existing one.
 */

import { pgTable, serial, uuid, text, json, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./tenants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotTimeWindow = "7d" | "30d" | "all";
export type SnapshotType = "manual" | "scheduled";

/**
 * Shape of the `metricsJson` column.
 *
 * Stores a compact summary of the ranking evaluation for a given model version
 * and time window.  All numeric fields are rounded to 4 decimal places before
 * storage to keep the JSON diff-friendly.
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

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const rankingEvalSnapshotsTable = pgTable(
  "ranking_eval_snapshots",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** The model version active when this snapshot was taken. */
    rankingModelVersion: text("ranking_model_version").notNull(),
    /** The time window over which metrics were computed. */
    timeWindow: text("time_window").$type<SnapshotTimeWindow>().notNull(),
    /** Whether the snapshot was created manually or by a scheduled job. */
    snapshotType: text("snapshot_type").$type<SnapshotType>().notNull().default("manual"),
    /** Summarised ranking metrics (see RankingSnapshotMetrics). */
    metricsJson: json("metrics_json").$type<RankingSnapshotMetrics>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ranking_eval_snapshots_org_idx").on(t.organizationId),
    index("ranking_eval_snapshots_org_version_idx").on(t.organizationId, t.rankingModelVersion),
    index("ranking_eval_snapshots_org_window_idx").on(t.organizationId, t.timeWindow),
  ],
);

export type RankingEvalSnapshot = typeof rankingEvalSnapshotsTable.$inferSelect;
export type NewRankingEvalSnapshot = typeof rankingEvalSnapshotsTable.$inferInsert;
