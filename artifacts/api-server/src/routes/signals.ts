import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { buildCreditPulse, buildIssuerSnapshot, enrichArticle } from "../lib/intelligence";

const router: IRouter = Router();

router.get("/signals", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt));

  const enriched = articles.map((article) => enrichArticle(article, articles));
  const sectorMap = new Map<string, { total: number; negative: number; eventTypes: Set<string>; trustTotal: number; signalStrengthTotal: number }>();
  const eventTypeMap = new Map<string, { count: number; negative: number; sectors: Set<string> }>();
  const issuerMap = new Map<string, typeof enriched>();

  for (const article of enriched) {
    const sector = article.sector ?? "Other";
    const eventType = article.eventType ?? "other";
    const sentiment = article.sentiment ?? "neutral";

    if (!sectorMap.has(sector)) sectorMap.set(sector, { total: 0, negative: 0, eventTypes: new Set(), trustTotal: 0, signalStrengthTotal: 0 });
    const sectorData = sectorMap.get(sector)!;
    sectorData.total++;
    if (sentiment === "negative") sectorData.negative++;
    if (eventType) sectorData.eventTypes.add(eventType);
    sectorData.trustTotal += article.trustProfile.trustScore;
    sectorData.signalStrengthTotal += article.signalStrength;

    if (!eventTypeMap.has(eventType)) eventTypeMap.set(eventType, { count: 0, negative: 0, sectors: new Set() });
    const etData = eventTypeMap.get(eventType)!;
    etData.count++;
    if (sentiment === "negative") etData.negative++;
    if (sector) etData.sectors.add(sector);

    if (article.issuerName) {
      const bucket = issuerMap.get(article.issuerName) ?? [];
      bucket.push(article);
      issuerMap.set(article.issuerName, bucket);
    }
  }

  const bySector = Array.from(sectorMap.entries())
    .map(([sector, data]) => ({
      sector,
      totalArticles: data.total,
      negativeCount: data.negative,
      eventTypes: Array.from(data.eventTypes),
      riskScore: data.total > 0 ? Math.round(((data.negative / data.total) * 0.6 + (data.signalStrengthTotal / data.total / 20) + (data.trustTotal / data.total / 200)) * 100) / 100 : 0,
      creditSignalScore: Math.round((data.signalStrengthTotal / Math.max(1, data.total)) * 100) / 100,
      avgTrustScore: Math.round(data.trustTotal / Math.max(1, data.total)),
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  const byEventType = Array.from(eventTypeMap.entries())
    .map(([eventType, data]) => ({
      eventType,
      count: data.count,
      negativeCount: data.negative,
      sectors: Array.from(data.sectors),
    }))
    .sort((a, b) => b.count - a.count);

  const topSignals = enriched
    .sort((a, b) => b.signalStrength - a.signalStrength)
    .slice(0, 10)
    .map((article) => ({
      articleId: article.id,
      issuerName: article.issuerName,
      sector: article.sector,
      signalType: article.signalCard.signalType,
      signalLabel: article.signalCard.signalLabel,
      whyNow: article.signalCard.whyNow,
      confidence: article.signalCard.confidence,
      trustScore: article.trustProfile.trustScore,
      sourceTier: article.trustProfile.sourceTier,
      evidenceCount: article.trustProfile.evidenceCount,
      corroboratingArticleCount: article.trustProfile.corroboratingArticleCount,
      primarySourcePresent: article.trustProfile.primarySourcePresent,
      keyEvidence: article.signalCard.keyEvidence,
      creditImplications: article.signalCard.creditImplications,
      riskFlags: article.signalCard.riskFlags,
      decisionUse: article.signalCard.decisionUse,
      signalStrength: article.signalStrength,
    }));

  const issuerRadar = Array.from(issuerMap.entries())
    .map(([issuerName, issuerArticles]) => buildIssuerSnapshot(issuerName, issuerArticles))
    .sort((a, b) => {
      const riskRank = { high: 3, medium: 2, low: 1 };
      if (riskRank[b.riskLevel] !== riskRank[a.riskLevel]) return riskRank[b.riskLevel] - riskRank[a.riskLevel];
      return b.negativeSignalRatio - a.negativeSignalRatio;
    })
    .slice(0, 8);

  const creditPulse = buildCreditPulse(articles, articles);
  const lastUpdated = enriched.length > 0
    ? enriched.reduce((latest, a) => (a.processedAt?.getTime() ?? 0) > (latest.processedAt?.getTime() ?? 0) ? a : latest).processedAt
    : null;

  res.json({
    creditPulse,
    bySector,
    byEventType,
    issuerRadar,
    totalArticles: enriched.length,
    topSignals,
    lastUpdated: lastUpdated?.toISOString() ?? null,
  });
});

router.get("/signals/daily-brief", async (_req, res): Promise<void> => {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt));

  const today = new Date().toISOString().split("T")[0];
  const enriched = articles.map((article) => enrichArticle(article, articles));

  const toItem = (a: typeof enriched[number]) => ({
    articleId: a.id,
    title: a.title,
    summary: a.summary,
    sector: a.sector,
    sentiment: a.sentiment,
    eventType: a.eventType,
    issuerName: a.issuerName,
    urgencyScore: a.urgencyScore,
    finalUrgencyScore: a.finalUrgencyScore,
    covenantFlag: a.covenantFlag,
    ratingMentioned: a.ratingMentioned,
    ratingAgency: a.ratingAgency,
    marketImpact: a.marketImpact,
    tradeDirection: a.tradeDirection,
    spreadWideningRisk: a.spreadWideningRisk,
    trustProfile: a.trustProfile,
    signalCard: a.signalCard,
    evidenceItems: a.evidenceItems,
    issuerSnapshot: a.issuerSnapshot,
    signalStrength: a.signalStrength,
  });

  const ranked = [...enriched].sort((a, b) => b.signalStrength - a.signalStrength);
  const negativeArticles = ranked.filter((a) => a.sentiment === "negative").slice(0, 8);
  const covenantAlerts = ranked.filter((a) => a.covenantFlag).slice(0, 6);
  const criticalAlerts = ranked.filter((a) => (a.finalUrgencyScore ?? 0) >= 6 || a.trustProfile.trustLabel === "high").slice(0, 6);

  const sectorRiskMap = new Map<string, { total: number; negative: number; eventTypes: Set<string>; avgTrust: number }>();
  for (const article of enriched) {
    const sector = article.sector ?? "Other";
    if (!sectorRiskMap.has(sector)) sectorRiskMap.set(sector, { total: 0, negative: 0, eventTypes: new Set(), avgTrust: 0 });
    const d = sectorRiskMap.get(sector)!;
    d.total++;
    if (article.sentiment === "negative") d.negative++;
    if (article.eventType) d.eventTypes.add(article.eventType);
    d.avgTrust += article.trustProfile.trustScore;
  }

  const mostImpactedSectors = Array.from(sectorRiskMap.entries())
    .map(([sector, data]) => ({
      sector,
      totalArticles: data.total,
      negativeCount: data.negative,
      eventTypes: Array.from(data.eventTypes),
      riskScore: data.total > 0 ? Math.round(((data.negative / data.total) * 0.7 + (data.avgTrust / data.total / 300)) * 100) / 100 : 0,
    }))
    .filter((s) => s.negativeCount > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  const topEventTypes = byCount(enriched.map((a) => a.eventType ?? "other"))
    .slice(0, 3)
    .map(([et, count]) => `${count} signal${count === 1 ? "" : "s"} tagged as ${et}`);

  const issuerHotspots = byCount(enriched.filter((a) => a.issuerName).map((a) => a.issuerName!))
    .slice(0, 3)
    .map(([issuer, count]) => `${issuer} appeared in ${count} recent signal${count === 1 ? "" : "s"}`);

  const keyTrends: string[] = [
    ...topEventTypes,
    ...issuerHotspots,
    mostImpactedSectors.length > 0 ? `Most pressured sectors: ${mostImpactedSectors.slice(0, 2).map((s) => s.sector).join(" and ")}` : null,
    covenantAlerts.length > 0 ? `${covenantAlerts.length} covenant-related items deserve immediate review` : null,
    criticalAlerts.filter((a) => a.trustProfile.primarySourcePresent).length > 0 ? `${criticalAlerts.filter((a) => a.trustProfile.primarySourcePresent).length} critical items have primary-source backing` : null,
  ].filter(Boolean) as string[];

  const cloAlerts = ranked.filter((a) => a.cloImpact).slice(0, 5);

  res.json({
    date: today,
    creditPulse: buildCreditPulse(articles, articles),
    mostNegativeEvents: negativeArticles.map(toItem),
    mostImpactedSectors,
    keyTrends,
    issuerHotspots: dedupeIssuerSnapshots(negativeArticles.map((a) => a.issuerSnapshot).filter(Boolean)).slice(0, 5),
    cloAlerts: cloAlerts.map(toItem),
    covenantAlerts: covenantAlerts.map(toItem),
    criticalAlerts: criticalAlerts.map(toItem),
    totalArticlesProcessed: enriched.length,
  });
});

function byCount<T extends string>(values: T[]): Array<[T, number]> {
  const map = new Map<T, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

export default router;


function dedupeIssuerSnapshots(values: Array<any>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value?.issuerName;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
