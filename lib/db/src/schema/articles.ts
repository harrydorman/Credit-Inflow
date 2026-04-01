import { pgTable, text, serial, timestamp, boolean, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  url: text("url").notNull().unique(),
  rawContent: text("raw_content"),
  summary: text("summary"),
  sector: text("sector"),
  eventType: text("event_type"),
  sentiment: text("sentiment"),
  whyItMatters: text("why_it_matters"),
  whoCares: text("who_cares"),
  cloImpact: boolean("clo_impact").notNull().default(false),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
