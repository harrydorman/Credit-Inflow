import { Router, type IRouter } from "express";
import { requireOrgId } from "../middlewares/auth";
import { getAlertAnalytics } from "../services/alertAnalyticsService";
import {
  createRankingEvalSnapshot,
  computeAndCreateSnapshot,
  listRankingEvalSnapshots,
} from "../services/rankingEvalSnapshotService";
import { computeSnapshotMetrics } from "../services/snapshotMetricsService";
import { computeOutcomeAttribution } from "../services/outcomeAttributionService";
import type { SnapshotTimeWindow } from "@workspace/db";

const router: IRouter = Router();

/**
 * GET /analytics/alerts
 *
 * Returns aggregated workflow + feedback analytics for the authenticated org.
 * Org-safe: all data is scoped to the org derived from the X-Organization-Id header.
 */
router.get("/analytics/alerts", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const analytics = await getAlertAnalytics(orgId);
  res.json(analytics);
});

// ─── Ranking evaluation snapshots ─────────────────────────────────────────────

const VALID_WINDOWS: SnapshotTimeWindow[] = ["7d", "30d", "all"];

/**
 * POST /analytics/ranking-eval/snapshots
 *
 * Creates a ranking evaluation snapshot for the authenticated org.
 *
 * When `metrics` is provided, persists it as-is (caller-supplied mode).
 * When `metrics` is omitted but `timeWindow` and `rankingModelVersion` are
 * present, the server computes metrics from persisted data and saves them.
 *
 * Expected request body:
 * {
 *   rankingModelVersion: string;
 *   timeWindow: "7d" | "30d" | "all";
 *   snapshotType?: "manual" | "scheduled";
 *   metrics?: RankingSnapshotMetrics;  // omit to trigger server computation
 * }
 */
router.post("/analytics/ranking-eval/snapshots", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const { rankingModelVersion, timeWindow, snapshotType, metrics } = req.body ?? {};

  if (!rankingModelVersion || typeof rankingModelVersion !== "string") {
    res.status(400).json({ error: "rankingModelVersion is required and must be a string." });
    return;
  }
  if (!timeWindow || !VALID_WINDOWS.includes(timeWindow)) {
    res.status(400).json({ error: `timeWindow must be one of: ${VALID_WINDOWS.join(", ")}.` });
    return;
  }

  let snapshot;
  if (metrics !== undefined && metrics !== null) {
    // Caller-supplied metrics
    if (typeof metrics !== "object") {
      res.status(400).json({ error: "metrics must be an object when provided." });
      return;
    }
    snapshot = await createRankingEvalSnapshot({
      orgId,
      rankingModelVersion,
      timeWindow,
      snapshotType: snapshotType === "scheduled" ? "scheduled" : "manual",
      metrics,
    });
  } else {
    // Server-computed metrics
    snapshot = await computeAndCreateSnapshot({
      orgId,
      rankingModelVersion,
      timeWindow,
      snapshotType: snapshotType === "scheduled" ? "scheduled" : "manual",
    });
  }

  res.status(201).json(snapshot);
});

/**
 * GET /analytics/ranking-eval/snapshots
 *
 * Lists recent ranking evaluation snapshots for the authenticated org,
 * sorted newest first.
 *
 * Query parameters:
 *   timeWindow   – filter to a specific window ("7d" | "30d" | "all")
 *   modelVersion – filter to a specific model version
 *   limit        – maximum results (default 20, max 100)
 */
router.get("/analytics/ranking-eval/snapshots", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const { timeWindow, modelVersion, limit: limitStr } = req.query;

  const limit = Math.min(
    100,
    Math.max(1, limitStr ? parseInt(String(limitStr), 10) || 20 : 20),
  );

  const snapshots = await listRankingEvalSnapshots(orgId, {
    timeWindow:
      timeWindow && VALID_WINDOWS.includes(timeWindow as SnapshotTimeWindow)
        ? (timeWindow as SnapshotTimeWindow)
        : undefined,
    rankingModelVersion: modelVersion ? String(modelVersion) : undefined,
    limit,
  });

  res.json({ snapshots });
});

/**
 * GET /analytics/ranking-eval/snapshots/computed-metrics
 *
 * Server-computes snapshot metrics for the authenticated org and time window
 * without persisting.  Useful for previewing what a server-computed snapshot
 * would contain before saving.
 *
 * Query parameters:
 *   timeWindow – "7d" | "30d" | "all" (required)
 */
router.get("/analytics/ranking-eval/snapshots/computed-metrics", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const { timeWindow } = req.query;

  if (!timeWindow || !VALID_WINDOWS.includes(timeWindow as SnapshotTimeWindow)) {
    res.status(400).json({ error: `timeWindow must be one of: ${VALID_WINDOWS.join(", ")}.` });
    return;
  }

  const metrics = await computeSnapshotMetrics(orgId, timeWindow as SnapshotTimeWindow);
  res.json(metrics);
});

/**
 * GET /analytics/ranking-eval/outcome-attribution
 *
 * Returns outcome attribution data for the authenticated org — how boosted
 * alerts fared with analysts and how penalised alerts were rated.
 */
router.get("/analytics/ranking-eval/outcome-attribution", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const attribution = await computeOutcomeAttribution(orgId);
  res.json(attribution);
});

export default router;
