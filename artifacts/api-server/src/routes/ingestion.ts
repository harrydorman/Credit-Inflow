import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter } from "../lib/aiProcessing";
import { getETFSnapshot, validateWithMarketData } from "../lib/marketData";
import { logger } from "../lib/logger";
import { enrichContent } from "../lib/contentEnricher";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");

  let fetched = 0;
  let processed = 0;
  let duplicatesSkipped = 0;
  let noiseFiltered = 0;
  let errors = 0;
  let marketValidated = 0;

  try {
    const etfSnapshot = await getETFSnapshot();
    req.log.info({
      hygMove: etfSnapshot.hyg?.move1D?.toFixed(3) ?? "n/a",
      lqdMove: etfSnapshot.lqd?.move1D?.toFixed(3) ?? "n/a",
    }, "ETF snapshot ready");

    const allRaw = await fetchAllArticles();
    fetched = allRaw.length;
    req.log.info({ fetched }, "Fetched raw articles from all providers");

    const existingUrls = new Set(
      (await db.select({ url: articlesTable.url }).from(articlesTable)).map((r) => r.url)
    );

    const newArticles = allRaw.filter((a) => !existingUrls.has(a.url));
    duplicatesSkipped = allRaw.length - newArticles.length;

    for (const raw of newArticles) {
      try {
        const rawSnippet = raw.rawContent ?? "";
        const enriched = await enrichContent(raw.url, raw.source, rawSnippet).catch(() => ({
          rawContent: rawSnippet,
          contentSourceType: "rss_snippet" as const,
          contentDepthScore: Math.min(30, Math.floor(rawSnippet.length / 10)),
        }));

        if (!passesNoiseFilter(raw.title, enriched.rawContent)) {
          noiseFiltered++;
          req.log.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise-filtered: skipping AI processing (score < threshold)"
          );
          await db.insert(articlesTable).values({
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            url: raw.url,
            rawSnippet,
            rawContent: enriched.rawContent,
            contentSourceType: enriched.contentSourceType,
            contentDepthScore: enriched.contentDepthScore,
            processedAt: null,
          });
          continue;
        }

        const analysis = await analyzeArticle(raw.title, enriched.rawContent);

        let marketValidation = null;
        if (analysis) {
          marketValidation = await validateWithMarketData({
            issuerName: analysis.issuerName ?? null,
            sentiment: analysis.sentiment ?? null,
            finalUrgencyScore: analysis.finalUrgencyScore ?? null,
            creditSignalScore: analysis.creditSignalScore ?? null,
            etfSnapshot,
          });
          marketValidated++;
        }

        if (!analysis) {
          req.log.warn(
            { title: raw.title.slice(0, 70) },
            "AI processing returned null — storing as unprocessed stub"
          );
        }

        await db.insert(articlesTable).values({
          title: raw.title,
          source: raw.source,
          publishedAt: raw.publishedAt,
          url: raw.url,
          rawSnippet,
          rawContent: enriched.rawContent,
          contentSourceType: enriched.contentSourceType,
          contentDepthScore: enriched.contentDepthScore,

          summary: analysis?.summary ?? null,
          sector: analysis?.sector ?? null,
          eventType: analysis?.eventType ?? null,
          sentiment: analysis?.sentiment ?? null,
          whyItMatters: analysis?.whyItMatters ?? null,
          whoCares: analysis ? analysis.whoCares.join(", ") : null,

          cloImpact: analysis?.cloImpact ?? false,
          issuerName: analysis?.issuerName ?? null,

          urgencyScore: analysis?.urgencyScore ?? null,
          covenantFlag: analysis?.covenantFlag ?? false,
          ratingMentioned: analysis?.ratingMentioned ?? null,
          ratingAgency: analysis?.ratingAgency ?? null,
          marketImpact: analysis?.marketImpact ?? null,

          finalUrgencyScore: analysis?.finalUrgencyScore ?? null,
          creditSignalScore: analysis?.creditSignalScore ?? null,

          tradeDirection: analysis?.tradeDirection ?? null,
          tradeRationale: analysis?.tradeRationale ?? null,
          potentialTrades: analysis?.potentialTrades ?? null,
          marketsImpacted: analysis?.marketsImpacted ?? null,

          leverageMentioned: analysis?.leverageMentioned ?? false,
          liquidityConcern: analysis?.liquidityConcern ?? false,
          refinancingRisk: analysis?.refinancingRisk ?? false,
          earningsMiss: analysis?.earningsMiss ?? false,

          ratingIsDowngrade: analysis?.ratingIsDowngrade ?? false,
          ratingIsUpgrade: analysis?.ratingIsUpgrade ?? false,
          ratingIsCCCThreshold: analysis?.ratingIsCCCThreshold ?? false,

          covenantType: analysis?.covenantType ?? null,

          cloRelevance: analysis?.cloRelevance ?? null,
          cloLoanVsBond: analysis?.cloLoanVsBond ?? null,
          cloWarfImpact: analysis?.cloWarfImpact ?? null,
          cloCCCBucketRisk: analysis?.cloCCCBucketRisk ?? false,
          cloExplanation: analysis?.cloExplanation ?? null,
          cloImpactTypes: analysis?.cloImpactTypes ?? null,

          spreadWideningRisk: analysis?.spreadWideningRisk ?? false,
          forcedSellingRisk: analysis?.forcedSellingRisk ?? false,
          distressedRisk: analysis?.distressedRisk ?? false,

          stockMove1D: marketValidation?.stockMove1D ?? null,
          stockMove5D: marketValidation?.stockMove5D ?? null,
          hyETFMove: marketValidation?.hyETFMove ?? null,
          marketValidationSignal: marketValidation?.validationSignal ?? null,
          confidenceScore: marketValidation?.confidenceScore ?? null,

          // Structured AI outputs — persisted as JSON columns
          creditSummaryJson: analysis?.creditSummary ?? null,
          scoreExplanationJson: analysis?.scoreExplanation ?? null,

          processedAt: analysis ? new Date() : null,
        });

        if (analysis) processed++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.error({ err, url: raw.url }, "Error processing article");
        errors++;
      }
    }

    req.log.info(
      { fetched, processed, duplicatesSkipped, noiseFiltered, marketValidated, errors },
      "Ingestion complete"
    );

    res.json(
      TriggerRefreshResponse.parse({
        fetched,
        processed,
        duplicatesSkipped,
        errors,
        message: `Ingestion complete: ${processed} new articles processed (${marketValidated} market-validated), ${noiseFiltered} noise-filtered, ${duplicatesSkipped} duplicates skipped`,
      })
    );
  } catch (err) {
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// ── Backfill endpoint ──────────────────────────────────────────────────────────
// Fixes two gaps:
// 1. Articles processed before creditSummary/scoreExplanation were added to the prompt
//    → re-runs AI for structured outputs only, does UPDATE
// 2. Articles with processedAt=null that may have failed AI (not noise-filtered)
//    → re-checks noise filter, re-runs full AI if they pass, does UPDATE
router.post("/refresh/backfill", async (req, res): Promise<void> => {
  req.log.info("Starting structured-output backfill");

  let backfilledStructured = 0;
  let retriedUnprocessed = 0;
  let skippedNoiseFilter = 0;
  let aiNullReturned = 0;
  let errors = 0;

  try {
    // ── Phase 1: Articles already AI-processed but missing structured JSON ──
    const needsStructuredBackfill = await db
      .select({
        id: articlesTable.id,
        title: articlesTable.title,
        rawContent: articlesTable.rawContent,
      })
      .from(articlesTable)
      .where(
        and(
          isNotNull(articlesTable.processedAt),
          isNull(articlesTable.creditSummaryJson)
        )
      )
      .limit(30);

    req.log.info(
      { count: needsStructuredBackfill.length },
      "Phase 1: articles needing structured output backfill"
    );

    for (const article of needsStructuredBackfill) {
      try {
        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          req.log.warn(
            { id: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 1: AI returned null"
          );
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }

        await db
          .update(articlesTable)
          .set({
            creditSummaryJson: analysis.creditSummary ?? null,
            scoreExplanationJson: analysis.scoreExplanation ?? null,
          })
          .where(eq(articlesTable.id, article.id));

        backfilledStructured++;
        req.log.info(
          { id: article.id, title: article.title.slice(0, 70), hasSummary: !!analysis.creditSummary },
          "Backfill Phase 1: structured outputs updated"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        logger.error({ err, id: article.id }, "Backfill Phase 1: error");
        errors++;
      }
    }

    // ── Phase 2: Articles with processedAt=null — retry AI ──────────────────
    const unprocessed = await db
      .select({
        id: articlesTable.id,
        title: articlesTable.title,
        rawContent: articlesTable.rawContent,
      })
      .from(articlesTable)
      .where(isNull(articlesTable.processedAt))
      .limit(20);

    req.log.info(
      { count: unprocessed.length },
      "Phase 2: unprocessed articles to retry"
    );

    for (const article of unprocessed) {
      try {
        if (!passesNoiseFilter(article.title, article.rawContent)) {
          skippedNoiseFilter++;
          req.log.info(
            { id: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise-filtered, skip"
          );
          continue;
        }

        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          req.log.warn(
            { id: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: AI returned null on retry"
          );
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }

        await db
          .update(articlesTable)
          .set({
            summary: analysis.summary,
            sector: analysis.sector,
            eventType: analysis.eventType,
            sentiment: analysis.sentiment,
            whyItMatters: analysis.whyItMatters,
            whoCares: analysis.whoCares.join(", "),
            cloImpact: analysis.cloImpact,
            issuerName: analysis.issuerName,
            urgencyScore: analysis.urgencyScore,
            covenantFlag: analysis.covenantFlag,
            ratingMentioned: analysis.ratingMentioned,
            ratingAgency: analysis.ratingAgency,
            marketImpact: analysis.marketImpact,
            finalUrgencyScore: analysis.finalUrgencyScore,
            creditSignalScore: analysis.creditSignalScore,
            tradeDirection: analysis.tradeDirection,
            tradeRationale: analysis.tradeRationale,
            potentialTrades: analysis.potentialTrades,
            marketsImpacted: analysis.marketsImpacted,
            leverageMentioned: analysis.leverageMentioned,
            liquidityConcern: analysis.liquidityConcern,
            refinancingRisk: analysis.refinancingRisk,
            earningsMiss: analysis.earningsMiss,
            ratingIsDowngrade: analysis.ratingIsDowngrade,
            ratingIsUpgrade: analysis.ratingIsUpgrade,
            ratingIsCCCThreshold: analysis.ratingIsCCCThreshold,
            covenantType: analysis.covenantType,
            cloRelevance: analysis.cloRelevance,
            cloLoanVsBond: analysis.cloLoanVsBond,
            cloWarfImpact: analysis.cloWarfImpact,
            cloCCCBucketRisk: analysis.cloCCCBucketRisk,
            cloExplanation: analysis.cloExplanation,
            cloImpactTypes: analysis.cloImpactTypes,
            spreadWideningRisk: analysis.spreadWideningRisk,
            forcedSellingRisk: analysis.forcedSellingRisk,
            distressedRisk: analysis.distressedRisk,
            creditSummaryJson: analysis.creditSummary ?? null,
            scoreExplanationJson: analysis.scoreExplanation ?? null,
            processedAt: new Date(),
          })
          .where(eq(articlesTable.id, article.id));

        retriedUnprocessed++;
        req.log.info(
          { id: article.id, title: article.title.slice(0, 70) },
          "Backfill Phase 2: successfully processed previously-unprocessed article"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        logger.error({ err, id: article.id }, "Backfill Phase 2: error");
        errors++;
      }
    }

    const message = `Backfill complete: ${backfilledStructured} structured outputs updated, ${retriedUnprocessed} unprocessed articles processed, ${skippedNoiseFilter} noise-filtered (legitimately skipped), ${aiNullReturned} AI null returns, ${errors} errors`;
    req.log.info(
      { backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors },
      "Backfill complete"
    );

    res.json({ backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors, message });
  } catch (err) {
    logger.error({ err }, "Backfill failed");
    res.status(500).json({ error: "Backfill failed" });
  }
});

export default router;
