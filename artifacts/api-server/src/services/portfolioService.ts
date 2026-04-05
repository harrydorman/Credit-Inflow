/**
 * services/portfolioService.ts
 *
 * Phase 3: Portfolio ingestion and issuer mapping service.
 *
 * ingestPortfolioCSV(portfolioId, csvContent):
 *   - Parses CSV lines (issuerName, positionSize, ...extras)
 *   - Normalizes issuer names via canonicalizeIssuer
 *   - Creates portfolio_holdings + portfolio_issuer_map rows
 *   - Returns a summary of what was ingested
 *
 * The CSV format expected:
 *   issuer_name,position_size[,extra_col1,extra_col2,...]
 *   (header row is required; extra columns are stored in metadata)
 */
import {
  db,
  portfoliosTable,
  portfolioHoldingsTable,
  portfolioIssuerMapTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { canonicalizeIssuer } from "../lib/canonicalIssuers";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioCSVRow {
  issuerName: string;
  positionSize: number | null;
  metadata: Record<string, string>;
}

export interface PortfolioIngestionResult {
  portfolioId: number;
  rowsProcessed: number;
  holdingsCreated: number;
  holdingsSkipped: number;
  issuersMapped: number;
  issuersUnmapped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parses a raw CSV string into typed rows.
 *
 * Expected header: issuer_name,position_size[,col3,col4,...]
 *
 * Rows with missing/empty issuer_name are skipped.
 */
export function parsePortfolioCSV(csvContent: string): PortfolioCSVRow[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const issuerIdx = headers.indexOf("issuer_name");
  const sizeIdx = headers.indexOf("position_size");

  if (issuerIdx === -1) {
    throw new Error('CSV missing required column "issuer_name"');
  }

  const rows: PortfolioCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const issuerName = cols[issuerIdx];

    if (!issuerName) continue;

    const positionSize =
      sizeIdx !== -1 && cols[sizeIdx] ? parseFloat(cols[sizeIdx]) : null;

    // Capture extra columns as metadata (bounded by actual column count)
    const metadata: Record<string, string> = {};
    const colCount = Math.min(headers.length, cols.length);
    for (let j = 0; j < colCount; j++) {
      if (j === issuerIdx || j === sizeIdx) continue;
      if (cols[j]) metadata[headers[j]] = cols[j];
    }

    rows.push({
      issuerName,
      positionSize: positionSize !== null && !isNaN(positionSize) ? positionSize : null,
      metadata,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

/**
 * Ingests CSV holdings into an existing portfolio, normalizing issuer names.
 *
 * This function is additive — it does NOT clear existing holdings before
 * inserting new ones. Call it once per CSV upload. For a full replacement,
 * delete existing holdings first (not done here to avoid accidental data loss).
 */
export async function ingestPortfolioCSV(
  portfolioId: number,
  csvContent: string
): Promise<PortfolioIngestionResult> {
  const result: PortfolioIngestionResult = {
    portfolioId,
    rowsProcessed: 0,
    holdingsCreated: 0,
    holdingsSkipped: 0,
    issuersMapped: 0,
    issuersUnmapped: 0,
    errors: [],
  };

  // Verify portfolio exists
  const [portfolio] = await db
    .select({ id: portfoliosTable.id })
    .from(portfoliosTable)
    .where(eq(portfoliosTable.id, portfolioId))
    .limit(1);

  if (!portfolio) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }

  let rows: PortfolioCSVRow[];
  try {
    rows = parsePortfolioCSV(csvContent);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    result.errors.push(`CSV parse error: ${msg}`);
    return result;
  }

  result.rowsProcessed = rows.length;

  for (const row of rows) {
    try {
      // Insert holding
      const [holding] = await db
        .insert(portfolioHoldingsTable)
        .values({
          portfolioId,
          issuerName: row.issuerName,
          positionSize: row.positionSize ?? undefined,
          metadata: Object.keys(row.metadata).length > 0 ? row.metadata : undefined,
        })
        .returning({ id: portfolioHoldingsTable.id });

      if (!holding) {
        result.holdingsSkipped++;
        continue;
      }

      result.holdingsCreated++;

      // Resolve canonical issuer name
      const canonical = canonicalizeIssuer(row.issuerName);

      if (canonical) {
        await db.insert(portfolioIssuerMapTable).values({
          portfolioHoldingId: holding.id,
          canonicalIssuerName: canonical,
          confidence: canonical.toLowerCase() === row.issuerName.toLowerCase() ? 1.0 : 0.85,
          source: "heuristic",
        });
        result.issuersMapped++;
      } else {
        // Store the raw name as canonical so it's still queryable
        await db.insert(portfolioIssuerMapTable).values({
          portfolioHoldingId: holding.id,
          canonicalIssuerName: row.issuerName,
          confidence: 0.5,
          source: "heuristic",
        });
        result.issuersUnmapped++;
      }
    } catch (rowErr) {
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      result.errors.push(`Row "${row.issuerName}": ${msg}`);
      logger.warn({ portfolioId, issuerName: row.issuerName, err: rowErr }, "portfolio ingestion: row error");
    }
  }

  logger.info(
    {
      portfolioId,
      rowsProcessed: result.rowsProcessed,
      holdingsCreated: result.holdingsCreated,
      issuersMapped: result.issuersMapped,
      issuersUnmapped: result.issuersUnmapped,
      errors: result.errors.length,
    },
    "portfolio: CSV ingestion complete"
  );

  return result;
}
