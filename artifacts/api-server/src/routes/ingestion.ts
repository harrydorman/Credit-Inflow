import { Router, type IRouter } from "express";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runIngestion, runBackfill } from "../services/ingestionService";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");
  try {
    const stats = await runIngestion({ log: req.log });
    res.json(
      TriggerRefreshResponse.parse({
        fetched: stats.fetched,
        processed: stats.processed,
        duplicatesSkipped: stats.duplicatesSkipped,
        errors: stats.errors,
        message: stats.message,
      })
    );
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
