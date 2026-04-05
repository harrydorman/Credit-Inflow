/**
 * schema/portfolios.ts
 *
 * Portfolio tables for Phase 3: portfolio holdings and issuer mapping.
 *
 * portfolios               — a named collection of credit positions per org
 * portfolio_holdings       — individual issuer exposures within a portfolio
 * portfolio_issuer_map     — canonical issuer resolution for each holding
 */
import {
  pgTable,
  uuid,
  serial,
  integer,
  text,
  real,
  json,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./tenants";

// ---------------------------------------------------------------------------
// portfolios
// ---------------------------------------------------------------------------

export const portfoliosTable = pgTable(
  "portfolios",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolios_org_idx").on(t.organizationId),
  ]
);

export type Portfolio = typeof portfoliosTable.$inferSelect;
export type NewPortfolio = typeof portfoliosTable.$inferInsert;

// ---------------------------------------------------------------------------
// portfolio_holdings
// ---------------------------------------------------------------------------

export const portfolioHoldingsTable = pgTable(
  "portfolio_holdings",
  {
    id: serial("id").primaryKey(),
    portfolioId: integer("portfolio_id")
      .notNull()
      .references(() => portfoliosTable.id, { onDelete: "cascade" }),
    /** Raw issuer name as ingested from the CSV/API (before normalization). */
    issuerName: text("issuer_name").notNull(),
    /** Notional position size (currency-agnostic; unit is defined by the tenant). */
    positionSize: real("position_size"),
    /** Additional fields from the source CSV/API, stored as-is for auditability. */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_holdings_portfolio_idx").on(t.portfolioId),
  ]
);

export type PortfolioHolding = typeof portfolioHoldingsTable.$inferSelect;
export type NewPortfolioHolding = typeof portfolioHoldingsTable.$inferInsert;

// ---------------------------------------------------------------------------
// portfolio_issuer_map
// ---------------------------------------------------------------------------

export type IssuerMappingSource = "heuristic" | "ai";

export const portfolioIssuerMapTable = pgTable(
  "portfolio_issuer_map",
  {
    id: serial("id").primaryKey(),
    portfolioHoldingId: integer("portfolio_holding_id")
      .notNull()
      .references(() => portfolioHoldingsTable.id, { onDelete: "cascade" }),
    /** The canonical issuer name resolved from the raw holding name. */
    canonicalIssuerName: text("canonical_issuer_name").notNull(),
    /** 0.0 – 1.0 mapping confidence (1.0 = exact canonical match). */
    confidence: real("confidence").notNull().default(1.0),
    /** How the canonical name was resolved. */
    source: text("source").$type<IssuerMappingSource>().notNull().default("heuristic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_issuer_map_holding_idx").on(t.portfolioHoldingId),
    index("portfolio_issuer_map_canonical_idx").on(t.canonicalIssuerName),
  ]
);

export type PortfolioIssuerMap = typeof portfolioIssuerMapTable.$inferSelect;
export type NewPortfolioIssuerMap = typeof portfolioIssuerMapTable.$inferInsert;
