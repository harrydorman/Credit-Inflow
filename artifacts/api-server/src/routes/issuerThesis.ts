import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const router: IRouter = Router();

router.get("/issuer-thesis/:issuer", async (req, res): Promise<void> => {
  const { issuer } = req.params;

  if (!issuer) {
    res.status(400).json({ error: "issuer is required" });
    return;
  }

  const articles = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.issuerName, issuer));

  if (articles.length === 0) {
    res.status(404).json({ error: `No articles found for issuer: ${issuer}` });
    return;
  }

  // Build context from all articles for this issuer
  const context = articles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 10)
    .map((a, i) =>
      `[${i + 1}] ${new Date(a.publishedAt).toISOString().slice(0, 10)} — ${a.title}\n` +
      `Summary: ${a.summary ?? "N/A"}\n` +
      `Sentiment: ${a.sentiment ?? "N/A"} | Event: ${a.eventType ?? "N/A"} | Urgency: ${a.finalUrgencyScore ?? a.urgencyScore ?? "N/A"}/10\n` +
      `${a.covenantFlag ? "COVENANT FLAG ACTIVE. " : ""}${a.ratingMentioned ? `Rating: ${a.ratingMentioned} (${a.ratingAgency}). ` : ""}${a.whyItMatters ?? ""}`
    )
    .join("\n\n---\n\n");

  const negCount = articles.filter((a) => a.sentiment === "negative").length;
  const covenantCount = articles.filter((a) => a.covenantFlag).length;
  const maxUrgency = Math.max(...articles.map((a) => a.finalUrgencyScore ?? a.urgencyScore ?? 0));

  if (!OPENAI_API_KEY) {
    // Return a rule-based thesis when OpenAI is unavailable
    const creditView = negCount / articles.length >= 0.6 ? "negative" : negCount / articles.length <= 0.3 ? "positive" : "neutral";
    res.json({
      issuer,
      creditView,
      summary: `Based on ${articles.length} articles. ${negCount} negative signals detected. ${covenantCount > 0 ? `${covenantCount} covenant breach(es) flagged.` : "No covenant issues detected."} Max urgency: ${maxUrgency}/10.`,
      keyDrivers: articles.slice(0, 3).map((a) => a.summary ?? a.title),
      risks: covenantCount > 0 ? [`Covenant breach risk (${covenantCount} instances)`] : ["Monitor for deterioration"],
      potentialOutlook: creditView === "negative" ? "Negative — increased downgrade / spread widening risk" : "Stable — no immediate credit concern",
      articleCount: articles.length,
    });
    return;
  }

  const prompt = `You are a senior credit analyst covering ${issuer}. Based on the following recent news and credit signals, generate a structured credit thesis.

Recent Intelligence (${articles.length} articles, ${negCount} negative, max urgency ${maxUrgency}/10):

${context}

Generate a concise but highly technical credit thesis. Be specific — reference metrics, ratings, spreads, and covenant headroom where possible. Respond ONLY with valid JSON:
{
  "creditView": "positive | negative | neutral",
  "summary": "3-4 sentence credit thesis summary covering current credit quality, trajectory, and key risks",
  "keyDrivers": ["3-5 bullet points explaining the main factors driving the credit view"],
  "risks": ["3-5 specific downside risks: ratings, covenants, liquidity, refinancing, sector headwinds"],
  "potentialOutlook": "6-12 month forward-looking view on spread direction, ratings trajectory, and key catalysts to watch"
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
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, err }, "OpenAI error in thesis");
      res.status(500).json({ error: "AI thesis generation failed" });
      return;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
    const thesis = JSON.parse(jsonStr) as {
      creditView: string;
      summary: string;
      keyDrivers: string[];
      risks: string[];
      potentialOutlook: string;
    };

    res.json({ issuer, ...thesis, articleCount: articles.length });
  } catch (err) {
    logger.error({ err }, "Error generating issuer thesis");
    res.status(500).json({ error: "Failed to generate thesis" });
  }
});

export default router;
