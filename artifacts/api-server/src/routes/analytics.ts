import { Router, type IRouter } from "express";
import { requireOrgId } from "../middlewares/auth";
import { getAlertAnalytics } from "../services/alertAnalyticsService";

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

export default router;
