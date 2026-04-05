/**
 * deduplication.ts
 *
 * Generates and checks content/title fingerprints to detect near-duplicate
 * articles beyond the existing URL-only check.
 *
 * Fingerprints are sha256 hex digests of normalised strings so they are
 * stable, compact, and can be indexed in Postgres.
 */
import { createHash } from "crypto";
import { db, articlesTable } from "@workspace/db";
import { or, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Maximum number of characters used for content fingerprinting. */
export const MAX_CONTENT_FINGERPRINT_CHARS = 1000;

/**
 * Normalises a title string for fingerprinting:
 *  - lowercase
 *  - remove punctuation / special chars
 *  - collapse whitespace
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalises content for fingerprinting.
 * We only hash the first 1 000 chars so that minor trailing differences
 * (e.g. appended ads or "read more" links) don't break deduplication.
 */
export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_FINGERPRINT_CHARS);
}

// ---------------------------------------------------------------------------
// Fingerprint generation
// ---------------------------------------------------------------------------

export function fingerprintTitle(title: string): string {
  return createHash("sha256").update(normalizeTitle(title)).digest("hex");
}

export function fingerprintContent(content: string): string | null {
  const normalised = normalizeContent(content);
  if (!normalised) return null;
  return createHash("sha256").update(normalised).digest("hex");
}

// ---------------------------------------------------------------------------
// DB-backed duplicate check
// ---------------------------------------------------------------------------

export interface FingerprintSet {
  url: string;
  titleFingerprint: string;
  contentFingerprint: string | null;
}

/**
 * Checks whether an article already exists in the database based on:
 *  1. Exact URL match (existing behaviour, kept for safety)
 *  2. Matching title fingerprint
 *  3. Matching content fingerprint (when available)
 *
 * Returns `true` if a duplicate is found.
 */
export async function isDuplicate(fps: FingerprintSet): Promise<boolean> {
  const conditions = [
    eq(articlesTable.url, fps.url),
    eq(articlesTable.titleFingerprint, fps.titleFingerprint),
  ];
  if (fps.contentFingerprint) {
    conditions.push(eq(articlesTable.contentFingerprint, fps.contentFingerprint));
  }

  const [hit] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(or(...conditions))
    .limit(1);

  return !!hit;
}

/**
 * Bulk URL existence check.  Returns a Set of URLs already in the DB.
 * Used as a fast first-pass before fingerprint checks.
 */
export async function existingUrlSet(): Promise<Set<string>> {
  const rows = await db
    .select({ url: articlesTable.url })
    .from(articlesTable);
  return new Set(rows.map((r) => r.url));
}
