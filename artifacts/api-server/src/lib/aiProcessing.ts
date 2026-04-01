import { logger } from "./logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SECTORS = [
  "Retail",
  "Technology",
  "Energy",
  "Healthcare",
  "Real Estate",
  "Financial Services",
  "Consumer Discretionary",
  "Industrials",
  "Materials",
  "Utilities",
  "Telecom",
  "Media",
  "Transportation",
  "Gaming",
  "Other",
];

const EVENT_TYPES = [
  "downgrade",
  "earnings",
  "default risk",
  "refinancing",
  "M&A",
  "macro",
  "bankruptcy",
  "debt issuance",
  "spread widening",
  "rating action",
  "restructuring",
  "covenant breach",
  "other",
];

// Urgency scoring matrix based on event type + sentiment
// 5 = Critical (requires immediate attention)
// 4 = High (monitor closely today)
// 3 = Elevated (worth watching)
// 2 = Moderate (informational with some credit relevance)
// 1 = Low (general market color)
function computeUrgency(
  eventType: string,
  sentiment: string,
  covenantFlag: boolean
): number {
  if (covenantFlag && sentiment === "negative") return 5;
  if (eventType === "bankruptcy" && sentiment === "negative") return 5;
  if (eventType === "covenant breach") return 5;
  if (eventType === "default risk" && sentiment === "negative") return 4;
  if (eventType === "downgrade" && sentiment === "negative") return 4;
  if (eventType === "rating action" && sentiment === "negative") return 4;
  if (eventType === "restructuring" && sentiment === "negative") return 4;
  if (eventType === "spread widening" && sentiment === "negative") return 3;
  if (eventType === "debt issuance" && sentiment === "negative") return 3;
  if (sentiment === "negative") return 3;
  if (eventType === "M&A") return 2;
  if (eventType === "refinancing") return 2;
  if (eventType === "earnings") return 2;
  if (sentiment === "neutral") return 2;
  return 1;
}

export interface AIAnalysis {
  summary: string;
  sector: string;
  eventType: string;
  sentiment: "positive" | "negative" | "neutral";
  whyItMatters: string;
  whoCares: string;
  cloImpact: boolean;
  issuerName: string | null;
  covenantFlag: boolean;
  ratingMentioned: string | null;
  ratingAgency: string | null;
  marketImpact: "high" | "medium" | "low";
  urgencyScore: number;
}

export async function analyzeArticle(
  title: string,
  content: string | null
): Promise<AIAnalysis | null> {
  if (!OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set, skipping AI analysis");
    return null;
  }

  const articleText = [title, content].filter(Boolean).join("\n\n");

  const prompt = `You are a senior credit analyst with 30 years of fixed income trading experience. Analyze this financial news article with the precision a credit desk demands.

Article:
${articleText.slice(0, 3000)}

Respond with ONLY a valid JSON object (no markdown, no code blocks) with these exact fields:
{
  "summary": "3-5 sentence summary focused on credit implications — mention specific spreads, ratings, or debt metrics if present in the article",
  "sector": "one of: ${SECTORS.join(", ")}",
  "eventType": "one of: ${EVENT_TYPES.join(", ")}",
  "sentiment": "one of: positive, negative, neutral (strictly from a credit/bond investor perspective — positive = credit improving, negative = credit deteriorating)",
  "whyItMatters": "2-3 sentences explaining implications for: (1) credit risk, (2) bond spreads or CDS, (3) specific holders like CLO managers or HY funds",
  "whoCares": "comma-separated list from: Credit Analysts, Fixed Income Traders, Portfolio Managers, CLO Managers, Risk Officers, Distressed Debt Investors",
  "cloImpact": true or false (true if article relates to leveraged loans, CLO market, ratings changes affecting CLOs, structured credit, or loan pricing),
  "issuerName": "the specific company/issuer being discussed (e.g. 'Ford Motor Credit', 'Dish Network', 'Altice USA') — null if article is purely macro with no single issuer focus",
  "covenantFlag": true or false (true if article mentions: covenant breach, covenant waiver, covenant amendment, PIK toggle, springing covenant, restricted payments, cure rights, or any distressed credit amendment),
  "ratingMentioned": "the specific credit rating mentioned in the article if any, e.g. 'B2', 'BB+', 'Caa1', 'CCC+' — null if no specific rating mentioned",
  "ratingAgency": "one of: Moody's, S&P, Fitch — null if no rating agency action mentioned",
  "marketImpact": "one of: high, medium, low — your assessment of likely market impact on credit spreads"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
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
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed = JSON.parse(jsonStr) as Partial<AIAnalysis>;

    if (
      !parsed.summary ||
      !parsed.sector ||
      !parsed.eventType ||
      !parsed.sentiment
    ) {
      logger.warn({ parsed }, "AI response missing required fields");
      return null;
    }

    const sentiment = ["positive", "negative", "neutral"].includes(
      parsed.sentiment as string
    )
      ? (parsed.sentiment as "positive" | "negative" | "neutral")
      : "neutral";

    const eventType = EVENT_TYPES.includes(parsed.eventType as string)
      ? (parsed.eventType as string)
      : "other";

    const covenantFlag = Boolean(parsed.covenantFlag);

    const marketImpact = ["high", "medium", "low"].includes(
      parsed.marketImpact as string
    )
      ? (parsed.marketImpact as "high" | "medium" | "low")
      : "medium";

    return {
      summary: parsed.summary as string,
      sector: SECTORS.includes(parsed.sector as string)
        ? (parsed.sector as string)
        : "Other",
      eventType,
      sentiment,
      whyItMatters: (parsed.whyItMatters as string) ?? "",
      whoCares: (parsed.whoCares as string) ?? "",
      cloImpact: Boolean(parsed.cloImpact),
      issuerName:
        typeof parsed.issuerName === "string" ? parsed.issuerName : null,
      covenantFlag,
      ratingMentioned:
        typeof parsed.ratingMentioned === "string"
          ? parsed.ratingMentioned
          : null,
      ratingAgency:
        typeof parsed.ratingAgency === "string" ? parsed.ratingAgency : null,
      marketImpact,
      urgencyScore: computeUrgency(eventType, sentiment, covenantFlag),
    };
  } catch (err) {
    logger.error({ err }, "Error calling OpenAI API");
    return null;
  }
}
