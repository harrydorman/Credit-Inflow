import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const watchlistsTable = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (table) => [uniqueIndex("uq_watchlist_item").on(table.watchlistId, table.normalizedIssuerName)],
);

export type WatchlistItem = typeof watchlistItemsTable.$inferSelect;
export type NewWatchlistItem = typeof watchlistItemsTable.$inferInsert;
