import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { fetchNewsApiArticles, fetchRssArticles } from "../lib/newsIngestion";
import { analyzeArticle } from "../lib/aiProcessing";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");

  let fetched = 0;
  let processed = 0;
  let duplicatesSkipped = 0;
  let errors = 0;

  try {
    const [newsApiArticles, rssArticles] = await Promise.all([
      fetchNewsApiArticles(),
      fetchRssArticles(),
    ]);

    const allRaw = [...newsApiArticles, ...rssArticles];
    fetched = allRaw.length;

    req.log.info({ fetched }, "Fetched raw articles");

    const existingUrls = new Set(
      (await db.select({ url: articlesTable.url }).from(articlesTable)).map(
        (r) => r.url
      )
    );

    const newArticles = allRaw.filter((a) => !existingUrls.has(a.url));
    duplicatesSkipped = allRaw.length - newArticles.length;

    for (const raw of newArticles) {
      try {
        const analysis = await analyzeArticle(raw.title, raw.rawContent);

        await db.insert(articlesTable).values({
          title: raw.title,
          source: raw.source,
          publishedAt: raw.publishedAt,
          url: raw.url,
          rawContent: raw.rawContent,
          summary: analysis?.summary ?? null,
          sector: analysis?.sector ?? null,
          eventType: analysis?.eventType ?? null,
          sentiment: analysis?.sentiment ?? null,
          whyItMatters: analysis?.whyItMatters ?? null,
          whoCares: analysis?.whoCares ?? null,
          cloImpact: analysis?.cloImpact ?? false,
          // New trader-critical fields
          issuerName: analysis?.issuerName ?? null,
          urgencyScore: analysis?.urgencyScore ?? null,
          covenantFlag: analysis?.covenantFlag ?? false,
          ratingMentioned: analysis?.ratingMentioned ?? null,
          ratingAgency: analysis?.ratingAgency ?? null,
          marketImpact: analysis?.marketImpact ?? null,
          processedAt: analysis ? new Date() : null,
        });

        if (analysis) processed++;

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.error({ err, url: raw.url }, "Error processing article");
        errors++;
      }
    }

    req.log.info({ fetched, processed, duplicatesSkipped, errors }, "Ingestion complete");

    res.json(
      TriggerRefreshResponse.parse({
        fetched,
        processed,
        duplicatesSkipped,
        errors,
        message: `Ingestion complete: ${processed} new articles processed, ${duplicatesSkipped} duplicates skipped`,
      })
    );
  } catch (err) {
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

export default router;
