import { Router, type IRouter } from "express";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runRefresh, runBackfill, JobAlreadyRunningError } from "../services/ingestionService";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");
  try {
    const result = await runRefresh(req.log);
    res.json(
      TriggerRefreshResponse.parse({
        fetched: result.fetched,
        processed: result.processed,
        duplicatesSkipped: result.duplicatesSkipped,
        errors: result.errors,
        message: result.message,
      }),
    );
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// ── Backfill endpoint ──────────────────────────────────────────────────────────
// Fixes two gaps:
// 1. Articles processed before creditSummary/scoreExplanation were added to the prompt
//    → re-runs AI for structured outputs only, does UPDATE
// 2. Articles with processedAt=null that may have failed AI (not noise-filtered)
//    → re-checks noise filter, re-runs full AI if they pass, does UPDATE
router.post("/refresh/backfill", async (req, res): Promise<void> => {
  req.log.info("Starting structured-output backfill");
  try {
    const result = await runBackfill(req.log);
    res.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Backfill failed");
    res.status(500).json({ error: "Backfill failed" });
  }
});

export default router;
