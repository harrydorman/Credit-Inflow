import { Router, type IRouter } from "express";
import { db, portfoliosTable, portfolioHoldingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ingestPortfolioCSV, getPortfolioDetails, getPortfoliosForOrganization } from "../services/portfolioService";
import { getPortfolioExposureAlerts } from "../services/alertEvaluationService";
import { requireOrgId } from "../middlewares/auth";

const router: IRouter = Router();

// GET /portfolios
router.get("/portfolios", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const portfolios = await getPortfoliosForOrganization(orgId);
  res.json({ portfolios });
});

// POST /portfolios
router.post("/portfolios", async (req, res): Promise<void> => {
  const { organizationId, name, description } = req.body as {
    organizationId?: string;
    name?: string;
    description?: string;
  };

  if (!organizationId || !name?.trim()) {
    res.status(400).json({ error: "organizationId and name are required" });
    return;
  }

  const [created] = await db
    .insert(portfoliosTable)
    .values({ organizationId, name: name.trim(), description })
    .returning();

  res.status(201).json(created);
});

// GET /portfolios/:id
router.get("/portfolios/:id", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const portfolioId = parseInt(req.params.id, 10);
  if (isNaN(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  const details = await getPortfolioDetails(portfolioId, orgId);
  if (!details) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }

  res.json(details);
});

// GET /portfolios/:id/holdings
router.get("/portfolios/:id/holdings", async (req, res): Promise<void> => {
  const portfolioId = parseInt(req.params.id, 10);
  if (isNaN(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  const holdings = await db
    .select()
    .from(portfolioHoldingsTable)
    .where(eq(portfolioHoldingsTable.portfolioId, portfolioId))
    .orderBy(portfolioHoldingsTable.issuerName);

  res.json({ holdings });
});

// POST /portfolios/:id/holdings/csv
router.post("/portfolios/:id/holdings/csv", async (req, res): Promise<void> => {
  const portfolioId = parseInt(req.params.id, 10);
  if (isNaN(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  const csvContent = req.body?.csv as string | undefined;
  if (!csvContent?.trim()) {
    res.status(400).json({ error: "csv body field is required" });
    return;
  }

  try {
    const result = await ingestPortfolioCSV(portfolioId, csvContent);
    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

// GET /portfolios/:id/exposure-alerts
router.get("/portfolios/:id/exposure-alerts", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const portfolioId = parseInt(req.params.id, 10);
  if (isNaN(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  // Validate org owns this portfolio
  const portfolio = await getPortfolioDetails(portfolioId, orgId);
  if (!portfolio) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }

  const alerts = await getPortfolioExposureAlerts(portfolioId);
  res.json({ alerts });
});

// DELETE /portfolios/:id
router.delete("/portfolios/:id", async (req, res): Promise<void> => {
  const portfolioId = parseInt(req.params.id, 10);
  if (isNaN(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  const deleted = await db
    .delete(portfoliosTable)
    .where(eq(portfoliosTable.id, portfolioId))
    .returning({ id: portfoliosTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }

  res.status(204).send();
});

export default router;
