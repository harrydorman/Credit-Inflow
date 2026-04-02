import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { ListArticlesQueryParams, GetArticleParams } from "@workspace/api-zod";
import { and, eq, gte } from "drizzle-orm";
import { enrichArticle } from "../lib/intelligence";

const router: IRouter = Router();

router.get("/articles", async (req, res): Promise<void> => {
  const query = ListArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { sector, eventType, sentiment, issuerName, covenantFlag, marketImpact, minUrgency, limit, offset } = query.data;

  const conditions = [];
  if (sector) conditions.push(eq(articlesTable.sector, sector));
  if (eventType) conditions.push(eq(articlesTable.eventType, eventType));
  if (sentiment) conditions.push(eq(articlesTable.sentiment, sentiment));
  if (issuerName) conditions.push(eq(articlesTable.issuerName, issuerName));
  if (covenantFlag === true) conditions.push(eq(articlesTable.covenantFlag, true));
  if (marketImpact) conditions.push(eq(articlesTable.marketImpact, marketImpact));
  if (minUrgency != null) conditions.push(gte(articlesTable.urgencyScore, minUrgency));

  let dbQuery = db.select().from(articlesTable).$dynamic();
  if (conditions.length > 0) dbQuery = dbQuery.where(and(...conditions));

  const allArticles = await dbQuery;
  const total = allArticles.length;
  const lim = limit ?? 50;
  const off = offset ?? 0;

  const articles = allArticles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(off, off + lim)
    .map((article) => enrichArticle(article, allArticles));

  res.json({ articles, total });
});

router.get("/articles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetArticleParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const allArticles = await db.select().from(articlesTable);
  const article = allArticles.find((item) => item.id === params.data.id);

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.json(enrichArticle(article, allArticles));
});

export default router;
