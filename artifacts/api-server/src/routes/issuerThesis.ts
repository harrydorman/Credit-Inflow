import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { buildIssuerSnapshot, enrichArticle } from "../lib/intelligence";
import { config } from "../lib/config";

const OPENAI_API_KEY = config.openai.apiKey;
const OPENAI_BASE_URL = config.openai.baseUrl;

const router: IRouter = Router();

router.get("/issuer-thesis/:issuer", async (req, res): Promise<void> => {
  const { issuer } = req.params;

  if (!issuer) {
    res.status(400).json({ error: "issuer is required" });
    return;
  }

  const articles = await db.select().from(articlesTable).where(eq(articlesTable.issuerName, issuer));
  if (articles.length === 0) {
    res.status(404).json({ error: `No articles found for issuer: ${issuer}` });
    return;
  }

  const enriched = articles.map((article) => enrichArticle(article, articles)).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const snapshot = buildIssuerSnapshot(issuer, enriched);
  const negCount = enriched.filter((a) => a.sentiment === "negative").length;
  const covenantCount = enriched.filter((a) => a.covenantFlag).length;
  const maxUrgency = Math.max(...enriched.map((a) => a.finalUrgencyScore ?? a.urgencyScore ?? 0));

  const baseResponse = {
    issuer,
    creditView: snapshot.riskLevel === "high" ? "negative" : snapshot.riskLevel === "low" ? "positive" : "neutral",
    summary: snapshot.summary,
    keyDrivers: snapshot.keyDrivers,
    risks: snapshot.keyRisks,
    potentialOutlook:
      snapshot.trend === "deteriorating"
        ? "Bias toward wider spreads / weaker ratings trajectory unless operating or financing evidence improves."
        : snapshot.trend === "improving"
          ? "Conditions are stabilizing, but watch for confirmation in ratings, liquidity, and refinancing access."
          : "Stable-to-cautious. Await clearer evidence on liquidity, maturities, and earnings follow-through.",
    articleCount: enriched.length,
    trustLabel: snapshot.trustLabel,
    nextQuestions: snapshot.nextQuestions,
  };

  if (!OPENAI_API_KEY) {
    res.json(baseResponse);
    return;
  }

  const context = enriched.slice(0, 12).map((a, i) =>
    `[${i + 1}] ${new Date(a.publishedAt).toISOString().slice(0, 10)} | ${a.source} | trust=${a.trustProfile.trustScore}\n` +
    `Title: ${a.title}\n` +
    `Bottom line: ${a.signalCard.whyNow}\n` +
    `Evidence: ${a.signalCard.keyEvidence.join("; ")}\n` +
    `Implications: ${a.signalCard.creditImplications.join("; ")}\n`
  ).join("\n---\n");

  const prompt = `You are a senior buy-side credit analyst writing a rolling issuer memo.
Use ONLY the evidence provided. Do not invent leverage, liquidity, maturity, or spread facts.
Be measured and explicit about uncertainty.

Issuer snapshot:
- issuer: ${issuer}
- current risk level: ${snapshot.riskLevel}
- trend: ${snapshot.trend}
- trust label: ${snapshot.trustLabel}
- negative articles: ${negCount}/${enriched.length}
- covenant count: ${covenantCount}
- max urgency: ${maxUrgency}/10
- key drivers: ${snapshot.keyDrivers.join(" | ")}
- key risks: ${snapshot.keyRisks.join(" | ")}

Recent evidence:
${context}

Return ONLY valid JSON:
{
  "creditView": "positive | negative | neutral",
  "summary": "3-4 sentence issuer-level credit memo using only stated evidence",
  "keyDrivers": ["3-5 issuer-specific drivers"],
  "risks": ["3-5 concrete downside risks"],
  "potentialOutlook": "6-12 month forward-looking view with explicit uncertainty where evidence is thin"
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
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, err }, "OpenAI error in issuer thesis");
      res.json(baseResponse);
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

    res.json({ ...baseResponse, ...thesis });
  } catch (err) {
    logger.error({ err }, "Error generating issuer thesis");
    res.json(baseResponse);
  }
});

export default router;
