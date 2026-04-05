import { pgTable, serial, text, timestamp, integer, uniqueIndex, index, uuid } from "drizzle-orm/pg-core";
import { organizationsTable } from "./tenants";

export const watchlistsTable = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  /** Owning organization. Nullable so existing rows without an org remain valid. */
  organizationId: uuid("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
(t) => [
  index("watchlists_org_idx").on(t.organizationId),
]);

export type Watchlist = typeof watchlistsTable.$inferSelect;
export type NewWatchlist = typeof watchlistsTable.$inferInsert;

export const watchlistItemsTable = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlistsTable.id, { onDelete: "cascade" }),
    issuerName: text("issuer_name").notNull(),
    normalizedIssuerName: text("normalized_issuer_name").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_watchlist_item").on(table.watchlistId, table.normalizedIssuerName),
    index("watchlist_items_normalized_idx").on(table.normalizedIssuerName),
  ],
);

export type WatchlistItem = typeof watchlistItemsTable.$inferSelect;
export type NewWatchlistItem = typeof watchlistItemsTable.$inferInsert;
