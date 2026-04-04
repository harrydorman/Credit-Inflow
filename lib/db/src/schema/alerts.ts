import { pgTable, serial, text, integer, boolean, json, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { watchlistsTable } from "./watchlists";
import { articlesTable } from "./articles";

export const alertRulesTable = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  watchlistId: integer("watchlist_id")
    .notNull()
    .references(() => watchlistsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  minimumUrgency: integer("minimum_urgency"),
  eventTypes: json("event_types").$type<string[]>(),
  covenantFlagOnly: boolean("covenant_flag_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertRule = typeof alertRulesTable.$inferSelect;
export type NewAlertRule = typeof alertRulesTable.$inferInsert;

export const alertEventsTable = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    alertRuleId: integer("alert_rule_id")
      .notNull()
      .references(() => alertRulesTable.id, { onDelete: "cascade" }),
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlistsTable.id, { onDelete: "cascade" }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    issuerName: text("issuer_name").notNull(),
    title: text("title").notNull(),
    urgency: integer("urgency"),
    eventType: text("event_type"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    isRead: boolean("is_read").notNull().default(false),
  },
  (table) => [
    uniqueIndex("uq_alert_event").on(table.alertRuleId, table.articleId),
  ],
);

export type AlertEvent = typeof alertEventsTable.$inferSelect;
export type NewAlertEvent = typeof alertEventsTable.$inferInsert;
