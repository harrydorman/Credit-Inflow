import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { gte } from "drizzle-orm";
import { getETFSnapshot } from "../lib/marketData";
import { detectTrends } from "../services/trendDetection";

const router: IRouter = Router();

router.get("/market-overview", async (req, res): Promise<void> => {
  try {
    const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch in parallel: ETF data + articles + trends
    const [etfSnapshot, articles, trendResult] = await Promise.all([
      getETFSnapshot(),
      db.select().from(articlesTable).where(gte(articlesTable.publishedAt, since72h)),
      detectTrends(72),
    ]);

    const articles24h = articles.filter((a) => new Date(a.publishedAt) >= since24h);

    // ── Macro ─────────────────────────────────────────────────────────────────
    const hygMove = etfSnapshot.hyg?.move1D ?? null;
    const lqdMove = etfSnapshot.lqd?.move1D ?? null;

    let marketDirection = "neutral";
    if (hygMove !== null) {
      if (hygMove <= -0.5) marketDirection = "risk-off";
      else if (hygMove >= 0.3) marketDirection = "risk-on";
      else if (hygMove < -0.1) marketDirection = "cautious";
      else marketDirection = "stable";
    }

    // ── Risk summary ──────────────────────────────────────────────────────────
    const processed = articles.filter((a) => a.processedAt);
    const negativeSignals = processed.filter((a) => a.sentiment === "negative").length;
    const downgrades = processed.filter((a) => a.ratingIsDowngrade).length;
    const covenantFlags = processed.filter((a) => a.covenantFlag).length;
    const urgentArticles = processed.filter((a) => (a.finalUrgencyScore ?? 0) >= 7).length;

    // Overall condition: deteriorating if 30%+ negative or 2+ downgrades or covenant flag
    const overallCondition =
      (negativeSignals / Math.max(1, processed.length) >= 0.3) ||
      downgrades >= 2 ||
      covenantFlags >= 1
        ? "deteriorating"
        : "stable";

    // ── Top risks by sector ───────────────────────────────────────────────────
    const sectorRisk = new Map<string, {
      negCount: number; avgUrgency: number; totalCount: number;
      topEvent: string | null; hasDowngrade: boolean; hasCovenant: boolean;
    }>();
    for (const a of processed) {
      if (!a.sector) continue;
      const s = sectorRisk.get(a.sector) ?? {
        negCount: 0, avgUrgency: 0, totalCount: 0,
        topEvent: null, hasDowngrade: false, hasCovenant: false,
      };
      s.totalCount++;
      if (a.sentiment === "negative") s.negCount++;
      s.avgUrgency += (a.finalUrgencyScore ?? a.urgencyScore ?? 0);
      if (a.ratingIsDowngrade) s.hasDowngrade = true;
      if (a.covenantFlag) s.hasCovenant = true;
      if (!s.topEvent && a.eventType) s.topEvent = a.eventType;
      sectorRisk.set(a.sector, s);
    }

    const topRisks = Array.from(sectorRisk.entries())
      .map(([sector, data]) => ({
        sector,
        negativeCount: data.negCount,
        articleCount: data.totalCount,
        avgUrgency: data.totalCount > 0 ? Math.round(data.avgUrgency / data.totalCount) : 0,
        hasDowngrade: data.hasDowngrade,
        hasCovenant: data.hasCovenant,
        reason: buildReason(sector, data),
      }))
      .filter((s) => s.negativeCount > 0)
      .sort((a, b) => b.negativeCount - a.negativeCount || b.avgUrgency - a.avgUrgency)
      .slice(0, 5);

    // ── Trend highlights ──────────────────────────────────────────────────────
    const trendHighlights = trendResult.hardAlerts.slice(0, 3).map((t) => ({
      type: t.type,
      sector: t.sector,
      issuer: t.issuer,
      signal: t.signal,
      severity: t.severity,
      trendStrength: t.trendStrength,
    }));

    // ── Sector signal counts ──────────────────────────────────────────────────
    const sectorSignals = Array.from(sectorRisk.entries()).map(([sector, data]) => ({
      sector,
      totalArticles: data.totalCount,
      negativeCount: data.negCount,
      avgUrgency: data.totalCount > 0 ? +(data.avgUrgency / data.totalCount).toFixed(1) : 0,
    }));

    res.json({
      macro: {
        hyETF: hygMove,
        igETF: lqdMove,
        marketDirection,
        hyETFLastClose: etfSnapshot.hyg?.lastClose ?? null,
        lqdLastClose: etfSnapshot.lqd?.lastClose ?? null,
      },
      riskSummary: {
        overallCondition,
        negativeSignals,
        downgrades,
        covenantFlags,
        urgentArticles,
        totalArticles72h: articles.length,
        processedArticles: processed.length,
      },
      topRisks,
      trendHighlights,
      sectorSignals,
      articleCounts: {
        last24h: articles24h.length,
        last72h: articles.length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Market overview failed");
    res.status(500).json({ error: "Failed to generate market overview" });
  }
});

function buildReason(sector: string, data: {
  negCount: number; totalCount: number; hasDowngrade: boolean;
  hasCovenant: boolean; topEvent: string | null;
}): string {
  const parts: string[] = [];
  if (data.hasCovenant) parts.push("covenant breach flagged");
  if (data.hasDowngrade) parts.push("rating downgrade");
  if (data.topEvent && data.topEvent !== "other") parts.push(data.topEvent.replace(/_/g, " "));
  if (data.negCount >= 3) parts.push(`${data.negCount} negative signals`);
  else if (data.negCount >= 1) parts.push(`${data.negCount} negative signal${data.negCount > 1 ? "s" : ""}`);
  return parts.length > 0
    ? parts.join("; ") + ` in ${sector}`
    : `Elevated negative sentiment in ${sector}`;
}

export default router;
