import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { count, isNotNull, isNull, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/debug/ingestion-stats", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        totalArticles: count(),
        aiProcessed: sql<number>`COUNT(${articlesTable.processedAt})`,
        aiNotProcessed: sql<number>`COUNT(*) - COUNT(${articlesTable.processedAt})`,
        hasCreditSummary: sql<number>`COUNT(${articlesTable.creditSummaryJson})`,
        hasScoreExplanation: sql<number>`COUNT(${articlesTable.scoreExplanationJson})`,
        hasPotentialTrades: sql<number>`COUNT(${articlesTable.potentialTrades})`,
        hasIssuerName: sql<number>`COUNT(${articlesTable.issuerName})`,
        badIssuerNameStrings: sql<number>`COUNT(CASE WHEN ${articlesTable.issuerName} IN ('null','undefined','') THEN 1 END)`,
        hasRawSnippet: sql<number>`COUNT(CASE WHEN ${articlesTable.rawSnippet} IS NOT NULL AND ${articlesTable.rawSnippet} != '' THEN 1 END)`,
        hasRawContent: sql<number>`COUNT(CASE WHEN ${articlesTable.rawContent} IS NOT NULL AND ${articlesTable.rawContent} != '' THEN 1 END)`,
        expandedArticles: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} = 'expanded_article' THEN 1 END)`,
        rssSnippetArticles: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} = 'rss_snippet' THEN 1 END)`,
        preEnricherRows: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} IS NULL THEN 1 END)`,
        avgDepthScoreAll: sql<number>`ROUND(AVG(${articlesTable.contentDepthScore})::numeric, 1)`,
        avgDepthScoreProcessed: sql<number>`ROUND(AVG(CASE WHEN ${articlesTable.processedAt} IS NOT NULL THEN ${articlesTable.contentDepthScore} END)::numeric, 1)`,
        avgRawContentLen: sql<number>`ROUND(AVG(CASE WHEN ${articlesTable.rawContent} IS NOT NULL THEN LENGTH(${articlesTable.rawContent}) END)::numeric, 0)`,
        maxRawContentLen: sql<number>`MAX(LENGTH(${articlesTable.rawContent}))`,
      })
      .from(articlesTable);

    const s = rows[0];

    const total = Number(s.totalArticles) || 0;
    const processed = Number(s.aiProcessed) || 0;
    const hasCreditSummary = Number(s.hasCreditSummary) || 0;
    const hasScoreExplanation = Number(s.hasScoreExplanation) || 0;
    const hasPotentialTrades = Number(s.hasPotentialTrades) || 0;

    const pct = (num: number, denom: number) =>
      denom === 0 ? null : Math.round((num / denom) * 100);

    res.json({
      totals: {
        totalArticles: total,
        aiProcessed: processed,
        aiNotProcessed: Number(s.aiNotProcessed) || 0,
      },
      structuredOutputCoverage: {
        withCreditSummary: hasCreditSummary,
        withCreditSummaryPct: pct(hasCreditSummary, processed),
        withScoreExplanation: hasScoreExplanation,
        withScoreExplanationPct: pct(hasScoreExplanation, processed),
        withPotentialTrades: hasPotentialTrades,
        withPotentialTradesPct: pct(hasPotentialTrades, processed),
      },
      issuerQuality: {
        withIssuerName: Number(s.hasIssuerName) || 0,
        withIssuerNamePct: pct(Number(s.hasIssuerName), processed),
        badIssuerNameStrings: Number(s.badIssuerNameStrings) || 0,
      },
      contentEnrichment: {
        withRawSnippet: Number(s.hasRawSnippet) || 0,
        withRawContent: Number(s.hasRawContent) || 0,
        expandedArticles: Number(s.expandedArticles) || 0,
        rssSnippetArticles: Number(s.rssSnippetArticles) || 0,
        preEnricherRows: Number(s.preEnricherRows) || 0,
        avgDepthScoreAll: Number(s.avgDepthScoreAll) || null,
        avgDepthScoreProcessed: Number(s.avgDepthScoreProcessed) || null,
        avgRawContentLenChars: Number(s.avgRawContentLen) || null,
        maxRawContentLenChars: Number(s.maxRawContentLen) || null,
        note: "preEnricherRows = rows ingested before content enrichment was deployed",
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute ingestion stats", detail: String(err) });
  }
});

export default router;
