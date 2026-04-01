import { db, articlesTable } from "@workspace/db";
import { gte, isNotNull } from "drizzle-orm";

export interface TrendAlert {
  type: "sector_cluster" | "issuer_deterioration" | "refinancing_wave" | "downgrade_wave";
  sector: string | null;
  issuer: string | null;
  signal: string;
  evidence: string;
  implication: string;
  articleCount: number;
  severity: "critical" | "high" | "moderate";
}

export async function detectTrends(windowHours = 72): Promise<TrendAlert[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const articles = await db
    .select()
    .from(articlesTable)
    .where(gte(articlesTable.publishedAt, since));

  const alerts: TrendAlert[] = [];

  // ── 1. Sector clustering: 3+ negative events in same sector ─────────────────
  const sectorNeg = new Map<string, { count: number; events: string[]; covenants: number; downgrades: number }>();
  for (const a of articles) {
    if (!a.sector || a.sentiment !== "negative") continue;
    const bucket = sectorNeg.get(a.sector) ?? { count: 0, events: [], covenants: 0, downgrades: 0 };
    bucket.count++;
    if (a.eventType) bucket.events.push(a.eventType);
    if (a.covenantFlag) bucket.covenants++;
    if (a.ratingIsDowngrade) bucket.downgrades++;
    sectorNeg.set(a.sector, bucket);
  }

  for (const [sector, data] of sectorNeg.entries()) {
    if (data.count < 3) continue;
    const topEvents = [...new Set(data.events)].slice(0, 3).join(", ");
    const severity = data.covenants > 0 || data.count >= 5 ? "critical" : data.count >= 4 ? "high" : "moderate";
    alerts.push({
      type: "sector_cluster",
      sector,
      issuer: null,
      signal: `${data.count} negative credit events in ${sector} sector over ${windowHours}h`,
      evidence: `Event types: ${topEvents}. ${data.covenants > 0 ? `${data.covenants} covenant breach(es). ` : ""}${data.downgrades > 0 ? `${data.downgrades} downgrade(s).` : ""}`,
      implication: `Elevated sector-wide stress. Monitor HY exposure to ${sector}. Potential for spread widening and rating agency reviews.`,
      articleCount: data.count,
      severity,
    });
  }

  // ── 2. Issuer deterioration: multiple negative events for same issuer ─────────
  const issuerNeg = new Map<string, { count: number; maxUrgency: number; covenantFlag: boolean; events: string[] }>();
  for (const a of articles) {
    if (!a.issuerName) continue;
    const bucket = issuerNeg.get(a.issuerName) ?? { count: 0, maxUrgency: 1, covenantFlag: false, events: [] };
    if (a.sentiment === "negative") bucket.count++;
    if ((a.finalUrgencyScore ?? a.urgencyScore ?? 0) > bucket.maxUrgency) {
      bucket.maxUrgency = a.finalUrgencyScore ?? a.urgencyScore ?? 1;
    }
    if (a.covenantFlag) bucket.covenantFlag = true;
    if (a.eventType) bucket.events.push(a.eventType);
    issuerNeg.set(a.issuerName, bucket);
  }

  for (const [issuer, data] of issuerNeg.entries()) {
    if (data.count < 2) continue;
    const severity = data.covenantFlag ? "critical" : data.maxUrgency >= 7 ? "high" : "moderate";
    alerts.push({
      type: "issuer_deterioration",
      sector: null,
      issuer,
      signal: `${data.count} negative signals for ${issuer} in ${windowHours}h`,
      evidence: `Max urgency: ${data.maxUrgency}/10. ${data.covenantFlag ? "COVENANT FLAG ACTIVE. " : ""}Events: ${[...new Set(data.events)].slice(0, 3).join(", ")}`,
      implication: `${issuer} shows deteriorating credit profile. Monitor closely for downgrade triggers and covenant headroom.`,
      articleCount: data.count,
      severity,
    });
  }

  // ── 3. Refinancing wave: 3+ refinancing risk events in window ─────────────────
  const refArticles = articles.filter((a) => a.refinancingRisk && a.sentiment === "negative");
  if (refArticles.length >= 3) {
    const sectors = [...new Set(refArticles.map((a) => a.sector).filter(Boolean))];
    alerts.push({
      type: "refinancing_wave",
      sector: sectors[0] ?? null,
      issuer: null,
      signal: `${refArticles.length} refinancing risk events detected in ${windowHours}h window`,
      evidence: `Affected sectors: ${sectors.slice(0, 3).join(", ")}. Maturity wall and liquidity pressure signals elevated.`,
      implication: "Maturity wall concerns rising. CLO managers should flag near-term maturities in portfolio. Increased risk of amend-and-extend or distressed exchange.",
      articleCount: refArticles.length,
      severity: refArticles.length >= 5 ? "high" : "moderate",
    });
  }

  // ── 4. Downgrade wave: 3+ downgrades in same sector ──────────────────────────
  const sectorDowngrades = new Map<string, number>();
  for (const a of articles) {
    if (a.ratingIsDowngrade && a.sector) {
      sectorDowngrades.set(a.sector, (sectorDowngrades.get(a.sector) ?? 0) + 1);
    }
  }
  for (const [sector, count] of sectorDowngrades.entries()) {
    if (count < 3) continue;
    alerts.push({
      type: "downgrade_wave",
      sector,
      issuer: null,
      signal: `${count} rating downgrades in ${sector} over ${windowHours}h`,
      evidence: `Cluster of rating agency actions signals systemic sector pressure.`,
      implication: `CCC bucket risk elevated for ${sector} CLO exposure. Expect spread widening and potential forced selling from investment-grade crossover investors.`,
      articleCount: count,
      severity: count >= 5 ? "critical" : "high",
    });
  }

  // Sort by severity then article count
  const severityOrder = { critical: 0, high: 1, moderate: 2 };
  return alerts.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] ||
    b.articleCount - a.articleCount
  );
}
