/**
 * routes/notifications.ts
 *
 * Phase 3: Notification channel management endpoints.
 *
 * GET    /notifications/channels                     — list channels for an org
 * POST   /notifications/channels                     — create a channel
 * DELETE /notifications/channels/:id                 — delete a channel
 * POST   /notifications/dispatch/:alertEventId       — trigger dispatch for an event
 * GET    /notifications/deliveries/:alertEventId     — list deliveries for an event
 */
import { Router, type IRouter } from "express";
import {
  db,
  notificationChannelsTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { dispatchNotifications } from "../services/notificationService";

const router: IRouter = Router();

// GET /notifications/channels
router.get("/notifications/channels", async (req, res): Promise<void> => {
  const orgId = req.query.organizationId as string | undefined;
  if (!orgId) {
    res.status(400).json({ error: "organizationId query parameter is required" });
    return;
  }

  const channels = await db
    .select()
    .from(notificationChannelsTable)
    .where(eq(notificationChannelsTable.organizationId, orgId))
    .orderBy(desc(notificationChannelsTable.createdAt));

  res.json({ channels });
});

// POST /notifications/channels
router.post("/notifications/channels", async (req, res): Promise<void> => {
  const { organizationId, name, type, config } = req.body as {
    organizationId?: string;
    name?: string;
    type?: string;
    config?: Record<string, unknown>;
  };

  if (!organizationId || !name?.trim() || !type || !config) {
    res.status(400).json({ error: "organizationId, name, type, and config are required" });
    return;
  }

  if (type !== "email" && type !== "slack") {
    res.status(400).json({ error: 'type must be "email" or "slack"' });
    return;
  }

  const [created] = await db
    .insert(notificationChannelsTable)
    .values({ organizationId, name: name.trim(), type, config })
    .returning();

  res.status(201).json(created);
});

// DELETE /notifications/channels/:id
router.delete("/notifications/channels/:id", async (req, res): Promise<void> => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }

  const deleted = await db
    .delete(notificationChannelsTable)
    .where(eq(notificationChannelsTable.id, channelId))
    .returning({ id: notificationChannelsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  res.status(204).send();
});

// POST /notifications/dispatch/:alertEventId
router.post("/notifications/dispatch/:alertEventId", async (req, res): Promise<void> => {
  const alertEventId = parseInt(req.params.alertEventId, 10);
  if (isNaN(alertEventId)) {
    res.status(400).json({ error: "Invalid alertEventId" });
    return;
  }

  const result = await dispatchNotifications(alertEventId);
  res.json(result);
});

// GET /notifications/deliveries/:alertEventId
router.get("/notifications/deliveries/:alertEventId", async (req, res): Promise<void> => {
  const alertEventId = parseInt(req.params.alertEventId, 10);
  if (isNaN(alertEventId)) {
    res.status(400).json({ error: "Invalid alertEventId" });
    return;
  }

  const deliveries = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.alertEventId, alertEventId))
    .orderBy(desc(notificationDeliveriesTable.createdAt));

  res.json({ deliveries });
});

export default router;
