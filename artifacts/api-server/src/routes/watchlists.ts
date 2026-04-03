import { Router, type IRouter } from "express";
import { db, watchlistsTable, watchlistItemsTable, articlesTable } from "@workspace/db";
import {
  ListWatchlistsResponse,
  CreateWatchlistBody,
  AddWatchlistItemParams,
  AddWatchlistItemBody,
  RemoveWatchlistItemParams,
  GetWatchlistArticlesParams,
  GetWatchlistArticlesQueryParams,
} from "@workspace/api-zod";
import { eq, and, inArray, desc, count } from "drizzle-orm";
import { canonicalizeIssuer } from "../lib/canonicalIssuers";

const router: IRouter = Router();

// GET /watchlists
router.get("/watchlists", async (_req, res): Promise<void> => {
  const watchlists = await db.select().from(watchlistsTable).orderBy(watchlistsTable.id);
  res.json({ watchlists, total: watchlists.length });
});

// POST /watchlists
router.post("/watchlists", async (req, res): Promise<void> => {
  const body = CreateWatchlistBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [created] = await db
    .insert(watchlistsTable)
    .values({ name: body.data.name, description: body.data.description ?? null })
    .returning();

  res.status(201).json(created);
});

// POST /watchlists/:id/items
router.post("/watchlists/:id/items", async (req, res): Promise<void> => {
  const params = AddWatchlistItemParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AddWatchlistItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [watchlist] = await db
    .select()
    .from(watchlistsTable)
    .where(eq(watchlistsTable.id, params.data.id))
    .limit(1);

  if (!watchlist) {
    res.status(404).json({ error: "Watchlist not found" });
    return;
  }

  const normalized = canonicalizeIssuer(body.data.issuerName) ?? body.data.issuerName;

  try {
    const [item] = await db
      .insert(watchlistItemsTable)
      .values({
        watchlistId: params.data.id,
        issuerName: body.data.issuerName,
        normalizedIssuerName: normalized,
      })
      .returning();

    res.status(201).json(item);
  } catch (err: unknown) {
    const isUniqueViolation =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505";

    if (isUniqueViolation) {
      res.status(409).json({ error: "Issuer already in watchlist" });
      return;
    }
    throw err;
  }
});

// DELETE /watchlists/:id/items/:issuerName
router.delete("/watchlists/:id/items/:issuerName", async (req, res): Promise<void> => {
  const params = RemoveWatchlistItemParams.safeParse({
    id: req.params.id,
    issuerName: req.params.issuerName,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [watchlist] = await db
    .select()
    .from(watchlistsTable)
    .where(eq(watchlistsTable.id, params.data.id))
    .limit(1);

  if (!watchlist) {
    res.status(404).json({ error: "Watchlist not found" });
    return;
  }

  const normalized = canonicalizeIssuer(params.data.issuerName) ?? params.data.issuerName;

  const deleted = await db
    .delete(watchlistItemsTable)
    .where(
      and(
        eq(watchlistItemsTable.watchlistId, params.data.id),
        eq(watchlistItemsTable.normalizedIssuerName, normalized),
      ),
    )
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Item not found in watchlist" });
    return;
  }

  res.status(204).send();
});

// GET /watchlists/:id/articles
router.get("/watchlists/:id/articles", async (req, res): Promise<void> => {
  const params = GetWatchlistArticlesParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetWatchlistArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const [watchlist] = await db
    .select()
    .from(watchlistsTable)
    .where(eq(watchlistsTable.id, params.data.id))
    .limit(1);

  if (!watchlist) {
    res.status(404).json({ error: "Watchlist not found" });
    return;
  }

  const items = await db
    .select({ normalizedIssuerName: watchlistItemsTable.normalizedIssuerName })
    .from(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, params.data.id));

  if (items.length === 0) {
    res.json({ articles: [], total: 0 });
    return;
  }

  const issuerNames = items.map((i: { normalizedIssuerName: string }) => i.normalizedIssuerName);

  const [{ total }] = await db
    .select({ total: count() })
    .from(articlesTable)
    .where(inArray(articlesTable.issuerName, issuerNames));

  const articles = await db
    .select()
    .from(articlesTable)
    .where(inArray(articlesTable.issuerName, issuerNames))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(query.data.limit);

  res.json({ articles, total });
});

export default router;
