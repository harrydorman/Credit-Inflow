import { Router, type IRouter } from "express";
import { db, alertRulesTable, alertEventsTable, alertFeedbackTable, alertWorkflowStateTable, watchlistsTable } from "@workspace/db";
import {
  ListAlertEventsQueryParams,
  ListAlertRulesQueryParams,
  CreateAlertRuleBody,
  MarkAlertReadParams,
  MarkAlertUnreadParams,
  ToggleAlertRuleParams,
  DeleteAlertRuleParams,
  UpdateAlertRuleParams,
  UpdateAlertRuleBody,
  BulkMarkAlertsReadBody,
  SubmitAlertFeedbackParams,
  SubmitAlertFeedbackBody,
  UpsertAlertWorkflowStateParams,
  UpsertAlertWorkflowStateBody,
  ClearAlertWorkflowStateParams,
} from "@workspace/api-zod";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { requireOrgId } from "../middlewares/auth";
import { getAlertsForOrganization, type AlertsFilter } from "../services/alertEvaluationService";

const router: IRouter = Router();

// GET /alerts - List alert events for the authenticated org
router.get("/alerts", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const query = ListAlertEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { severity, issuerName, eventType, isRead, portfolioLinked, dateFrom, dateTo, action, userId, limit, offset } = query.data;

  const filters: AlertsFilter = {
    ...(severity !== undefined && { severity }),
    ...(issuerName !== undefined && { issuerName }),
    ...(eventType !== undefined && { eventType }),
    ...(isRead !== undefined && { isRead }),
    ...(portfolioLinked !== undefined && { portfolioLinked }),
    ...(dateFrom !== undefined && { dateFrom }),
    ...(dateTo !== undefined && { dateTo }),
    ...(action !== undefined && { action }),
    ...(userId !== undefined && { userId }),
    limit,
    offset,
  };

  const result = await getAlertsForOrganization(orgId, filters);
  res.json(result);
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

// POST /alerts/bulk-read - Bulk mark alert events as read (must be before /:id routes)
router.post("/alerts/bulk-read", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const body = BulkMarkAlertsReadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { ids } = body.data;

  // Only update alerts that belong to this org (via their alert rule)
  const validAlerts = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(and(inArray(alertEventsTable.id, ids), eq(alertRulesTable.organizationId, orgId)));

  const validIds = validAlerts.map((a) => a.id);
  if (validIds.length === 0) {
    res.json({ updated: 0 });
    return;
  }

  const updated = await db
    .update(alertEventsTable)
    .set({ isRead: true })
    .where(inArray(alertEventsTable.id, validIds))
    .returning({ id: alertEventsTable.id });

  res.json({ updated: updated.length });
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

// POST /alerts/:id/unread - Mark alert event as unread
router.post("/alerts/:id/unread", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const params = MarkAlertUnreadParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Verify org owns this alert
  const [existing] = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(and(eq(alertEventsTable.id, params.data.id), eq(alertRulesTable.organizationId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert event not found" });
    return;
  }

  const [updatedAlert] = await db
    .update(alertEventsTable)
    .set({ isRead: false })
    .where(eq(alertEventsTable.id, params.data.id))
    .returning();

  res.json(updatedAlert);
});

// POST /alerts/:id/feedback - Submit usefulness feedback for an alert
router.post("/alerts/:id/feedback", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const params = SubmitAlertFeedbackParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitAlertFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Verify org owns this alert
  const [existing] = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(and(eq(alertEventsTable.id, params.data.id), eq(alertRulesTable.organizationId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert event not found" });
    return;
  }

  const { userId, rating, note } = body.data;

  const [feedback] = await db
    .insert(alertFeedbackTable)
    .values({
      alertEventId: params.data.id,
      organizationId: orgId,
      userId: userId ?? null,
      rating,
      note: note ?? null,
    })
    .onConflictDoUpdate({
      target: [alertFeedbackTable.alertEventId, alertFeedbackTable.organizationId, alertFeedbackTable.userId],
      set: { rating, note: note ?? null, updatedAt: new Date() },
    })
    .returning();

  res.json(feedback);
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

// PUT /alerts/:id/workflow - Upsert analyst workflow action for an alert event
router.put("/alerts/:id/workflow", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const params = UpsertAlertWorkflowStateParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpsertAlertWorkflowStateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Verify the alert belongs to this org
  const [existing] = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(and(eq(alertEventsTable.id, params.data.id), eq(alertRulesTable.organizationId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert event not found" });
    return;
  }

  const { action, userId } = body.data;

  const [state] = await db
    .insert(alertWorkflowStateTable)
    .values({
      alertEventId: params.data.id,
      organizationId: orgId,
      userId: userId ?? null,
      action,
    })
    .onConflictDoUpdate({
      target: [alertWorkflowStateTable.alertEventId, alertWorkflowStateTable.organizationId],
      set: { action, userId: userId ?? null, updatedAt: new Date() },
    })
    .returning();

  res.json(state);
});

// DELETE /alerts/:id/workflow - Clear analyst workflow action for an alert event
router.delete("/alerts/:id/workflow", async (req, res): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const params = ClearAlertWorkflowStateParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Only delete if the org owns this alert (via org join)
  const [existing] = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
    .where(and(eq(alertEventsTable.id, params.data.id), eq(alertRulesTable.organizationId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert event not found" });
    return;
  }

  await db
    .delete(alertWorkflowStateTable)
    .where(
      and(
        eq(alertWorkflowStateTable.alertEventId, params.data.id),
        eq(alertWorkflowStateTable.organizationId, orgId),
      ),
    );

  res.status(204).send();
});

export default router;
