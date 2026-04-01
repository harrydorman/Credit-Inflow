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
      // For riskTrend: track urgency scores over time (oldest to newest)
      urgencyTimeline: Array<{ date: Date; score: number }>;
      creditSignalTotal: number;
    }
  >();

  // Sort articles by date so timeline is chronological
  const sorted = [...articles].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
  );

  for (const article of sorted) {
    const issuer = article.issuerName!;
    const existing = issuerMap.get(issuer);
    const articleDate = new Date(article.publishedAt);
    const urgency = article.finalUrgencyScore ?? article.urgencyScore ?? 1;

    if (!existing) {
      issuerMap.set(issuer, {
        sector: article.sector,
        total: 1,
        negative: article.sentiment === "negative" ? 1 : 0,
        covenantFlag: article.covenantFlag,
        maxUrgency: urgency,
        eventTypes: new Set(article.eventType ? [article.eventType] : []),
        ratingMentioned: article.ratingMentioned,
        ratingAgency: article.ratingAgency,
        marketImpact: article.marketImpact,
        latestDate: articleDate,
        urgencyTimeline: [{ date: articleDate, score: urgency }],
        creditSignalTotal: article.creditSignalScore ?? 0,
      });
    } else {
      existing.total++;
      if (article.sentiment === "negative") existing.negative++;
      if (article.covenantFlag) existing.covenantFlag = true;
      if (urgency > existing.maxUrgency) existing.maxUrgency = urgency;
      if (article.eventType) existing.eventTypes.add(article.eventType);
      if (article.ratingMentioned && !existing.ratingMentioned) {
        existing.ratingMentioned = article.ratingMentioned;
        existing.ratingAgency = article.ratingAgency;
      }
      if (articleDate > existing.latestDate) {
        existing.latestDate = articleDate;
        if (article.sector) existing.sector = article.sector;
      }
      existing.urgencyTimeline.push({ date: articleDate, score: urgency });
      existing.creditSignalTotal += article.creditSignalScore ?? 0;
    }
  }

  // Compute riskTrend: compare first-half vs second-half urgency scores
  function computeRiskTrend(timeline: Array<{ date: Date; score: number }>): "improving" | "stable" | "deteriorating" {
    if (timeline.length < 2) return "stable";
    const mid = Math.floor(timeline.length / 2);
    const early = timeline.slice(0, mid).map((t) => t.score);
    const recent = timeline.slice(mid).map((t) => t.score);
    const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const delta = recentAvg - earlyAvg;
    if (delta >= 1.5) return "deteriorating";
    if (delta <= -1.5) return "improving";
    return "stable";
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
      riskTrend: computeRiskTrend(data.urgencyTimeline),
      creditSignalTotal: data.creditSignalTotal,
      riskScore:
        data.total > 0
          ? Math.round(
              ((data.negative / data.total) * 0.6 +
                (data.covenantFlag ? 0.3 : 0) +
                (data.maxUrgency / 10) * 0.1) *
                100
            ) / 100
          : 0,
    }))
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
