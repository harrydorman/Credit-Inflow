import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { GetSignalsResponse, GetDailyBriefResponse } from "@workspace/api-zod";
import { isNotNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/signals", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt));

  const sectorMap = new Map<
    string,
    { total: number; negative: number; eventTypes: Set<string> }
  >();

  const eventTypeMap = new Map<
    string,
    { count: number; negative: number; sectors: Set<string> }
  >();

  for (const article of articles) {
    const sector = article.sector ?? "Other";
    const eventType = article.eventType ?? "other";
    const sentiment = article.sentiment ?? "neutral";

    if (!sectorMap.has(sector)) {
      sectorMap.set(sector, { total: 0, negative: 0, eventTypes: new Set() });
    }
    const sectorData = sectorMap.get(sector)!;
    sectorData.total++;
    if (sentiment === "negative") sectorData.negative++;
    if (eventType) sectorData.eventTypes.add(eventType);

    if (!eventTypeMap.has(eventType)) {
      eventTypeMap.set(eventType, { count: 0, negative: 0, sectors: new Set() });
    }
    const etData = eventTypeMap.get(eventType)!;
    etData.count++;
    if (sentiment === "negative") etData.negative++;
    if (sector) etData.sectors.add(sector);
  }

  const bySector = Array.from(sectorMap.entries())
    .map(([sector, data]) => ({
      sector,
      totalArticles: data.total,
      negativeCount: data.negative,
      eventTypes: Array.from(data.eventTypes),
      riskScore:
        data.total > 0
          ? Math.round((data.negative / data.total) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.negativeCount - a.negativeCount);

  const byEventType = Array.from(eventTypeMap.entries())
    .map(([eventType, data]) => ({
      eventType,
      count: data.count,
      negativeCount: data.negative,
      sectors: Array.from(data.sectors),
    }))
    .sort((a, b) => b.count - a.count);

  const lastUpdated =
    articles.length > 0
      ? articles.reduce((latest, a) =>
          (a.processedAt?.getTime() ?? 0) >
          (latest.processedAt?.getTime() ?? 0)
            ? a
            : latest
        ).processedAt
      : null;

  res.json(
    GetSignalsResponse.parse({
      bySector,
      byEventType,
      totalArticles: articles.length,
      lastUpdated: lastUpdated?.toISOString() ?? null,
    })
  );
});

router.get("/signals/daily-brief", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt));

  const today = new Date().toISOString().split("T")[0];

  const toItem = (a: typeof articles[0]) => ({
    articleId: a.id,
    title: a.title,
    summary: a.summary,
    sector: a.sector,
    sentiment: a.sentiment,
    eventType: a.eventType,
    issuerName: a.issuerName,
    urgencyScore: a.urgencyScore,
    covenantFlag: a.covenantFlag,
    ratingMentioned: a.ratingMentioned,
    ratingAgency: a.ratingAgency,
    marketImpact: a.marketImpact,
  });

  // Most negative events sorted by urgency then date
  const negativeArticles = articles
    .filter((a) => a.sentiment === "negative")
    .sort((a, b) => {
      const urgDiff = (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0);
      if (urgDiff !== 0) return urgDiff;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    .slice(0, 8);

  // Covenant alerts — critical early warning
  const covenantAlerts = articles
    .filter((a) => a.covenantFlag)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 6);

  // Critical urgency score 4-5
  const criticalAlerts = articles
    .filter((a) => (a.urgencyScore ?? 0) >= 4)
    .sort((a, b) => (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0))
    .slice(0, 6);

  const sectorRiskMap = new Map<
    string,
    { total: number; negative: number; eventTypes: Set<string> }
  >();

  for (const article of articles) {
    const sector = article.sector ?? "Other";
    if (!sectorRiskMap.has(sector)) {
      sectorRiskMap.set(sector, { total: 0, negative: 0, eventTypes: new Set() });
    }
    const d = sectorRiskMap.get(sector)!;
    d.total++;
    if (article.sentiment === "negative") d.negative++;
    if (article.eventType) d.eventTypes.add(article.eventType);
  }

  const mostImpactedSectors = Array.from(sectorRiskMap.entries())
    .map(([sector, data]) => ({
      sector,
      totalArticles: data.total,
      negativeCount: data.negative,
      eventTypes: Array.from(data.eventTypes),
      riskScore:
        data.total > 0
          ? Math.round((data.negative / data.total) * 100) / 100
          : 0,
    }))
    .filter((s) => s.negativeCount > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  const eventTypeCounts = articles.reduce(
    (acc, a) => {
      if (a.eventType) acc[a.eventType] = (acc[a.eventType] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const topEventTypes = Object.entries(eventTypeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([et, count]) => `${count} articles tagged as "${et}"`);

  const negativeSectors = mostImpactedSectors.slice(0, 2).map((s) => s.sector);
  const keyTrends: string[] = [
    ...topEventTypes,
    ...(negativeSectors.length > 0
      ? [`Elevated credit risk in ${negativeSectors.join(" and ")} sectors`]
      : []),
    covenantAlerts.length > 0
      ? `${covenantAlerts.length} covenant-related events flagged — review immediately`
      : null,
    criticalAlerts.length > 0
      ? `${criticalAlerts.length} high/critical urgency events detected today`
      : null,
    articles.filter((a) => a.cloImpact).length > 0
      ? `${articles.filter((a) => a.cloImpact).length} CLO-relevant events detected`
      : null,
  ].filter(Boolean) as string[];

  const cloAlerts = articles
    .filter((a) => a.cloImpact)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .slice(0, 5);

  res.json(
    GetDailyBriefResponse.parse({
      date: today,
      mostNegativeEvents: negativeArticles.map(toItem),
      mostImpactedSectors,
      keyTrends,
      cloAlerts: cloAlerts.map(toItem),
      covenantAlerts: covenantAlerts.map(toItem),
      criticalAlerts: criticalAlerts.map(toItem),
      totalArticlesProcessed: articles.length,
    })
  );
});

export default router;
