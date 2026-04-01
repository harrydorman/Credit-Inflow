import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter } from "../lib/aiProcessing";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");

  let fetched = 0;
  let processed = 0;
  let duplicatesSkipped = 0;
  let noiseFiltered = 0;
  let errors = 0;

  try {
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
        // Noise reduction: skip low-signal articles before sending to OpenAI
        if (!passesNoiseFilter(raw.title, raw.rawContent)) {
          noiseFiltered++;
          await db.insert(articlesTable).values({
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            url: raw.url,
            rawContent: raw.rawContent,
            processedAt: null,
          });
          continue;
        }

        const analysis = await analyzeArticle(raw.title, raw.rawContent);

        await db.insert(articlesTable).values({
          title: raw.title,
          source: raw.source,
          publishedAt: raw.publishedAt,
          url: raw.url,
          rawContent: raw.rawContent,

          // Core AI fields
          summary: analysis?.summary ?? null,
          sector: analysis?.sector ?? null,
          eventType: analysis?.eventType ?? null,
          sentiment: analysis?.sentiment ?? null,
          whyItMatters: analysis?.whyItMatters ?? null,
          whoCares: analysis ? analysis.whoCares.join(", ") : null,

          // Legacy CLO
          cloImpact: analysis?.cloImpact ?? false,

          // Issuer
          issuerName: analysis?.issuerName ?? null,

          // Phase 1 scores (compat)
          urgencyScore: analysis?.urgencyScore ?? null,
          covenantFlag: analysis?.covenantFlag ?? false,
          ratingMentioned: analysis?.ratingMentioned ?? null,
          ratingAgency: analysis?.ratingAgency ?? null,
          marketImpact: analysis?.marketImpact ?? null,

          // Phase 2 scores
          finalUrgencyScore: analysis?.finalUrgencyScore ?? null,
          creditSignalScore: analysis?.creditSignalScore ?? null,

          // Trade implication
          tradeDirection: analysis?.tradeDirection ?? null,
          tradeRationale: analysis?.tradeRationale ?? null,
          potentialTrades: analysis?.potentialTrades ?? null,
          marketsImpacted: analysis?.marketsImpacted ?? null,

          // Credit metrics
          leverageMentioned: analysis?.leverageMentioned ?? false,
          liquidityConcern: analysis?.liquidityConcern ?? false,
          refinancingRisk: analysis?.refinancingRisk ?? false,
          earningsMiss: analysis?.earningsMiss ?? false,

          // Enhanced rating
          ratingIsDowngrade: analysis?.ratingIsDowngrade ?? false,
          ratingIsUpgrade: analysis?.ratingIsUpgrade ?? false,
          ratingIsCCCThreshold: analysis?.ratingIsCCCThreshold ?? false,

          // Covenant detail
          covenantType: analysis?.covenantType ?? null,

          // CLO deep analysis
          cloRelevance: analysis?.cloRelevance ?? null,
          cloLoanVsBond: analysis?.cloLoanVsBond ?? null,
          cloWarfImpact: analysis?.cloWarfImpact ?? null,
          cloCCCBucketRisk: analysis?.cloCCCBucketRisk ?? false,
          cloExplanation: analysis?.cloExplanation ?? null,
          cloImpactTypes: analysis?.cloImpactTypes ?? null,

          // Market technical
          spreadWideningRisk: analysis?.spreadWideningRisk ?? false,
          forcedSellingRisk: analysis?.forcedSellingRisk ?? false,
          distressedRisk: analysis?.distressedRisk ?? false,

          processedAt: analysis ? new Date() : null,
        });

        if (analysis) processed++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.error({ err, url: raw.url }, "Error processing article");
        errors++;
      }
    }

    req.log.info({ fetched, processed, duplicatesSkipped, noiseFiltered, errors }, "Ingestion complete");

    res.json(
      TriggerRefreshResponse.parse({
        fetched,
        processed,
        duplicatesSkipped,
        errors,
        message: `Ingestion complete: ${processed} new articles processed, ${noiseFiltered} noise-filtered, ${duplicatesSkipped} duplicates skipped`,
      })
    );
  } catch (err) {
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

export default router;
