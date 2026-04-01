import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { ListIssuersResponse } from "@workspace/api-zod";
import { isNotNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/issuers", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.issuerName));

  const issuerMap = new Map<
    string,
    {
      sector: string | null;
      total: number;
      negative: number;
      covenantFlag: boolean;
      maxUrgency: number;
      eventTypes: Set<string>;
      ratingMentioned: string | null;
      ratingAgency: string | null;
      marketImpact: string | null;
      latestDate: Date;
    }
  >();

  for (const article of articles) {
    const issuer = article.issuerName!;
    const existing = issuerMap.get(issuer);

    const articleDate = new Date(article.publishedAt);

    if (!existing) {
      issuerMap.set(issuer, {
        sector: article.sector,
        total: 1,
        negative: article.sentiment === "negative" ? 1 : 0,
        covenantFlag: article.covenantFlag,
        maxUrgency: article.urgencyScore ?? 1,
        eventTypes: new Set(article.eventType ? [article.eventType] : []),
        ratingMentioned: article.ratingMentioned,
        ratingAgency: article.ratingAgency,
        marketImpact: article.marketImpact,
        latestDate: articleDate,
      });
    } else {
      existing.total++;
      if (article.sentiment === "negative") existing.negative++;
      if (article.covenantFlag) existing.covenantFlag = true;
      if ((article.urgencyScore ?? 0) > existing.maxUrgency) {
        existing.maxUrgency = article.urgencyScore ?? existing.maxUrgency;
      }
      if (article.eventType) existing.eventTypes.add(article.eventType);
      if (article.ratingMentioned && !existing.ratingMentioned) {
        existing.ratingMentioned = article.ratingMentioned;
        existing.ratingAgency = article.ratingAgency;
      }
      if (articleDate > existing.latestDate) {
        existing.latestDate = articleDate;
        if (article.sector) existing.sector = article.sector;
      }
    }
  }

  const issuers = Array.from(issuerMap.entries())
    .map(([issuerName, data]) => ({
      issuerName,
      sector: data.sector,
      totalArticles: data.total,
      negativeCount: data.negative,
      covenantFlag: data.covenantFlag,
      maxUrgency: data.maxUrgency,
      eventTypes: Array.from(data.eventTypes),
      ratingMentioned: data.ratingMentioned,
      ratingAgency: data.ratingAgency,
      marketImpact: data.marketImpact,
      latestArticleDate: data.latestDate.toISOString(),
      riskScore:
        data.total > 0
          ? Math.round(
              ((data.negative / data.total) * 0.6 +
                (data.covenantFlag ? 0.3 : 0) +
                (data.maxUrgency / 5) * 0.1) *
                100
            ) / 100
          : 0,
    }))
    // Sort by urgency first (covenant/critical flags), then negative count
    .sort((a, b) => {
      if (b.covenantFlag !== a.covenantFlag) return b.covenantFlag ? 1 : -1;
      if (b.maxUrgency !== a.maxUrgency) return b.maxUrgency - a.maxUrgency;
      return b.negativeCount - a.negativeCount;
    });

  res.json(
    ListIssuersResponse.parse({
      issuers,
      total: issuers.length,
    })
  );
});

export default router;
