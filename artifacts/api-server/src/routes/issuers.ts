import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { ListIssuersResponse } from "@workspace/api-zod";
import { isNotNull, eq, desc } from "drizzle-orm";
import { buildIssuerSnapshot, enrichArticle } from "../lib/intelligence";

const router: IRouter = Router();

router.get("/issuers", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.issuerName));

  const enriched = articles.map((article) => enrichArticle(article, articles));
  const issuerMap = new Map<string, typeof enriched>();

  for (const article of enriched) {
    if (!article.issuerName) continue;
    const bucket = issuerMap.get(article.issuerName) ?? [];
    bucket.push(article);
    issuerMap.set(article.issuerName, bucket);
  }

  const issuers = Array.from(issuerMap.entries())
    .map(([issuerName, issuerArticles]) => {
      const snapshot = buildIssuerSnapshot(issuerName, issuerArticles);
      const latest = issuerArticles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0];
      const eventTypes = Array.from(new Set(issuerArticles.map((a) => a.eventType).filter(Boolean))) as string[];
      const maxUrgency = Math.max(...issuerArticles.map((a) => a.finalUrgencyScore ?? a.urgencyScore ?? 0));
      const negativeCount = issuerArticles.filter((a) => a.sentiment === "negative").length;
      const covenantFlag = issuerArticles.some((a) => a.covenantFlag);
      const creditSignalTotal = issuerArticles.reduce((sum, a) => sum + (a.creditSignalScore ?? 0), 0);
      const avgTrust = Math.round(issuerArticles.reduce((sum, a) => sum + a.trustProfile.trustScore, 0) / Math.max(1, issuerArticles.length));

      return {
        issuerName,
        sector: latest?.sector ?? snapshot.sector,
        totalArticles: issuerArticles.length,
        negativeCount,
        covenantFlag,
        maxUrgency,
        eventTypes,
        ratingMentioned: latest?.ratingMentioned ?? null,
        ratingAgency: latest?.ratingAgency ?? null,
        marketImpact: latest?.marketImpact ?? null,
        latestArticleDate: latest?.publishedAt ? new Date(latest.publishedAt).toISOString() : null,
        riskTrend: snapshot.trend,
        creditSignalTotal,
        riskScore: Number(((snapshot.negativeSignalRatio * 0.5) + (maxUrgency / 10 * 0.2) + (avgTrust / 100 * 0.1) + (covenantFlag ? 0.2 : 0)).toFixed(2)),
        trustLabel: snapshot.trustLabel,
        dominantSignal: snapshot.dominantSignal,
        summary: snapshot.summary,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);

  res.json(ListIssuersResponse.parse({ issuers, total: issuers.length }));
});

router.get("/issuers/:name", async (req, res): Promise<void> => {
  const issuerName = decodeURIComponent(req.params.name);

  const issuerArticles = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.issuerName, issuerName))
    .orderBy(desc(articlesTable.publishedAt));

  if (issuerArticles.length === 0) {
    res.status(404).json({ error: "Issuer not found" });
    return;
  }

  const universe = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(300);

  const enriched = issuerArticles.map((a) => enrichArticle(a, universe));
  const snapshot = buildIssuerSnapshot(issuerName, issuerArticles);

  const maxUrgency = Math.max(...enriched.map((a) => a.finalUrgencyScore ?? a.urgencyScore ?? 0));
  const negativeCount = enriched.filter((a) => a.sentiment === "negative").length;
  const covenantFlag = enriched.some((a) => a.covenantFlag);

  const tradeImplications = enriched
    .filter((a) => a.potentialTrades?.length || a.tradeRationale)
    .sort((a, b) => (b.finalUrgencyScore ?? 0) - (a.finalUrgencyScore ?? 0))
    .slice(0, 5)
    .map((a) => ({
      articleId: a.id,
      title: a.title,
      publishedAt: a.publishedAt,
      tradeDirection: a.tradeDirection,
      tradeRationale: a.tradeRationale,
      potentialTrades: a.potentialTrades ?? [],
      marketsImpacted: a.marketsImpacted ?? [],
      finalUrgencyScore: a.finalUrgencyScore,
    }));

  const creditSummaries = enriched
    .filter((a) => a.creditSummaryJson)
    .sort((a, b) => (b.finalUrgencyScore ?? 0) - (a.finalUrgencyScore ?? 0))
    .slice(0, 3)
    .map((a) => ({
      articleId: a.id,
      title: a.title,
      publishedAt: a.publishedAt,
      creditSummary: a.creditSummaryJson,
      scoreExplanation: a.scoreExplanationJson,
      signalCard: a.signalCard,
      urgency: a.finalUrgencyScore,
    }));

  res.json({
    issuerName,
    snapshot,
    totalArticles: issuerArticles.length,
    negativeCount,
    covenantFlag,
    maxUrgency,
    articles: enriched.map((a) => ({
      id: a.id,
      title: a.title,
      source: a.source,
      publishedAt: a.publishedAt,
      url: a.url,
      summary: a.summary,
      sector: a.sector,
      eventType: a.eventType,
      sentiment: a.sentiment,
      urgencyScore: a.urgencyScore,
      finalUrgencyScore: a.finalUrgencyScore,
      covenantFlag: a.covenantFlag,
      ratingMentioned: a.ratingMentioned,
      ratingAgency: a.ratingAgency,
      marketImpact: a.marketImpact,
      tradeDirection: a.tradeDirection,
      signalStrength: a.signalStrength,
      trustProfile: a.trustProfile,
      signalCard: a.signalCard,
      creditSummaryJson: a.creditSummaryJson,
    })),
    tradeImplications,
    creditSummaries,
  });
});

export default router;
