import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { count, sql } from "drizzle-orm";
import { getFeedHealth } from "../lib/dataProviders";

const router: IRouter = Router();

router.get("/debug/ingestion-stats", async (_req, res): Promise<void> => {
  try {
    // ── Core totals ─────────────────────────────────────────────────────────
    const [totalsRow] = await db
      .select({
        totalArticles: count(),
        aiProcessed: sql<number>`COUNT(${articlesTable.processedAt})`,
        aiNotProcessed: sql<number>`COUNT(*) - COUNT(${articlesTable.processedAt})`,
      })
      .from(articlesTable);

    // ── Structured output coverage (over processed-only universe) ────────────
    const [coverageRow] = await db
      .select({
        withCreditSummary: sql<number>`COUNT(${articlesTable.creditSummaryJson})`,
        withScoreExplanation: sql<number>`COUNT(${articlesTable.scoreExplanationJson})`,
        withPotentialTrades: sql<number>`COUNT(${articlesTable.potentialTrades})`,
        withIssuerName: sql<number>`COUNT(${articlesTable.issuerName})`,
        badIssuerNameStrings: sql<number>`COUNT(CASE WHEN ${articlesTable.issuerName} IN ('null','undefined','') THEN 1 END)`,
        withTradeImplication: sql<number>`COUNT(CASE WHEN ${articlesTable.tradeDirection} IS NOT NULL OR ${articlesTable.tradeRationale} IS NOT NULL THEN 1 END)`,
      })
      .from(articlesTable);

    // ── Failure reason breakdown ─────────────────────────────────────────────
    const failureRows = await db
      .select({
        reason: articlesTable.processFailureReason,
        count: count(),
      })
      .from(articlesTable)
      .groupBy(articlesTable.processFailureReason);

    const failureMap: Record<string, number> = {};
    for (const r of failureRows) {
      failureMap[r.reason ?? "processed_ok"] = Number(r.count);
    }

    // ── Content enrichment quality ───────────────────────────────────────────
    const [enrichRow] = await db
      .select({
        withRawSnippet: sql<number>`COUNT(CASE WHEN ${articlesTable.rawSnippet} IS NOT NULL AND ${articlesTable.rawSnippet} != '' THEN 1 END)`,
        withRawContent: sql<number>`COUNT(CASE WHEN ${articlesTable.rawContent} IS NOT NULL AND LENGTH(${articlesTable.rawContent}) > 0 THEN 1 END)`,
        expandedArticles: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} = 'expanded_article' THEN 1 END)`,
        rssSnippetArticles: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} = 'rss_snippet' THEN 1 END)`,
        preEnricherRows: sql<number>`COUNT(CASE WHEN ${articlesTable.contentSourceType} IS NULL THEN 1 END)`,
        avgDepthScoreAll: sql<number>`ROUND(AVG(${articlesTable.contentDepthScore})::numeric, 1)`,
        avgDepthScoreProcessed: sql<number>`ROUND(AVG(CASE WHEN ${articlesTable.processedAt} IS NOT NULL THEN ${articlesTable.contentDepthScore} END)::numeric, 1)`,
        avgRawContentLen: sql<number>`ROUND(AVG(CASE WHEN ${articlesTable.rawContent} IS NOT NULL THEN LENGTH(${articlesTable.rawContent}) END)::numeric, 0)`,
        maxRawContentLen: sql<number>`MAX(LENGTH(${articlesTable.rawContent}))`,
      })
      .from(articlesTable);

    // ── Average depth score by source (post-enricher articles only) ──────────
    const depthBySource = await db
      .select({
        source: articlesTable.source,
        avgDepth: sql<number>`ROUND(AVG(${articlesTable.contentDepthScore})::numeric, 1)`,
        articleCount: count(),
      })
      .from(articlesTable)
      .groupBy(articlesTable.source)
      .orderBy(sql`AVG(${articlesTable.contentDepthScore}) DESC NULLS LAST`);

    const topSources = depthBySource
      .filter((r) => r.avgDepth !== null)
      .slice(0, 8)
      .map((r) => ({ source: r.source, avgDepth: Number(r.avgDepth) || 0, articles: Number(r.articleCount) }));

    // ── Issuer extraction coverage ───────────────────────────────────────────
    const total = Number(totalsRow.totalArticles) || 0;
    const processed = Number(totalsRow.aiProcessed) || 0;
    const hasCreditSummary = Number(coverageRow.withCreditSummary) || 0;
    const hasScoreExplanation = Number(coverageRow.withScoreExplanation) || 0;
    const hasPotentialTrades = Number(coverageRow.withPotentialTrades) || 0;
    const hasIssuerName = Number(coverageRow.withIssuerName) || 0;
    const hasTradeImplication = Number(coverageRow.withTradeImplication) || 0;

    const pct = (num: number, denom: number) =>
      denom === 0 ? null : Math.round((num / denom) * 100);

    const enrichSuccessRate = (Number(enrichRow.expandedArticles) || 0) + (Number(enrichRow.rssSnippetArticles) || 0);
    const enrichAttempted = enrichSuccessRate + (Number(enrichRow.preEnricherRows) || 0);

    res.json({
      totals: {
        totalArticles: total,
        aiProcessed: processed,
        aiNotProcessed: Number(totalsRow.aiNotProcessed) || 0,
      },
      failureReasonBreakdown: {
        processed_ok: failureMap["processed_ok"] ?? 0,
        noise_filtered: failureMap["noise_filtered"] ?? 0,
        empty_content: failureMap["empty_content"] ?? 0,
        ai_null: failureMap["ai_null"] ?? 0,
        ai_error: failureMap["ai_error"] ?? 0,
        other: Object.entries(failureMap)
          .filter(([k]) => !["processed_ok", "noise_filtered", "empty_content", "ai_null", "ai_error"].includes(k))
          .reduce((acc, [, v]) => acc + v, 0),
      },
      structuredOutputCoverage: {
        withCreditSummary: hasCreditSummary,
        withCreditSummaryPct: pct(hasCreditSummary, processed),
        withScoreExplanation: hasScoreExplanation,
        withScoreExplanationPct: pct(hasScoreExplanation, processed),
        withPotentialTrades: hasPotentialTrades,
        withPotentialTradesPct: pct(hasPotentialTrades, processed),
        withTradeImplication: hasTradeImplication,
        withTradeImplicationPct: pct(hasTradeImplication, processed),
      },
      issuerExtractionCoverage: {
        withIssuerName: hasIssuerName,
        withIssuerNamePct: pct(hasIssuerName, processed),
        badIssuerNameStrings: Number(coverageRow.badIssuerNameStrings) || 0,
        note: "issuerName coverage is expected to be ~25-35% — macro articles have no named issuer",
      },
      contentEnrichment: {
        enrichmentSuccessRate: enrichAttempted > 0 ? pct(enrichSuccessRate, enrichAttempted) : null,
        withRawSnippet: Number(enrichRow.withRawSnippet) || 0,
        withRawContent: Number(enrichRow.withRawContent) || 0,
        expandedArticles: Number(enrichRow.expandedArticles) || 0,
        rssSnippetArticles: Number(enrichRow.rssSnippetArticles) || 0,
        preEnricherRows: Number(enrichRow.preEnricherRows) || 0,
        avgDepthScoreAll: Number(enrichRow.avgDepthScoreAll) || null,
        avgDepthScoreProcessed: Number(enrichRow.avgDepthScoreProcessed) || null,
        avgRawContentLenChars: Number(enrichRow.avgRawContentLen) || null,
        maxRawContentLenChars: Number(enrichRow.maxRawContentLen) || null,
      },
      avgDepthBySource: topSources,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute ingestion stats", detail: String(err) });
  }
});

// ── Feed health endpoint ──────────────────────────────────────────────────────
router.get("/debug/feed-health", (_req, res): void => {
  const feeds = getFeedHealth();

  if (feeds.length === 0) {
    res.json({
      note: "No ingestion cycle has run since server start. Feed health is populated after the first /api/refresh call.",
      feeds: [],
    });
    return;
  }

  const okCount = feeds.filter((f) => f.status === "ok").length;
  const failingCount = feeds.filter((f) => f.status === "failing").length;
  const summary = {
    totalFeeds: feeds.length,
    healthy: okCount,
    failing: failingCount,
    neverAttempted: feeds.filter((f) => f.status === "never_attempted").length,
    healthPct: feeds.length > 0 ? Math.round((okCount / feeds.length) * 100) : null,
  };

  res.json({ summary, feeds });
});

export default router;
