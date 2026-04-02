import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { ListIssuersResponse } from "@workspace/api-zod";
import { isNotNull } from "drizzle-orm";
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

export default router;
