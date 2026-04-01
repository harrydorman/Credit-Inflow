import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import {
  ListArticlesQueryParams,
  GetArticleParams,
  ListArticlesResponse,
  GetArticleResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/articles", async (req, res): Promise<void> => {
  const query = ListArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { sector, eventType, sentiment, limit, offset } = query.data;

  let dbQuery = db
    .select()
    .from(articlesTable)
    .orderBy(articlesTable.publishedAt)
    .$dynamic();

  const conditions = [];
  if (sector) conditions.push(eq(articlesTable.sector, sector));
  if (eventType) conditions.push(eq(articlesTable.eventType, eventType));
  if (sentiment) conditions.push(eq(articlesTable.sentiment, sentiment));

  if (conditions.length > 0) {
    const { and } = await import("drizzle-orm");
    dbQuery = dbQuery.where(and(...conditions));
  }

  const allArticles = await dbQuery;
  const total = allArticles.length;
  const lim = limit ?? 50;
  const off = offset ?? 0;

  const articles = allArticles
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .slice(off, off + lim);

  res.json(
    ListArticlesResponse.parse({
      articles,
      total,
    })
  );
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
    .where(eq(articlesTable.id, params.data.id));

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.json(GetArticleResponse.parse(article));
});

export default router;
