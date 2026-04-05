import { Router, type IRouter } from "express";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runIngestion, runBackfill } from "../services/ingestionService";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");
  try {
    const stats = await runIngestion({ log: req.log });
    // TriggerRefreshResponse keeps backward-compat field names; we extend the
    // response with the richer Phase 1b metrics as additional properties.
    res.json({
      ...TriggerRefreshResponse.parse({
        fetched: stats.articlesFetched,
        processed: stats.articlesFullyProcessed,
        duplicatesSkipped: stats.articlesSkippedDuplicate,
        errors: stats.articlesProcessingFailed,
        message: stats.message,
      }),
      jobId: stats.jobId,
      metrics: {
        feedsChecked: stats.feedsChecked,
        feedsSucceeded: stats.feedsSucceeded,
        feedsFailed: stats.feedsFailed,
        articlesInserted: stats.articlesInserted,
        articlesSkippedFiltered: stats.articlesSkippedFiltered,
        totalDurationMs: stats.totalDurationMs,
      },
    });
  } catch (err) {
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

router.post("/refresh/backfill", async (req, res): Promise<void> => {
  req.log.info("Starting structured-output backfill");
  try {
    const stats = await runBackfill({ log: req.log });
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "Backfill failed");
    res.status(500).json({ error: "Backfill failed" });
  }
});

export default router;
