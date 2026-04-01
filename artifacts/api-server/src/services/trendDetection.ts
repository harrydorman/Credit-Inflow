import { db, articlesTable } from "@workspace/db";
import { gte } from "drizzle-orm";

export interface TrendAlert {
  type: "sector_cluster" | "issuer_deterioration" | "refinancing_wave" | "downgrade_wave" | "emerging";
  sector: string | null;
  issuer: string | null;
  signal: string;
  evidence: string;
  implication: string;
  articleCount: number;
  severity: "critical" | "high" | "moderate" | "watch";
  trendScore: number;
  trendStrength: "increasing" | "stable" | "weakening";
}

export interface FallbackNarrative {
  summary: string;
  sectorsToWatch: string[];
  reasoning: string;
}

export interface TrendDetectionResult {
  hardAlerts: TrendAlert[];
  emergingAlerts: TrendAlert[];
  fallbackNarrative: FallbackNarrative | null;
  allAlerts: TrendAlert[];
  windowHours: number;
  articlesAnalyzed: number;
}

// ── Helper: is this article a "negative event"? ──────────────────────────────
function isNegativeEvent(a: { sentiment: string | null; creditSignalScore: number | null }): boolean {
  return a.sentiment === "negative" || (a.creditSignalScore ?? 0) >= 2;
}

// ── Helper: trendScore formula ───────────────────────────────────────────────
function calcTrendScore(articles: Array<{
  creditSignalScore: number | null;
  finalUrgencyScore: number | null;
  urgencyScore: number | null;
  cloImpact: boolean;
}>): number {
  let score = 0;
  score += articles.length * 2;
  score += articles.filter((a) => (a.finalUrgencyScore ?? a.urgencyScore ?? 0) >= 4).length * 2;
  score += articles.filter((a) => a.cloImpact).length;
  return score;
}

// ── Helper: trendStrength from multi-timeframe ────────────────────────────────
function calcTrendStrength(
  articlesIn72h: number,
  articlesIn24h: number,
): "increasing" | "stable" | "weakening" {
  if (articlesIn72h === 0) return "stable";
  const ratio = articlesIn24h / articlesIn72h;
  if (ratio > 0.5) return "increasing";   // more than half in last 24h
  if (ratio < 0.15) return "weakening";   // very few in last 24h
  return "stable";
}

export async function detectTrends(windowHours = 72): Promise<TrendDetectionResult> {
  const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch the widest window (7 days) and we'll slice in code
  const allArticles = await db.select().from(articlesTable).where(gte(articlesTable.publishedAt, since7d));

  const articles72h = allArticles.filter((a) => new Date(a.publishedAt) >= since72h);
  const articles24h = allArticles.filter((a) => new Date(a.publishedAt) >= since24h);

  const workingArticles = articles72h; // primary window for hard trend detection

  const hardAlerts: TrendAlert[] = [];
  const emergingAlerts: TrendAlert[] = [];

  // ── 1. Sector stress clustering ──────────────────────────────────────────────
  // NEW: 2+ negative events in same sector (loosened from 3+)
  type SectorBucket = {
    articles72h: typeof workingArticles;
    articles24h: typeof articles24h;
    covenants: number;
    downgrades: number;
    refinancingCount: number;
    liquidityCount: number;
  };
  const sectorMap = new Map<string, SectorBucket>();

  for (const a of workingArticles) {
    if (!a.sector) continue;
    if (!isNegativeEvent(a)) continue;
    const b = sectorMap.get(a.sector) ?? {
      articles72h: [], articles24h: [], covenants: 0, downgrades: 0,
      refinancingCount: 0, liquidityCount: 0,
    };
    b.articles72h.push(a);
    if (a.covenantFlag) b.covenants++;
    if (a.ratingIsDowngrade) b.downgrades++;
    if (a.refinancingRisk) b.refinancingCount++;
    if (a.liquidityConcern) b.liquidityCount++;
    sectorMap.set(a.sector, b);
  }
  for (const a of articles24h) {
    if (!a.sector || !isNegativeEvent(a)) continue;
    const b = sectorMap.get(a.sector);
    if (b) b.articles24h.push(a);
  }

  for (const [sector, data] of sectorMap.entries()) {
    const count = data.articles72h.length;
    const topEvents = [...new Set(data.articles72h.map((a) => a.eventType).filter(Boolean))].slice(0, 3).join(", ");
    const trendStrength = calcTrendStrength(count, data.articles24h.length);
    const trendScore = calcTrendScore(data.articles72h);

    // Hard trend: 2+ negative events in same sector
    if (count >= 2) {
      const severity = data.covenants > 0 || count >= 5 ? "critical" :
        count >= 4 ? "high" : "moderate";
      hardAlerts.push({
        type: "sector_cluster",
        sector,
        issuer: null,
        signal: `${count} negative credit events in ${sector} sector over 72h`,
        evidence: `Event types: ${topEvents || "mixed"}. ${data.covenants > 0 ? `${data.covenants} covenant breach(es). ` : ""}${data.downgrades > 0 ? `${data.downgrades} downgrade(s). ` : ""}${data.refinancingCount > 0 ? `${data.refinancingCount} refinancing risk flag(s).` : ""}`,
        implication: `Elevated sector-wide credit stress in ${sector}. ${data.downgrades > 0 ? "Rating agency reviews likely. " : ""}${data.refinancingCount > 0 ? "Maturity wall pressure increasing — monitor HY bonds in this sector. " : ""}Expect spread widening in lower-rated ${sector} cohort.`,
        articleCount: count,
        severity,
        trendScore,
        trendStrength,
      });
    } else if (count === 1) {
      // Soft emerging trend: single negative event — add to emerging
      emergingAlerts.push({
        type: "emerging",
        sector,
        issuer: null,
        signal: `Early stress indicators in ${sector}`,
        evidence: `${count} negative article detected: ${topEvents || "negative sentiment"}`,
        implication: `Early signs of stress emerging in ${sector}. Monitor for further deterioration — additional negative events could confirm a sector-level trend.`,
        articleCount: count,
        severity: "watch",
        trendScore: Math.max(1, trendScore),
        trendStrength,
      });
    }
  }

  // ── 2. Issuer deterioration ──────────────────────────────────────────────────
  // 2+ events for same issuer within 72h (any sentiment or creditSignalScore >= 2)
  type IssuerBucket = {
    articles: typeof workingArticles;
    negCount: number;
    maxUrgency: number;
    covenantFlag: boolean;
  };
  const issuerMap = new Map<string, IssuerBucket>();

  for (const a of workingArticles) {
    if (!a.issuerName) continue;
    const b = issuerMap.get(a.issuerName) ?? { articles: [], negCount: 0, maxUrgency: 1, covenantFlag: false };
    b.articles.push(a);
    if (isNegativeEvent(a)) b.negCount++;
    const urg = a.finalUrgencyScore ?? a.urgencyScore ?? 0;
    if (urg > b.maxUrgency) b.maxUrgency = urg;
    if (a.covenantFlag) b.covenantFlag = true;
    issuerMap.set(a.issuerName, b);
  }

  for (const [issuer, data] of issuerMap.entries()) {
    // 2+ events for same issuer
    if (data.articles.length < 2) continue;
    const severity = data.covenantFlag ? "critical" : data.maxUrgency >= 7 ? "high" : "moderate";
    const trendScore = calcTrendScore(data.articles);
    const articles24hForIssuer = articles24h.filter((a) => a.issuerName === issuer).length;
    const trendStrength = calcTrendStrength(data.articles.length, articles24hForIssuer);
    const topEvents = [...new Set(data.articles.map((a) => a.eventType).filter(Boolean))].slice(0, 3).join(", ");

    hardAlerts.push({
      type: "issuer_deterioration",
      sector: data.articles[0].sector ?? null,
      issuer,
      signal: `${data.articles.length} credit signals for ${issuer} in 72h — ${data.negCount} negative`,
      evidence: `Max urgency: ${data.maxUrgency}/10. ${data.covenantFlag ? "COVENANT FLAG ACTIVE. " : ""}Events: ${topEvents || "multiple"}`,
      implication: `${issuer} credit profile shows deterioration. Monitor spread levels, covenant headroom, and next debt maturity. Elevated downgrade risk if negative trend continues.`,
      articleCount: data.articles.length,
      severity,
      trendScore,
      trendStrength,
    });
  }

  // ── 3. Refinancing/liquidity wave ────────────────────────────────────────────
  // 2+ mentions of refinancing risk or liquidity stress (loosened from 3+)
  const refiAndLiqArticles = workingArticles.filter(
    (a) => (a.refinancingRisk || a.liquidityConcern) && isNegativeEvent(a)
  );
  if (refiAndLiqArticles.length >= 2) {
    const sectors = [...new Set(refiAndLiqArticles.map((a) => a.sector).filter(Boolean))];
    const trendScore = calcTrendScore(refiAndLiqArticles);
    const refi24h = articles24h.filter((a) => (a.refinancingRisk || a.liquidityConcern) && isNegativeEvent(a)).length;
    hardAlerts.push({
      type: "refinancing_wave",
      sector: sectors[0] ?? null,
      issuer: null,
      signal: `${refiAndLiqArticles.length} refinancing/liquidity stress events in 72h window`,
      evidence: `Affected sectors: ${sectors.slice(0, 3).join(", ") || "multiple"}. Maturity wall pressure and liquidity stress signals elevated.`,
      implication: "Maturity wall concerns intensifying. CLO managers should review near-term maturities in the portfolio. Increased probability of amend-and-extend transactions and distressed exchanges, which may widen loan spreads by 50-100bps.",
      articleCount: refiAndLiqArticles.length,
      severity: refiAndLiqArticles.length >= 4 ? "high" : "moderate",
      trendScore,
      trendStrength: calcTrendStrength(refiAndLiqArticles.length, refi24h),
    });
  }

  // ── 4. Downgrade wave ────────────────────────────────────────────────────────
  // 2+ downgrades in a sector (loosened from 3+)
  const sectorDowngrades = new Map<string, { count: number; articles: typeof workingArticles }>();
  for (const a of workingArticles) {
    if (!a.ratingIsDowngrade || !a.sector) continue;
    const b = sectorDowngrades.get(a.sector) ?? { count: 0, articles: [] };
    b.count++;
    b.articles.push(a);
    sectorDowngrades.set(a.sector, b);
  }
  for (const [sector, data] of sectorDowngrades.entries()) {
    if (data.count < 2) continue;
    const trendScore = calcTrendScore(data.articles);
    const down24h = articles24h.filter((a) => a.ratingIsDowngrade && a.sector === sector).length;
    hardAlerts.push({
      type: "downgrade_wave",
      sector,
      issuer: null,
      signal: `${data.count} rating downgrades in ${sector} over 72h`,
      evidence: `Concentrated rating agency activity signals systemic pressure in ${sector}.`,
      implication: `CCC bucket risk is elevated for ${sector} CLO exposure. Rating downgrades increase likelihood of spread widening by 75-125bps in lower-rated ${sector} cohort. Forced selling risk from IG crossover accounts.`,
      articleCount: data.count,
      severity: data.count >= 4 ? "critical" : "high",
      trendScore,
      trendStrength: calcTrendStrength(data.count, down24h),
    });
  }

  // ── 5. Emerging: 2 negative articles in same sector (not already hard trend) ─
  for (const [sector, data] of sectorMap.entries()) {
    const count = data.articles72h.length;
    const alreadyHard = hardAlerts.some((a) => a.type === "sector_cluster" && a.sector === sector);
    if (count === 2 && !alreadyHard) {
      // This is an emerging trend — promote to hard cluster but mark as watch
      const idx = hardAlerts.findIndex((a) => a.type === "sector_cluster" && a.sector === sector);
      if (idx === -1) {
        const trendStrength = calcTrendStrength(count, data.articles24h.length);
        emergingAlerts.push({
          type: "emerging",
          sector,
          issuer: null,
          signal: `Early stress indicators in ${sector} sector`,
          evidence: `${count} negative credit signals detected. Events: ${[...new Set(data.articles72h.map((a) => a.eventType).filter(Boolean))].slice(0, 2).join(", ") || "negative sentiment"}.`,
          implication: `Early signs of credit stress emerging in ${sector}. Monitor for additional negative signals — a third event would confirm a sector-wide credit stress cluster with likely spread implications.`,
          articleCount: count,
          severity: "watch",
          trendScore: calcTrendScore(data.articles72h),
          trendStrength,
        });
      }
    }
  }

  // ── 6. Fallback narrative ─────────────────────────────────────────────────────
  let fallbackNarrative: FallbackNarrative | null = null;
  if (hardAlerts.length === 0 && emergingAlerts.length === 0) {
    // Look at all articles in 72h for context
    const sectorNegCount = new Map<string, number>();
    for (const a of workingArticles) {
      if (a.sector && isNegativeEvent(a)) {
        sectorNegCount.set(a.sector, (sectorNegCount.get(a.sector) ?? 0) + 1);
      }
    }
    const topSectors = Array.from(sectorNegCount.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([s]) => s);

    const totalArticles = workingArticles.length;
    const negativeArticles = workingArticles.filter((a) => isNegativeEvent(a)).length;
    const covenantCount = workingArticles.filter((a) => a.covenantFlag).length;

    fallbackNarrative = {
      summary: topSectors.length > 0
        ? `No concentrated credit stress clusters detected in the 72h window, but ${topSectors.slice(0, 2).join(" and ")} show elevated negative sentiment. ${covenantCount > 0 ? `${covenantCount} covenant-related signal(s) flagged.` : "No covenant breaches flagged."} Monitor for further deterioration.`
        : `Credit markets appear relatively stable over the 72h window. ${totalArticles} articles analyzed, ${negativeArticles} with negative sentiment. No systemic stress clusters or issuer deterioration detected.`,
      sectorsToWatch: topSectors.length > 0 ? topSectors : ["Monitor macro indicators"],
      reasoning: totalArticles > 0
        ? `${totalArticles} articles analyzed across ${new Set(workingArticles.map((a) => a.sector).filter(Boolean)).size} sectors. Negative signals scattered — no single sector or issuer has reached the 2-event threshold for cluster detection.`
        : "No articles in the 72h window yet. Run a data refresh to populate the feed.",
    };
  }

  // ── Sort: severity then trendScore ──────────────────────────────────────────
  const severityOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, watch: 3 };
  const sortFn = (a: TrendAlert, b: TrendAlert) =>
    (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4) ||
    b.trendScore - a.trendScore;

  hardAlerts.sort(sortFn);
  emergingAlerts.sort(sortFn);

  return {
    hardAlerts,
    emergingAlerts,
    fallbackNarrative,
    allAlerts: [...hardAlerts, ...emergingAlerts],
    windowHours,
    articlesAnalyzed: workingArticles.length,
  };
}

// ── Debug data (Part 1) ───────────────────────────────────────────────────────
export async function getTrendsDebugData() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000);

  const allArticles = await db.select().from(articlesTable).where(gte(articlesTable.publishedAt, since72h));

  const sectorCounts: Record<string, number> = {};
  const eventTypeCounts: Record<string, number> = {};
  const negativeSentimentCounts: Record<string, number> = {};

  for (const a of allArticles) {
    if (a.sector) sectorCounts[a.sector] = (sectorCounts[a.sector] ?? 0) + 1;
    if (a.eventType) eventTypeCounts[a.eventType] = (eventTypeCounts[a.eventType] ?? 0) + 1;
    if ((a.sentiment === "negative" || (a.creditSignalScore ?? 0) >= 2) && a.sector) {
      negativeSentimentCounts[a.sector] = (negativeSentimentCounts[a.sector] ?? 0) + 1;
    }
  }

  return {
    articlesAnalyzed: allArticles.length,
    articlesLast24h: allArticles.filter((a) => new Date(a.publishedAt) >= since24h).length,
    articlesLast72h: allArticles.length,
    sectorCounts,
    eventTypeCounts,
    negativeSentimentCounts,
  };
}
