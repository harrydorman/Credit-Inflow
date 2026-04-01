import { Router, type IRouter } from "express";
import { detectTrends, getTrendsDebugData } from "../services/trendDetection";

const router: IRouter = Router();

router.get("/trends/debug", async (req, res): Promise<void> => {
  try {
    const data = await getTrendsDebugData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Trends debug failed");
    res.status(500).json({ error: "Failed to get debug data" });
  }
});

router.get("/trends", async (req, res): Promise<void> => {
  try {
    const windowHours = Number(req.query.windowHours) || 72;
    const result = await detectTrends(windowHours);
    res.json({
      trendAlerts: result.allAlerts,
      hardAlerts: result.hardAlerts,
      emergingAlerts: result.emergingAlerts,
      fallbackNarrative: result.fallbackNarrative,
      total: result.allAlerts.length,
      windowHours: result.windowHours,
      articlesAnalyzed: result.articlesAnalyzed,
    });
  } catch (err) {
    req.log.error({ err }, "Trend detection failed");
    res.status(500).json({ error: "Failed to detect trends" });
  }
});

export default router;
