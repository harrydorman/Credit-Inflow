/**
 * services/rankingEvalSnapshotService.ts
 *
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 *
 * Org-scoped CRUD for ranking evaluation snapshots.
 * All functions are async and accept an orgId as first argument.
 */

import { db, rankingEvalSnapshotsTable } from "@workspace/db";
import type {
  RankingEvalSnapshot,
  NewRankingEvalSnapshot,
  RankingSnapshotMetrics,
  SnapshotTimeWindow,
  SnapshotType,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Create snapshot
// ---------------------------------------------------------------------------

export interface CreateSnapshotInput {
  orgId: string;
  rankingModelVersion: string;
  timeWindow: SnapshotTimeWindow;
  snapshotType?: SnapshotType;
  metrics: RankingSnapshotMetrics;
}

/**
 * Persist a ranking evaluation snapshot for the given org.
 * Returns the newly-created snapshot row.
 */
export async function createRankingEvalSnapshot(
  input: CreateSnapshotInput,
): Promise<RankingEvalSnapshot> {
  const row: NewRankingEvalSnapshot = {
    organizationId: input.orgId,
    rankingModelVersion: input.rankingModelVersion,
    timeWindow: input.timeWindow,
    snapshotType: input.snapshotType ?? "manual",
    metricsJson: input.metrics,
  };

  const [inserted] = await db
    .insert(rankingEvalSnapshotsTable)
    .values(row)
    .returning();

  return inserted;
}

// ---------------------------------------------------------------------------
// List snapshots
// ---------------------------------------------------------------------------

export interface ListSnapshotsOptions {
  /** Only return snapshots for this time window. */
  timeWindow?: SnapshotTimeWindow;
  /** Only return snapshots for this model version. */
  rankingModelVersion?: string;
  /** Maximum number of rows to return (default 20). */
  limit?: number;
}

/**
 * List recent ranking evaluation snapshots for the given org, newest first.
 */
export async function listRankingEvalSnapshots(
  orgId: string,
  opts: ListSnapshotsOptions = {},
): Promise<RankingEvalSnapshot[]> {
  const limit = opts.limit ?? 20;

  const conditions = [eq(rankingEvalSnapshotsTable.organizationId, orgId)];

  if (opts.timeWindow) {
    conditions.push(eq(rankingEvalSnapshotsTable.timeWindow, opts.timeWindow));
  }
  if (opts.rankingModelVersion) {
    conditions.push(eq(rankingEvalSnapshotsTable.rankingModelVersion, opts.rankingModelVersion));
  }

  return db
    .select()
    .from(rankingEvalSnapshotsTable)
    .where(and(...conditions))
    .orderBy(desc(rankingEvalSnapshotsTable.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Get most recent snapshot for a given window + org (for comparison)
// ---------------------------------------------------------------------------

/**
 * Returns the most recent snapshot for the given org and time window, or null.
 */
export async function getMostRecentSnapshot(
  orgId: string,
  timeWindow: SnapshotTimeWindow,
): Promise<RankingEvalSnapshot | null> {
  const rows = await db
    .select()
    .from(rankingEvalSnapshotsTable)
    .where(
      and(
        eq(rankingEvalSnapshotsTable.organizationId, orgId),
        eq(rankingEvalSnapshotsTable.timeWindow, timeWindow),
      ),
    )
    .orderBy(desc(rankingEvalSnapshotsTable.createdAt))
    .limit(1);

  return rows[0] ?? null;
}
