import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { ListArticlesQueryParams, GetArticleParams } from "@workspace/api-zod";
import { and, eq, gte, isNotNull, desc, count } from "drizzle-orm";
import { enrichArticle } from "../lib/intelligence";

const router: IRouter = Router();

router.get("/articles", async (req, res): Promise<void> => {
  const query = ListArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { sector, eventType, sentiment, issuerName, covenantFlag, marketImpact, minUrgency, limit, offset } = query.data;
  const lim = limit ?? 50;
  const off = offset ?? 0;

  const conditions = [];
  if (sector) conditions.push(eq(articlesTable.sector, sector));
  if (eventType) conditions.push(eq(articlesTable.eventType, eventType));
  if (sentiment) conditions.push(eq(articlesTable.sentiment, sentiment));
  if (issuerName) conditions.push(eq(articlesTable.issuerName, issuerName));
  if (covenantFlag === true) conditions.push(eq(articlesTable.covenantFlag, true));
  if (marketImpact) conditions.push(eq(articlesTable.marketImpact, marketImpact));
  if (minUrgency != null) conditions.push(gte(articlesTable.urgencyScore, minUrgency));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(articlesTable)
    .where(whereClause);

  const pageArticles = await db
    .select()
    .from(articlesTable)
    .where(whereClause)
    .orderBy(desc(articlesTable.publishedAt))
    .limit(lim)
    .offset(off);

  const universe = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(300);

  const articles = pageArticles.map((article) => enrichArticle(article, universe));

  res.json({ articles, total });
});

router.get("/articles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetArticleParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, params.data.id))
    .limit(1);

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const universe = await db
    .select()
    .from(articlesTable)
    .where(isNotNull(articlesTable.processedAt))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(300);

  res.json(enrichArticle(article, universe));
});

export default router;
