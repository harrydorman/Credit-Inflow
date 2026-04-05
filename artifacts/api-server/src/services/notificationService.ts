/**
 * services/notificationService.ts
 *
 * Phase 3: Notification dispatch service.
 *
 * dispatchNotifications(alertEventId):
 *   - Fetches the alert event and all notification channels for the owning org
 *   - For each channel, calls the appropriate provider adapter
 *   - Records each attempt in notification_deliveries (queued → sent / failed)
 *
 * Provider adapters are thin abstractions — adding a new channel type (e.g.
 * PagerDuty, Teams) requires only adding a new case in dispatchToChannel().
 *
 * Design principles:
 *   - Never throws (caller is not affected by notification failures)
 *   - All delivery attempts are recorded for auditing
 *   - Adapters are injected-style; the interface is well-typed for testing
 */
import {
  db,
  alertEventsTable,
  alertRulesTable,
  notificationChannelsTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { NotificationChannelType } from "@workspace/db";

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  issuerName: string;
  eventType: string | null;
  severity: string | null;
  confidence: number | null;
  urgency: number | null;
  articleId: number;
  alertRuleName: string;
  triggeredAt: Date;
}

export interface ChannelAdapter {
  send(
    config: Record<string, unknown>,
    payload: NotificationPayload
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Built-in adapters
// ---------------------------------------------------------------------------

/** Email adapter (console stub — replace with nodemailer / SendGrid in production). */
const emailAdapter: ChannelAdapter = {
  async send(config, payload) {
    const to = config.to as string[] | undefined;
    logger.info(
      {
        channel: "email",
        to,
        issuerName: payload.issuerName,
        severity: payload.severity,
        articleId: payload.articleId,
      },
      "notification: email dispatch (stub)"
    );
    // In production: await sendEmail({ to, subject, body });
  },
};

/** Slack adapter (HTTP webhook stub — replace with actual POST in production). */
const slackAdapter: ChannelAdapter = {
  async send(config, payload) {
    const webhookUrl = config.webhookUrl as string | undefined;
    logger.info(
      {
        channel: "slack",
        webhookUrl: webhookUrl ? "[redacted]" : undefined,
        issuerName: payload.issuerName,
        severity: payload.severity,
        articleId: payload.articleId,
      },
      "notification: slack dispatch (stub)"
    );
    // In production:
    // await fetch(webhookUrl, { method: "POST", body: JSON.stringify({ text: formatSlackMessage(payload) }) });
  },
};

const ADAPTERS: Record<NotificationChannelType, ChannelAdapter> = {
  email: emailAdapter,
  slack: slackAdapter,
};

// ---------------------------------------------------------------------------
// Main dispatch function
// ---------------------------------------------------------------------------

export interface NotificationDispatchResult {
  alertEventId: number;
  channelsAttempted: number;
  channelsSent: number;
  channelsFailed: number;
  channelsSkipped: number;
}

/**
 * Dispatches notifications for the given alert event to all configured
 * notification channels of the owning organization.
 *
 * Returns a summary of dispatch outcomes. Never throws.
 */
export async function dispatchNotifications(
  alertEventId: number
): Promise<NotificationDispatchResult> {
  const result: NotificationDispatchResult = {
    alertEventId,
    channelsAttempted: 0,
    channelsSent: 0,
    channelsFailed: 0,
    channelsSkipped: 0,
  };

  try {
    // ── Fetch alert event + rule ────────────────────────────────────────────
    const [eventRow] = await db
      .select({
        id: alertEventsTable.id,
        issuerName: alertEventsTable.issuerName,
        eventType: alertEventsTable.eventType,
        severity: alertEventsTable.severity,
        confidence: alertEventsTable.confidence,
        urgency: alertEventsTable.urgency,
        articleId: alertEventsTable.articleId,
        triggeredAt: alertEventsTable.triggeredAt,
        alertRuleId: alertEventsTable.alertRuleId,
        organizationId: alertRulesTable.organizationId,
        alertRuleName: alertRulesTable.name,
      })
      .from(alertEventsTable)
      .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
      .where(eq(alertEventsTable.id, alertEventId))
      .limit(1);

    if (!eventRow) {
      logger.warn({ alertEventId }, "dispatchNotifications: alert event not found");
      return result;
    }

    if (!eventRow.organizationId) {
      // No org attached → no channels configured
      return result;
    }

    // ── Fetch notification channels for the org ─────────────────────────────
    const channels = await db
      .select()
      .from(notificationChannelsTable)
      .where(eq(notificationChannelsTable.organizationId, eventRow.organizationId));

    if (channels.length === 0) return result;

    const payload: NotificationPayload = {
      issuerName: eventRow.issuerName,
      eventType: eventRow.eventType,
      severity: eventRow.severity,
      confidence: eventRow.confidence,
      urgency: eventRow.urgency,
      articleId: eventRow.articleId,
      alertRuleName: eventRow.alertRuleName,
      triggeredAt: eventRow.triggeredAt,
    };

    // ── Dispatch to each channel ────────────────────────────────────────────
    for (const channel of channels) {
      result.channelsAttempted++;

      const adapter = ADAPTERS[channel.type as NotificationChannelType];
      if (!adapter) {
        // Unknown channel type → skip
        await db.insert(notificationDeliveriesTable).values({
          alertEventId,
          channelId: channel.id,
          status: "skipped",
          error: `Unknown channel type: ${channel.type}`,
        });
        result.channelsSkipped++;
        continue;
      }

      // Create a "queued" delivery record first
      const [delivery] = await db
        .insert(notificationDeliveriesTable)
        .values({
          alertEventId,
          channelId: channel.id,
          status: "queued",
        })
        .returning({ id: notificationDeliveriesTable.id });

      try {
        await adapter.send(channel.config as Record<string, unknown>, payload);

        // Mark as sent
        await db
          .update(notificationDeliveriesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(notificationDeliveriesTable.id, delivery.id));

        result.channelsSent++;
      } catch (sendErr) {
        const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);

        await db
          .update(notificationDeliveriesTable)
          .set({ status: "failed", error: errorMsg })
          .where(eq(notificationDeliveriesTable.id, delivery.id));

        logger.error(
          { alertEventId, channelId: channel.id, channelType: channel.type, err: sendErr },
          "notification: channel dispatch failed"
        );
        result.channelsFailed++;
      }
    }

    logger.info(
      {
        alertEventId,
        channelsAttempted: result.channelsAttempted,
        channelsSent: result.channelsSent,
        channelsFailed: result.channelsFailed,
      },
      "notification: dispatch complete"
    );

    return result;
  } catch (err) {
    logger.error({ err, alertEventId }, "dispatchNotifications: unexpected error");
    return result;
  }
}
