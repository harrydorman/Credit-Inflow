/**
 * schema/notifications.ts
 *
 * Notification channels and delivery tracking for Phase 3.
 *
 * notification_channels    — configured delivery endpoints per organization
 * notification_deliveries  — individual delivery attempts per alert event
 */
import {
  pgTable,
  serial,
  integer,
  uuid,
  text,
  json,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./tenants";
import { alertEventsTable } from "./alerts";

// ---------------------------------------------------------------------------
// notification_channels
// ---------------------------------------------------------------------------

export type NotificationChannelType = "email" | "slack";
export type NotificationDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

export const notificationChannelsTable = pgTable(
  "notification_channels",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<NotificationChannelType>().notNull(),
    /**
     * Provider-specific configuration (stored as JSON).
     *
     * For email:  { to: string[], subject_prefix?: string }
     * For slack:  { webhookUrl: string, channel?: string }
     *
     * Sensitive values (webhook URLs, SMTP credentials) should be stored as
     * references to a secrets manager in production. For now they are stored
     * directly to keep the implementation simple.
     */
    config: json("config").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_channels_org_idx").on(t.organizationId),
  ]
);

export type NotificationChannel = typeof notificationChannelsTable.$inferSelect;
export type NewNotificationChannel = typeof notificationChannelsTable.$inferInsert;

// ---------------------------------------------------------------------------
// notification_deliveries
// ---------------------------------------------------------------------------

export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),
    alertEventId: integer("alert_event_id")
      .notNull()
      .references(() => alertEventsTable.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => notificationChannelsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<NotificationDeliveryStatus>().notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Error message when status = "failed". */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_deliveries_alert_event_idx").on(t.alertEventId),
    index("notification_deliveries_channel_idx").on(t.channelId),
    index("notification_deliveries_status_idx").on(t.status),
  ]
);

export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveriesTable.$inferInsert;
