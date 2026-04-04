import { Router, type IRouter } from "express";
import { db, alertRulesTable, alertEventsTable, watchlistsTable } from "@workspace/db";
import {
  ListAlertEventsQueryParams,
  ListAlertRulesQueryParams,
  CreateAlertRuleBody,
  MarkAlertReadParams,
  ToggleAlertRuleParams,
  DeleteAlertRuleParams,
  UpdateAlertRuleParams,
  UpdateAlertRuleBody,
} from "@workspace/api-zod";
import { eq, and, desc, count } from "drizzle-orm";

const router: IRouter = Router();

// GET /alerts
router.get("/alerts", async (req, res): Promise<void> => {
  const query = ListAlertEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { watchlistId, isRead, limit, offset } = query.data;

  const conditions = [];
  if (watchlistId !== undefined) {
    conditions.push(eq(alertEventsTable.watchlistId, watchlistId));
  }
  if (isRead !== undefined) {
    conditions.push(eq(alertEventsTable.isRead, isRead));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [alerts, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(alertEventsTable)
      .where(where)
      .orderBy(desc(alertEventsTable.triggeredAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(alertEventsTable).where(where),
  ]);

  res.json({ alerts, total });
});

// GET /alerts/rules
router.get("/alerts/rules", async (req, res): Promise<void> => {
  const query = ListAlertRulesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { watchlistId } = query.data;

  const where =
    watchlistId !== undefined
      ? eq(alertRulesTable.watchlistId, watchlistId)
      : undefined;

  const [rules, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(alertRulesTable)
      .where(where)
      .orderBy(desc(alertRulesTable.id)),
    db.select({ value: count() }).from(alertRulesTable).where(where),
  ]);

  res.json({ rules, total });
});

// POST /alerts/rules
router.post("/alerts/rules", async (req, res): Promise<void> => {
  const body = CreateAlertRuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { watchlistId, name, isActive, minimumUrgency, eventTypes, covenantFlagOnly } =
    body.data;

  const [watchlist] = await db
    .select({ id: watchlistsTable.id })
    .from(watchlistsTable)
    .where(eq(watchlistsTable.id, watchlistId))
    .limit(1);

  if (!watchlist) {
    res.status(404).json({ error: "Watchlist not found" });
    return;
  }

  const [created] = await db
    .insert(alertRulesTable)
    .values({
      watchlistId,
      name,
      isActive,
      minimumUrgency: minimumUrgency ?? null,
      eventTypes: eventTypes ?? null,
      covenantFlagOnly,
    })
    .returning();

  res.status(201).json(created);
});

// POST /alerts/:id/read
router.post("/alerts/:id/read", async (req, res): Promise<void> => {
  const params = MarkAlertReadParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [updated] = await db
    .update(alertEventsTable)
    .set({ isRead: true })
    .where(eq(alertEventsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Alert event not found" });
    return;
  }

  res.json(updated);
});

// POST /alerts/rules/:id/toggle
router.post("/alerts/rules/:id/toggle", async (req, res): Promise<void> => {
  const params = ToggleAlertRuleParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(alertRulesTable)
    .where(eq(alertRulesTable.id, params.data.id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert rule not found" });
    return;
  }

  const [updated] = await db
    .update(alertRulesTable)
    .set({ isActive: !existing.isActive, updatedAt: new Date() })
    .where(eq(alertRulesTable.id, params.data.id))
    .returning();

  res.json(updated);
});

// PATCH /alerts/rules/:id
router.patch("/alerts/rules/:id", async (req, res): Promise<void> => {
  const params = UpdateAlertRuleParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateAlertRuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(alertRulesTable)
    .where(eq(alertRulesTable.id, params.data.id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert rule not found" });
    return;
  }

  const { name, isActive, minimumUrgency, eventTypes, covenantFlagOnly } = body.data;

  if (name !== undefined && name.trim() === "") {
    res.status(400).json({ error: "name must not be empty" });
    return;
  }

  const [updated] = await db
    .update(alertRulesTable)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(isActive !== undefined && { isActive }),
      ...(minimumUrgency !== undefined && { minimumUrgency }),
      ...(eventTypes !== undefined && { eventTypes: eventTypes ?? null }),
      ...(covenantFlagOnly !== undefined && { covenantFlagOnly }),
      updatedAt: new Date(),
    })
    .where(eq(alertRulesTable.id, params.data.id))
    .returning();

  res.json(updated);
});

// DELETE /alerts/rules/:id
router.delete("/alerts/rules/:id", async (req, res): Promise<void> => {
  const params = DeleteAlertRuleParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await db
    .delete(alertRulesTable)
    .where(eq(alertRulesTable.id, params.data.id))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Alert rule not found" });
    return;
  }

  res.status(204).send();
});

export default router;
