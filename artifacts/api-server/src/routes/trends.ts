import { Router, type IRouter } from "express";
import { detectTrends } from "../services/trendDetection";

const router: IRouter = Router();

router.get("/trends", async (req, res): Promise<void> => {
  try {
    const windowHours = Number(req.query.windowHours) || 72;
    const alerts = await detectTrends(windowHours);
    res.json({ trendAlerts: alerts, total: alerts.length, windowHours });
  } catch (err) {
    req.log.error({ err }, "Trend detection failed");
    res.status(500).json({ error: "Failed to detect trends" });
  }
});

export default router;
