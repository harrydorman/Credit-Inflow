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

interface AIAnalysis {
  summary: string;
  sector: string;
  eventType: string;
  sentiment: "positive" | "negative" | "neutral";
  whyItMatters: string;
  whoCares: string;
  cloImpact: boolean;
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

  const prompt = `You are a credit market analyst. Analyze this financial news article and provide structured insights.

Article:
${articleText.slice(0, 3000)}

Respond with ONLY a valid JSON object (no markdown, no code blocks) with these exact fields:
{
  "summary": "3-5 sentence summary focused on credit implications",
  "sector": "one of: ${SECTORS.join(", ")}",
  "eventType": "one of: ${EVENT_TYPES.join(", ")}",
  "sentiment": "one of: positive, negative, neutral (from a credit/bond investor perspective)",
  "whyItMatters": "2-3 sentences explaining implications for credit risk, bond spreads, and market participants",
  "whoCares": "comma-separated list from: Credit Analysts, Fixed Income Traders, Portfolio Managers, CLO Managers, Risk Officers",
  "cloImpact": true or false (true if article relates to leveraged loans, CLO market, ratings changes affecting CLOs, or structured credit)
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
        temperature: 0.3,
        max_tokens: 600,
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

    const parsed = JSON.parse(jsonStr) as AIAnalysis;

    if (
      !parsed.summary ||
      !parsed.sector ||
      !parsed.eventType ||
      !parsed.sentiment
    ) {
      logger.warn({ parsed }, "AI response missing required fields");
      return null;
    }

    return {
      summary: parsed.summary,
      sector: SECTORS.includes(parsed.sector) ? parsed.sector : "Other",
      eventType: EVENT_TYPES.includes(parsed.eventType)
        ? parsed.eventType
        : "other",
      sentiment: ["positive", "negative", "neutral"].includes(parsed.sentiment)
        ? (parsed.sentiment as "positive" | "negative" | "neutral")
        : "neutral",
      whyItMatters: parsed.whyItMatters ?? "",
      whoCares: parsed.whoCares ?? "",
      cloImpact: Boolean(parsed.cloImpact),
    };
  } catch (err) {
    logger.error({ err }, "Error calling OpenAI API");
    return null;
  }
}
