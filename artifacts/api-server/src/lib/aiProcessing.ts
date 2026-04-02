import { logger } from "./logger";
import { normalizeEventType } from "./eventNormalization";

const OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const SECTORS = [
  "Retail", "Technology", "Energy", "Healthcare", "Real Estate",
  "Financial Services", "Consumer Discretionary", "Industrials", "Materials",
  "Utilities", "Telecom", "Media", "Transportation", "Gaming", "Other",
];

const EVENT_TYPES = [
  "downgrade", "earnings", "default risk", "refinancing", "M&A", "macro",
  "bankruptcy", "debt issuance", "spread widening", "rating action",
  "restructuring", "covenant breach", "other",
];

// Noise reduction: minimum keyword score before sending to OpenAI
// Expanded keyword list (Part 9)
const NOISE_FILTER_KEYWORDS: Record<string, number> = {
  // High signal (3 points each)
  "covenant": 3, "default": 3, "bankruptcy": 3, "restructuring": 3,
  "downgrade": 3, "distressed": 3, "chapter 11": 3, "distressed exchange": 3,
  "creditor protection": 3, "insolvency": 3,
  // Medium signal (2 points each)
  "refinanc": 2, "maturity wall": 2, "liquidity": 2, "leverage": 2,
  "ccc": 2, "junk": 2, "high yield": 2, "leveraged loan": 2,
  "clo": 2, "credit rating": 2, "spread": 2, "yield": 2,
  "liquidity crunch": 2, "debt load": 2, "leverage ratio": 2,
  "interest coverage": 2, "debt restructuring": 2, "amend and extend": 2,
  "maturity pressure": 2, "near default": 2, "debt maturity": 2,
  // Base signal (1 point each)
  "bond": 1, "debt": 1, "rating": 1, "credit": 1, "loan": 1,
  "interest rate": 1, "fed": 1, "treasury": 1, "moody": 1,
  "fitch": 1, "s&p": 1, "earnings": 1, "revenue miss": 1,
  "downgraded": 1, "rating cut": 1, "cut to junk": 1, "weak earnings": 1,
};
const NOISE_FILTER_THRESHOLD = 2;

export function passesNoiseFilter(title: string, content: string | null): boolean {
  const text = `${title} ${content ?? ""}`.toLowerCase();
  let score = 0;
  for (const [kw, pts] of Object.entries(NOISE_FILTER_KEYWORDS)) {
    if (text.includes(kw)) score += pts;
    if (score >= NOISE_FILTER_THRESHOLD) return true;
  }
  return false;
}

// ── Credit title override ─────────────────────────────────────────────────────
// Titles that contain high-value credit keywords or major credit-market firms
// bypass the noise filter even when content is short.  The global threshold
// is never lowered — this is a targeted allowlist, not a blanket loosening.
const CREDIT_OVERRIDE_KEYWORDS = [
  "credit", "clo", "private credit", "fund redemption",
  "rate hike", "default", "downgrade", "leveraged loan",
  "high yield", "junk bond", "maturity wall", "covenant",
  "bankruptcy", "restructuring", "refinanc", "distressed",
  "spread widen", "credit fund", "debt load", "loan fund",
  "bond fund", "credit market", "credit spread", "debt capital",
  "fixed income", "investment grade",
];

const CREDIT_OVERRIDE_FIRMS = [
  "kkr", "goldman", "blackstone", "apollo", "ares", "blue owl",
  "carlyle", "bain capital", "oaktree", "pimco", "blackrock",
  "citadel", "cerberus", "fortress", "warburg", "sixth street",
  "tiger global", "advent international", "the carlyle",
];

export function isCreditTitleOverride(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    CREDIT_OVERRIDE_KEYWORDS.some((kw) => lower.includes(kw)) ||
    CREDIT_OVERRIDE_FIRMS.some((firm) => lower.includes(firm))
  );
}

// ── Hybrid urgency scoring ────────────────────────────────────────────────────
function computeFinalUrgencyScore(
  aiScore: number,
  eventType: string,
  sentiment: string,
  covenantFlag: boolean,
  ratingIsCCC: boolean,
  liquidityConcern: boolean,
  refinancingRisk: boolean,
  earningsMiss: boolean,
  leverageMentioned: boolean,
  distressedRisk: boolean,
): number {
  let score = aiScore;
  if (eventType === "bankruptcy" || eventType === "restructuring") score += 5;
  if (ratingIsCCC) score += 3;
  if (covenantFlag) score += 3;
  if (liquidityConcern || refinancingRisk) score += 2;
  if (earningsMiss && leverageMentioned) score += 2;
  if (sentiment === "negative") score += 1;
  if (distressedRisk) score += 1;
  return Math.min(10, score);
}

// ── Credit signal score ───────────────────────────────────────────────────────
function computeCreditSignalScore(
  eventType: string,
  covenantFlag: boolean,
  refinancingRisk: boolean,
  liquidityConcern: boolean,
  distressedRisk: boolean,
  ratingIsDowngrade: boolean,
  sentiment: string,
): number {
  let score = 0;
  if (ratingIsDowngrade) score += 3;
  if (covenantFlag) score += 3;
  if (refinancingRisk) score += 2;
  if (liquidityConcern) score += 2;
  if (distressedRisk) score += 2;
  if (eventType === "downgrade" || eventType === "rating action") score += 2;
  if (sentiment === "positive") score -= 1;
  return score;
}

export interface AIAnalysis {
  summary: string;
  sector: string;
  eventType: string;
  sentiment: "positive" | "negative" | "neutral";
  whyItMatters: string;
  whoCares: string[];
  issuerName: string | null;

  // Trade
  tradeDirection: "positive" | "negative" | "neutral";
  tradeRationale: string;
  potentialTrades: string[];
  marketsImpacted: string[];

  // Credit metrics
  leverageMentioned: boolean;
  liquidityConcern: boolean;
  refinancingRisk: boolean;
  earningsMiss: boolean;

  // Rating
  ratingMentioned: string | null;
  ratingAgency: string | null;
  ratingIsDowngrade: boolean;
  ratingIsUpgrade: boolean;
  ratingIsCCCThreshold: boolean;

  // Covenant
  covenantFlag: boolean;
  covenantType: string | null;

  // CLO
  cloImpact: boolean;
  cloRelevance: "high" | "medium" | "low";
  cloImpactTypes: string[];
  cloWarfImpact: "increase" | "decrease" | "neutral";
  cloCCCBucketRisk: boolean;
  cloLoanVsBond: "loan" | "bond" | "mixed";
  cloExplanation: string;

  // Market technical
  spreadWideningRisk: boolean;
  forcedSellingRisk: boolean;
  distressedRisk: boolean;

  // Market impact
  marketImpact: "high" | "medium" | "low";

  // Scores
  urgencyScore: number;       // AI 1-5
  finalUrgencyScore: number;  // Hybrid 1-10 (= creditRiskScore)
  creditSignalScore: number;

  // Structured outputs (new)
  creditSummary: {
    situation: string;
    creditDrivers: string[];
    riskFactors: string[];
    keyMetricsMentioned: string[];
    bottomLine: string;
  } | null;
  scoreExplanation: {
    creditRisk: string;
    marketSignal: string;
    cloImpact: string;
  } | null;
}

export async function analyzeArticle(
  title: string,
  content: string | null
): Promise<AIAnalysis | null> {
  if (!OPENAI_API_KEY) {
    logger.warn("No OpenAI API key configured, skipping AI analysis");
    return null;
  }

  const articleText = [title, content].filter(Boolean).join("\n\n");

  const prompt = `You are a senior credit portfolio manager with 20+ years trading high yield bonds and leveraged loans. You have deep expertise in CLO structuring, covenant analysis, and distressed credit.

Your job is NOT to write a generic summary. Your job is to determine whether this article changes the credit view.

Critical grounding rules:
- Use only information explicitly present in the provided title/content.
- Do not invent spreads, leverage multiples, maturity dates, ratings, or other numbers that are not stated.
- If the source is thin (headline or RSS snippet), lower confidence in your wording and avoid over-claiming.
- Separate confirmed facts from inference.
- Prefer concise, evidence-backed language over dramatic language.

Article:
${articleText.slice(0, 3500)}

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "summary": "2-4 sentence evidence-backed credit summary. Mention ratings, leverage multiples, maturity walls, or debt metrics only if explicitly present in the text.",
  "sector": "one of: ${SECTORS.join(", ")}",
  "eventType": "one of: ${EVENT_TYPES.join(", ")}",
  "sentiment": "positive | negative | neutral (strictly from a bondholder/credit investor perspective)",
  "whyItMatters": "2-3 sentences on what changes for creditors now. Distinguish confirmed facts from your inference where needed.",

  "tradeImplication": {
    "direction": "positive | negative | neutral",
    "marketsImpacted": ["e.g. HY bonds", "leveraged loans", "CDS", "CLO equity"],
    "rationale": "specific credit rationale tied to facts in the text; if evidence is weak, say that clearly",
    "potentialTrades": ["e.g. 'Short CDS protection on B-rated issuer', 'Sell BB/B loans ahead of downgrade', 'Buy HY ETF puts']"
  },

  "whoCares": ["Credit Analysts", "Fixed Income Traders", "Portfolio Managers", "CLO Managers", "Risk Officers", "Distressed Debt Investors"],

  "issuerName": "specific company/issuer or null for pure macro",

  "creditMetrics": {
    "leverageMentioned": true/false,
    "liquidityConcern": true/false,
    "refinancingRisk": true/false,
    "earningsMiss": true/false
  },

  "ratingAnalysis": {
    "ratingMentioned": "e.g. B2, BB+, CCC or null",
    "ratingAgency": "Moody's | S&P | Fitch | null",
    "isDowngrade": true/false,
    "isUpgrade": true/false,
    "isCCCThreshold": true/false
  },

  "covenantAnalysis": {
    "covenantFlag": true/false,
    "covenantType": "e.g. 'financial maintenance covenant', 'restricted payments', 'PIK toggle', 'cure right exercised' or null"
  },

  "cloAnalysis": {
    "relevance": "high | medium | low",
    "impactType": ["e.g. 'CCC bucket pressure', 'WARF deterioration', 'OC test breach risk', 'par value loss'],
    "warfImpact": "increase | decrease | neutral",
    "cccBucketRisk": true/false,
    "loanVsBond": "loan | bond | mixed",
    "explanation": "1-2 sentences on specific CLO structural implications. Name specific CLO metrics affected (WARF, OC ratio, CCC bucket %)"
  },

  "marketTechnicalSignals": {
    "spreadWideningRisk": true/false,
    "forcedSellingRisk": true/false,
    "distressedRisk": true/false
  },

  "marketImpact": "high | medium | low",
  "urgencyScoreAI": 1-5,

  "creditSummary": {
    "situation": "1-2 sentences: what is happening to this issuer/sector, with only the specific numbers that are actually in the text",
    "creditDrivers": ["primary credit driver 1", "primary credit driver 2"],
    "riskFactors": ["downside risk 1", "downside risk 2"],
    "keyMetricsMentioned": ["e.g. 'leverage 6.5x EBITDA'", "'CCC bucket at 8%'", "'$2.1B maturity in 2026'"],
    "bottomLine": "1-sentence credit verdict using measured language; avoid certainty when evidence is limited"
  },

  "scoreExplanation": {
    "creditRisk": "why this credit risk score — cite specific event type, covenant status, or default proximity",
    "marketSignal": "what market data or price action confirms/contradicts this credit thesis",
    "cloImpact": "specific CLO implications: which WARF bucket, OC test pressure, or CCC % impact"
  }
}`;

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.15,
        max_tokens: 1600,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, "OpenAI API error");
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonStr = raw
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (!parsed.summary || !parsed.sector || !parsed.eventType || !parsed.sentiment) {
      logger.warn({ parsed }, "AI response missing required fields");
      return null;
    }

    const sentiment = ["positive", "negative", "neutral"].includes(parsed.sentiment as string)
      ? (parsed.sentiment as "positive" | "negative" | "neutral")
      : "neutral";

    // Normalize the eventType (handles variants like "downgraded", "rating cut", etc.)
    const rawEventType = parsed.eventType as string;
    const normalizedEventType = normalizeEventType(rawEventType) ?? rawEventType;
    const eventType = EVENT_TYPES.includes(normalizedEventType)
      ? normalizedEventType : (EVENT_TYPES.includes(rawEventType) ? rawEventType : "other");

    const tradeImpl = (parsed.tradeImplication ?? {}) as Record<string, unknown>;
    const creditMetrics = (parsed.creditMetrics ?? {}) as Record<string, unknown>;
    const ratingAnalysis = (parsed.ratingAnalysis ?? {}) as Record<string, unknown>;
    const covenantAnalysis = (parsed.covenantAnalysis ?? {}) as Record<string, unknown>;
    const cloAnalysis = (parsed.cloAnalysis ?? {}) as Record<string, unknown>;
    const marketTech = (parsed.marketTechnicalSignals ?? {}) as Record<string, unknown>;

    const covenantFlag = Boolean(covenantAnalysis.covenantFlag);
    const ratingIsCCC = Boolean(ratingAnalysis.isCCCThreshold);
    const liquidityConcern = Boolean(creditMetrics.liquidityConcern);
    const refinancingRisk = Boolean(creditMetrics.refinancingRisk);
    const earningsMiss = Boolean(creditMetrics.earningsMiss);
    const leverageMentioned = Boolean(creditMetrics.leverageMentioned);
    const distressedRisk = Boolean(marketTech.distressedRisk);
    const ratingIsDowngrade = Boolean(ratingAnalysis.isDowngrade);

    const aiScore = Math.min(5, Math.max(1, Number(parsed.urgencyScoreAI) || 2));
    const finalUrgencyScore = computeFinalUrgencyScore(
      aiScore, eventType, sentiment, covenantFlag, ratingIsCCC,
      liquidityConcern, refinancingRisk, earningsMiss, leverageMentioned, distressedRisk,
    );
    const creditSignalScore = computeCreditSignalScore(
      eventType, covenantFlag, refinancingRisk, liquidityConcern,
      distressedRisk, ratingIsDowngrade, sentiment,
    );

    const cloRelevanceRaw = cloAnalysis.relevance as string;
    const cloRelevance = ["high", "medium", "low"].includes(cloRelevanceRaw)
      ? (cloRelevanceRaw as "high" | "medium" | "low") : "low";

    const cloWarfRaw = (cloAnalysis.warfImpact ?? cloAnalysis.warFImpact) as string;
    const cloWarfImpact = ["increase", "decrease", "neutral"].includes(cloWarfRaw)
      ? (cloWarfRaw as "increase" | "decrease" | "neutral") : "neutral";

    const cloLoanVsBondRaw = cloAnalysis.loanVsBond as string;
    const cloLoanVsBond = ["loan", "bond", "mixed"].includes(cloLoanVsBondRaw)
      ? (cloLoanVsBondRaw as "loan" | "bond" | "mixed") : "mixed";

    const marketImpactRaw = parsed.marketImpact as string;
    const marketImpact = ["high", "medium", "low"].includes(marketImpactRaw)
      ? (marketImpactRaw as "high" | "medium" | "low") : "medium";

    const tradeDirectionRaw = tradeImpl.direction as string;
    const tradeDirection = ["positive", "negative", "neutral"].includes(tradeDirectionRaw)
      ? (tradeDirectionRaw as "positive" | "negative" | "neutral") : "neutral";

    const whoCares = Array.isArray(parsed.whoCares)
      ? (parsed.whoCares as string[])
      : typeof parsed.whoCares === "string"
        ? (parsed.whoCares as string).split(",").map((s: string) => s.trim())
        : [];

    return {
      summary: parsed.summary as string,
      sector: SECTORS.includes(parsed.sector as string) ? (parsed.sector as string) : "Other",
      eventType,
      sentiment,
      whyItMatters: (parsed.whyItMatters as string) ?? "",
      whoCares,
      issuerName: typeof parsed.issuerName === "string" ? parsed.issuerName : null,

      tradeDirection,
      tradeRationale: (tradeImpl.rationale as string) ?? "",
      potentialTrades: Array.isArray(tradeImpl.potentialTrades) ? (tradeImpl.potentialTrades as string[]) : [],
      marketsImpacted: Array.isArray(tradeImpl.marketsImpacted) ? (tradeImpl.marketsImpacted as string[]) : [],

      leverageMentioned,
      liquidityConcern,
      refinancingRisk,
      earningsMiss,

      ratingMentioned: typeof ratingAnalysis.ratingMentioned === "string" ? ratingAnalysis.ratingMentioned : null,
      ratingAgency: typeof ratingAnalysis.ratingAgency === "string" ? ratingAnalysis.ratingAgency : null,
      ratingIsDowngrade,
      ratingIsUpgrade: Boolean(ratingAnalysis.isUpgrade),
      ratingIsCCCThreshold: ratingIsCCC,

      covenantFlag,
      covenantType: typeof covenantAnalysis.covenantType === "string" ? covenantAnalysis.covenantType : null,

      cloImpact: cloRelevance === "high" || cloRelevance === "medium",
      cloRelevance,
      cloImpactTypes: Array.isArray(cloAnalysis.impactType) ? (cloAnalysis.impactType as string[]) : [],
      cloWarfImpact,
      cloCCCBucketRisk: Boolean(cloAnalysis.cccBucketRisk),
      cloLoanVsBond,
      cloExplanation: (cloAnalysis.explanation as string) ?? "",

      spreadWideningRisk: Boolean(marketTech.spreadWideningRisk),
      forcedSellingRisk: Boolean(marketTech.forcedSellingRisk),
      distressedRisk,

      marketImpact,
      urgencyScore: aiScore,
      finalUrgencyScore,
      creditSignalScore,

      // Structured outputs
      creditSummary: parsed.creditSummary ? {
        situation: (parsed.creditSummary as Record<string, unknown>).situation as string ?? "",
        creditDrivers: Array.isArray((parsed.creditSummary as Record<string, unknown>).creditDrivers)
          ? (parsed.creditSummary as Record<string, unknown>).creditDrivers as string[] : [],
        riskFactors: Array.isArray((parsed.creditSummary as Record<string, unknown>).riskFactors)
          ? (parsed.creditSummary as Record<string, unknown>).riskFactors as string[] : [],
        keyMetricsMentioned: Array.isArray((parsed.creditSummary as Record<string, unknown>).keyMetricsMentioned)
          ? (parsed.creditSummary as Record<string, unknown>).keyMetricsMentioned as string[] : [],
        bottomLine: (parsed.creditSummary as Record<string, unknown>).bottomLine as string ?? "",
      } : null,

      scoreExplanation: parsed.scoreExplanation ? {
        creditRisk: (parsed.scoreExplanation as Record<string, unknown>).creditRisk as string ?? "",
        marketSignal: (parsed.scoreExplanation as Record<string, unknown>).marketSignal as string ?? "",
        cloImpact: (parsed.scoreExplanation as Record<string, unknown>).cloImpact as string ?? "",
      } : null,
    };
  } catch (err) {
    logger.error({ err }, "Error calling OpenAI API");
    return null;
  }
}
