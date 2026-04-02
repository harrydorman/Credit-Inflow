import type { Article } from "@workspace/db";

export type SourceTier = "primary" | "secondary" | "tertiary";
export type TrustLabel = "high" | "medium" | "low";

export interface SourceProfile {
  displayName: string;
  tier: SourceTier;
  lowCostPriority: number;
  notes: string;
}

export interface EvidenceItem {
  type: "source" | "market" | "rating" | "covenant" | "metric" | "corroboration" | "timing";
  label: string;
  strength: TrustLabel;
  confirmed: boolean;
}

export interface TrustProfile {
  sourceTier: SourceTier;
  trustScore: number;
  trustLabel: TrustLabel;
  trustReasons: string[];
  evidenceCount: number;
  corroboratingArticleCount: number;
  primarySourcePresent: boolean;
}

export interface SignalCard {
  signalType: string;
  signalLabel: string;
  whyNow: string;
  keyEvidence: string[];
  creditImplications: string[];
  riskFlags: string[];
  confidence: TrustLabel;
  decisionUse: string;
}

export interface IssuerSnapshot {
  issuerName: string;
  articleCount: number;
  lastUpdated: string | null;
  sector: string | null;
  dominantSignal: string;
  trustLabel: TrustLabel;
  trend: "deteriorating" | "stable" | "improving";
  riskLevel: "high" | "medium" | "low";
  negativeSignalRatio: number;
  summary: string;
  keyDrivers: string[];
  keyRisks: string[];
  nextQuestions: string[];
}

export interface CreditPulse {
  riskTone: "Risk Off" | "Cautious" | "Balanced";
  totalSignals: number;
  negativeSignals: number;
  highTrustSignals: number;
  corroboratedSignals: number;
  primarySourceSignals: number;
}

const SOURCE_REGISTRY: Array<{ match: string[]; profile: SourceProfile }> = [
  {
    match: ["sec", "sec filing", "sec.gov", "8-k", "10-q", "10-k", "company release", "investor relations", "earnings call", "transcript"],
    profile: { displayName: "Primary filing / issuer disclosure", tier: "primary", lowCostPriority: 1, notes: "Cheapest reliable truth layer." },
  },
  {
    match: ["businesswire", "business wire", "prnewswire", "pr newswire", "globenewswire", "globe newswire", "press release"],
    profile: { displayName: "Press release wire", tier: "primary", lowCostPriority: 1, notes: "Issuer-originating disclosure; treat as company statement." },
  },
  {
    match: ["moody", "moodys", "fitch", "s&p", "standardandpoors", "kbra", "dbrs"],
    profile: { displayName: "Ratings agency", tier: "primary", lowCostPriority: 3, notes: "Very high value for rating action confirmation." },
  },
  {
    match: ["federal reserve", "treasury", "treasury.gov", "federalreserve", "bis.org", "imf.org", "ecb.europa.eu"],
    profile: { displayName: "Government / central bank", tier: "primary", lowCostPriority: 2, notes: "Authoritative macro layer." },
  },
  {
    match: ["reuters", "bloomberg", "wall street journal", "wsj.com", "wsj ", "financial times", "ft.com", " ft "],
    profile: { displayName: "Wire / institutional media", tier: "secondary", lowCostPriority: 2, notes: "Wire-standard verification; high reliability." },
  },
  {
    match: ["barron", "barrons", "barron's"],
    profile: { displayName: "Barron's (institutional quality)", tier: "secondary", lowCostPriority: 2, notes: "Dow Jones flagship investment periodical." },
  },
  {
    match: ["marketwatch", "market watch"],
    profile: { displayName: "MarketWatch", tier: "secondary", lowCostPriority: 3, notes: "Dow Jones / WSJ Media Group; solid credit and bond coverage." },
  },
  {
    match: ["cnbc"],
    profile: { displayName: "CNBC", tier: "secondary", lowCostPriority: 3, notes: "Broad financial TV network; useful for breaking news confirmation." },
  },
  {
    match: ["yahoo finance", "yahoo! finance", "finance.yahoo"],
    profile: { displayName: "Yahoo Finance", tier: "secondary", lowCostPriority: 4, notes: "Aggregates AP/Reuters wires; pricing and market-data reliable." },
  },
  {
    match: ["new york times", "nytimes"],
    profile: { displayName: "New York Times", tier: "secondary", lowCostPriority: 4, notes: "Good investigative depth; corroborate facts." },
  },
  {
    match: ["seeking alpha", "seekingalpha"],
    profile: { displayName: "Seeking Alpha", tier: "tertiary", lowCostPriority: 5, notes: "Contributor opinion; strong lead-gen but requires primary corroboration." },
  },
  {
    match: ["investing.com"],
    profile: { displayName: "Investing.com", tier: "tertiary", lowCostPriority: 5, notes: "Market aggregator; use for market price leads only." },
  },
];

const PRIMARY_SOURCES = SOURCE_REGISTRY.filter((r) => r.profile.tier === "primary").flatMap((r) => r.match);
const SECONDARY_SOURCES = SOURCE_REGISTRY.filter((r) => r.profile.tier === "secondary").flatMap((r) => r.match);

function textIncludesOneOf(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function canonicalizeIssuerName(issuerName: string | null | undefined): string | null {
  if (!issuerName) return null;
  return issuerName
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|holdings|group|co|company|plc|ltd|llc)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function hoursSince(date: Date | string): number {
  return Math.max(0, (Date.now() - new Date(date).getTime()) / 36e5);
}

function toTrustLabel(score: number): TrustLabel {
  if (score >= 80) return "high";
  if (score >= 65) return "medium";
  return "low";
}

export function getSourceProfile(source: string | null | undefined, url?: string | null): SourceProfile {
  const haystack = `${source ?? ""} ${url ?? ""}`.toLowerCase();
  for (const entry of SOURCE_REGISTRY) {
    if (textIncludesOneOf(haystack, entry.match)) return entry.profile;
  }
  return {
    displayName: source || "Other source",
    tier: "tertiary",
    lowCostPriority: 5,
    notes: "Treat as low-confidence lead generation until corroborated.",
  };
}

export function getSourceTier(source: string | null | undefined, url?: string | null): SourceTier {
  return getSourceProfile(source, url).tier;
}

export function findCorroboratingArticles(article: Article, universe: Article[] = []): Article[] {
  const issuerKey = canonicalizeIssuerName(article.issuerName);
  const eventType = article.eventType ?? null;
  return universe.filter((candidate) => {
    if (candidate.id === article.id) return false;
    const withinWindow = Math.abs(new Date(candidate.publishedAt).getTime() - new Date(article.publishedAt).getTime()) <= 1000 * 60 * 60 * 24 * 7;
    if (!withinWindow) return false;
    const candidateIssuerKey = canonicalizeIssuerName(candidate.issuerName);
    if (issuerKey && candidateIssuerKey && issuerKey === candidateIssuerKey) return true;
    if (eventType && candidate.eventType === eventType && article.sector && candidate.sector === article.sector) return true;
    return false;
  });
}

export function buildEvidenceItems(article: Article, universe: Article[] = []): EvidenceItem[] {
  const trustLabel = article.confidenceScore === "high" ? "high" : article.confidenceScore === "medium" ? "medium" : "low";
  const sourceProfile = getSourceProfile(article.source, article.url);
  const corroborating = findCorroboratingArticles(article, universe);
  const evidence: EvidenceItem[] = [
    {
      type: "source",
      label: `${sourceProfile.displayName} (${sourceProfile.tier})`,
      strength: sourceProfile.tier === "primary" ? "high" : sourceProfile.tier === "secondary" ? "medium" : "low",
      confirmed: sourceProfile.tier !== "tertiary",
    },
    {
      type: "timing",
      label: `Published ${hoursSince(article.publishedAt) < 24 ? "within the last day" : `${Math.round(hoursSince(article.publishedAt) / 24)}d ago`}`,
      strength: hoursSince(article.publishedAt) <= 48 ? "high" : hoursSince(article.publishedAt) <= 168 ? "medium" : "low",
      confirmed: true,
    },
  ];

  if (article.ratingMentioned) {
    evidence.push({
      type: "rating",
      label: `Rating evidence: ${article.ratingMentioned}${article.ratingAgency ? ` via ${article.ratingAgency}` : ""}`,
      strength: article.ratingIsDowngrade || article.ratingIsCCCThreshold ? "high" : "medium",
      confirmed: true,
    });
  }

  if (article.covenantFlag) {
    evidence.push({
      type: "covenant",
      label: `Covenant pressure${article.covenantType ? `: ${article.covenantType}` : " flagged"}`,
      strength: "high",
      confirmed: true,
    });
  }

  for (const metric of article.creditSummaryJson?.keyMetricsMentioned?.slice(0, 3) ?? []) {
    evidence.push({ type: "metric", label: metric, strength: "medium", confirmed: true });
  }

  if (article.marketValidationSignal) {
    evidence.push({
      type: "market",
      label:
        article.marketValidationSignal === "confirmed"
          ? "Market reaction aligned with narrative"
          : article.marketValidationSignal === "mixed"
            ? "Market action diverged from narrative"
            : "Market confirmation limited",
      strength: trustLabel,
      confirmed: article.marketValidationSignal === "confirmed",
    });
  }

  if (corroborating.length > 0) {
    evidence.push({
      type: "corroboration",
      label: `${corroborating.length} corroborating article${corroborating.length === 1 ? "" : "s"} in recent window`,
      strength: corroborating.length >= 2 ? "high" : "medium",
      confirmed: true,
    });
  }

  return evidence;
}

export function buildTrustProfile(article: Article, universe: Article[] = []): TrustProfile {
  const sourceProfile = getSourceProfile(article.source, article.url);
  const reasons: string[] = [
    sourceProfile.tier === "primary"
      ? "Primary source or official disclosure."
      : sourceProfile.tier === "secondary"
        ? "Reputable secondary publisher."
        : "Tertiary source; treat as lead generation until corroborated.",
  ];

  let score = sourceProfile.tier === "primary" ? 88 : sourceProfile.tier === "secondary" ? 74 : 54;

  const contentLength = article.rawContent?.length ?? 0;
  if (contentLength >= 500) {
    score += 7;
    reasons.push("Sufficient source depth for extraction.");
  } else if (contentLength >= 220) {
    score += 2;
    reasons.push("Moderate source context available.");
  } else {
    score -= 8;
    reasons.push("Thin RSS/headline context limits certainty.");
  }

  const evidenceItems = buildEvidenceItems(article, universe);
  const confirmedEvidence = evidenceItems.filter((item) => item.confirmed).length;
  score += Math.min(confirmedEvidence * 3, 15);
  if (confirmedEvidence >= 3) reasons.push("Multiple evidence points support the signal.");

  const corroboratingArticles = findCorroboratingArticles(article, universe);
  if (corroboratingArticles.length > 0) {
    score += Math.min(corroboratingArticles.length * 4, 12);
    reasons.push(`Corroborated by ${corroboratingArticles.length} related article${corroboratingArticles.length === 1 ? "" : "s"}.`);
  }

  if (article.marketValidationSignal === "confirmed") {
    score += 6;
    reasons.push("Market action broadly aligned with the thesis.");
  } else if (article.marketValidationSignal === "mixed") {
    score -= 3;
    reasons.push("Market action partially diverged from the thesis.");
  }

  if (!article.processedAt) {
    score -= 15;
    reasons.push("Not fully processed by intelligence pipeline.");
  }

  const ageHours = hoursSince(article.publishedAt);
  if (ageHours > 168) {
    score -= 5;
    reasons.push("Signal is aging; recency value is lower.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    sourceTier: sourceProfile.tier,
    trustScore: score,
    trustLabel: toTrustLabel(score),
    trustReasons: reasons,
    evidenceCount: evidenceItems.length,
    corroboratingArticleCount: corroboratingArticles.length,
    primarySourcePresent: sourceProfile.tier === "primary" || corroboratingArticles.some((a) => getSourceTier(a.source, a.url) === "primary"),
  };
}

function getSignalType(article: Article): string {
  if (article.ratingIsDowngrade) return "downgrade_risk";
  if (article.refinancingRisk) return "refinancing_risk";
  if (article.covenantFlag) return "covenant_pressure";
  if (article.distressedRisk) return "distress_warning";
  if (article.sentiment === "positive") return "credit_improvement";
  if (article.sentiment === "negative") return "credit_deterioration";
  return article.eventType ?? "market_update";
}

function formatSignalLabel(signalType: string): string {
  return signalType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildDecisionUse(article: Article): string {
  if (article.ratingIsDowngrade || article.ratingIsCCCThreshold) return "Review downgrade path and forced-selling risk.";
  if (article.refinancingRisk) return "Check maturity ladder, liquidity runway, and refinancing windows.";
  if (article.covenantFlag) return "Review doc set, cure rights, and waiver probability.";
  if (article.distressedRisk) return "Escalate to special situations / stressed bucket review.";
  return "Use as context for issuer monitoring and sector positioning.";
}

export function rankSignalStrength(article: Article, universe: Article[] = []): number {
  const trust = buildTrustProfile(article, universe);
  const urgency = article.finalUrgencyScore ?? article.urgencyScore ?? 0;
  const signalScore = article.creditSignalScore ?? 0;
  const negativeBias = article.sentiment === "negative" ? 1.5 : article.sentiment === "positive" ? -0.75 : 0;
  const corroboration = trust.corroboratingArticleCount * 0.75;
  return Number((urgency + signalScore + trust.trustScore / 12 + negativeBias + corroboration).toFixed(2));
}

export function buildSignalCard(article: Article, universe: Article[] = []): SignalCard {
  const trust = buildTrustProfile(article, universe);
  const signalType = getSignalType(article);
  const evidence = buildEvidenceItems(article, universe);
  const implications: string[] = [];
  const riskFlags: string[] = [];

  if (article.spreadWideningRisk) implications.push("Higher probability of spread widening.");
  if (article.refinancingRisk) implications.push("Refinancing window deserves active monitoring.");
  if (article.liquidityConcern) implications.push("Liquidity cushion may be weakening.");
  if (article.forcedSellingRisk) implications.push("Positioning could be pressured by technical selling.");
  if (article.cloImpact) implications.push("Potential knock-on effects for CLO portfolios.");
  if (implications.length === 0 && article.whyItMatters) implications.push(article.whyItMatters);

  if (article.ratingIsCCCThreshold) riskFlags.push("CCC-threshold risk");
  if (article.forcedSellingRisk) riskFlags.push("Forced-selling risk");
  if (article.distressedRisk) riskFlags.push("Distressed watch");
  if (article.earningsMiss) riskFlags.push("Weak operating trend");
  if (trust.primarySourcePresent) riskFlags.push("Primary-source-backed");

  return {
    signalType,
    signalLabel: formatSignalLabel(signalType),
    whyNow: article.creditSummaryJson?.bottomLine || article.whyItMatters || article.summary || article.title,
    keyEvidence: evidence.map((item) => item.label).slice(0, 4),
    creditImplications: implications.slice(0, 4),
    riskFlags,
    confidence: trust.trustLabel,
    decisionUse: buildDecisionUse(article),
  };
}

function buildDominantSignalLabel(articles: Article[]): string {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const signal = getSignalType(article);
    counts.set(signal, (counts.get(signal) ?? 0) + 1);
  }
  const [top] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return top ? formatSignalLabel(top[0]) : "Monitoring";
}

export function buildIssuerSnapshot(issuerName: string, articles: Article[]): IssuerSnapshot {
  const sorted = [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const latest = sorted[0];
  const negativeCount = sorted.filter((a) => a.sentiment === "negative").length;
  const positiveCount = sorted.filter((a) => a.sentiment === "positive").length;
  const avgTrust = sorted.length > 0 ? sorted.reduce((sum, article) => sum + buildTrustProfile(article, articles).trustScore, 0) / sorted.length : 0;
  const avgUrgencyRecent = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))).reduce((sum, a) => sum + (a.finalUrgencyScore ?? a.urgencyScore ?? 0), 0) / Math.max(1, Math.ceil(sorted.length / 2));
  const avgUrgencyOlder = sorted.slice(Math.max(1, Math.ceil(sorted.length / 2))).reduce((sum, a) => sum + (a.finalUrgencyScore ?? a.urgencyScore ?? 0), 0) / Math.max(1, sorted.length - Math.max(1, Math.ceil(sorted.length / 2)));
  const trend: IssuerSnapshot["trend"] = avgUrgencyRecent - avgUrgencyOlder >= 1 ? "deteriorating" : avgUrgencyRecent - avgUrgencyOlder <= -1 ? "improving" : "stable";
  const riskLevel: IssuerSnapshot["riskLevel"] = negativeCount / Math.max(sorted.length, 1) >= 0.6 || sorted.some((a) => a.distressedRisk || a.ratingIsCCCThreshold) ? "high" : negativeCount / Math.max(sorted.length, 1) >= 0.35 ? "medium" : "low";

  const keyDrivers = Array.from(new Set(sorted.flatMap((a) => a.creditSummaryJson?.creditDrivers ?? []).filter(Boolean))).slice(0, 4);
  const keyRisks = Array.from(new Set(sorted.flatMap((a) => {
    const out: string[] = [...(a.creditSummaryJson?.riskFactors ?? [])];
    if (a.refinancingRisk) out.push("Refinancing risk elevated");
    if (a.liquidityConcern) out.push("Liquidity pressure possible");
    if (a.ratingIsDowngrade) out.push("Rating pressure / downgrade path");
    if (a.covenantFlag) out.push(`Covenant stress${a.covenantType ? ` (${a.covenantType})` : ""}`);
    return out;
  }))).slice(0, 4);

  const nextQuestions = [
    sorted.some((a) => a.refinancingRisk) ? "What debt maturities or amendment windows come next?" : null,
    sorted.some((a) => a.liquidityConcern) ? "How much unrestricted liquidity remains versus near-term uses?" : null,
    sorted.some((a) => a.ratingIsDowngrade || a.ratingIsCCCThreshold) ? "Is there a risk of mandate-driven or index-driven selling?" : null,
    sorted.some((a) => a.covenantFlag) ? "What is the waiver / cure path under the credit agreement?" : null,
  ].filter(Boolean) as string[];

  const summary = latest
    ? latest.creditSummaryJson?.bottomLine || latest.whyItMatters || latest.summary || latest.title
    : `No recent intelligence for ${issuerName}.`;

  return {
    issuerName,
    articleCount: sorted.length,
    lastUpdated: latest?.publishedAt ? new Date(latest.publishedAt).toISOString() : null,
    sector: latest?.sector ?? null,
    dominantSignal: buildDominantSignalLabel(sorted),
    trustLabel: toTrustLabel(avgTrust),
    trend,
    riskLevel,
    negativeSignalRatio: Number((negativeCount / Math.max(sorted.length, 1)).toFixed(2)),
    summary,
    keyDrivers: keyDrivers.length > 0 ? keyDrivers : [positiveCount > 0 ? "Mixed/offsetting developments across recent coverage" : "Monitoring for new issuer-specific developments"],
    keyRisks: keyRisks.length > 0 ? keyRisks : [riskLevel === "high" ? "Negative signals dominate recent flow" : "No immediate acute credit trigger surfaced"],
    nextQuestions: nextQuestions.length > 0 ? nextQuestions : ["What new evidence would materially change the credit view from here?"],
  };
}

export function buildCreditPulse(articles: Article[], universe: Article[] = articles): CreditPulse {
  const negativeSignals = articles.filter((a) => a.sentiment === "negative").length;
  const trustProfiles = articles.map((a) => buildTrustProfile(a, universe));
  const highTrustSignals = trustProfiles.filter((t) => t.trustLabel === "high").length;
  const corroboratedSignals = trustProfiles.filter((t) => t.corroboratingArticleCount > 0).length;
  const primarySourceSignals = trustProfiles.filter((t) => t.primarySourcePresent).length;

  const riskTone: CreditPulse["riskTone"] =
    negativeSignals >= Math.max(5, Math.round(articles.length * 0.55))
      ? "Risk Off"
      : negativeSignals >= Math.max(3, Math.round(articles.length * 0.35))
        ? "Cautious"
        : "Balanced";

  return {
    riskTone,
    totalSignals: articles.length,
    negativeSignals,
    highTrustSignals,
    corroboratedSignals,
    primarySourceSignals,
  };
}

export function enrichArticle<T extends Article>(article: T, universe: Article[] = []): T & {
  trustProfile: TrustProfile;
  signalCard: SignalCard;
  evidenceItems: EvidenceItem[];
  issuerSnapshot: IssuerSnapshot | null;
  signalStrength: number;
  sourceProfile: SourceProfile;
} {
  const issuerArticles = article.issuerName
    ? universe.filter((candidate) => canonicalizeIssuerName(candidate.issuerName) === canonicalizeIssuerName(article.issuerName))
    : [];

  return {
    ...article,
    trustProfile: buildTrustProfile(article, universe),
    signalCard: buildSignalCard(article, universe),
    evidenceItems: buildEvidenceItems(article, universe),
    issuerSnapshot: article.issuerName && issuerArticles.length > 0 ? buildIssuerSnapshot(article.issuerName, issuerArticles) : null,
    signalStrength: rankSignalStrength(article, universe),
    sourceProfile: getSourceProfile(article.source, article.url),
  };
}
