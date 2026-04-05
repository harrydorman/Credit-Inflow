/**
 * Pure helper functions for ingestion — no external I/O or DB dependencies.
 * Kept separate so unit tests can import without requiring a DB connection.
 */

import { createHash } from "node:crypto";
import { canonicalizeIssuer } from "../lib/canonicalIssuers.js";

export function sanitizeNullStr(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined" || trimmed === "N/A" || trimmed === "n/a") return null;
  return trimmed;
}

export function sanitizeIssuer(val: string | null | undefined): string | null {
  return canonicalizeIssuer(sanitizeNullStr(val));
}

/**
 * Computes a 16-character content fingerprint for deduplication.
 *
 * The fingerprint is derived from a normalized combination of the article
 * title and the first 300 characters of its content. This catches
 * re-published articles that share the same story but have different URLs.
 */
export function computeContentFingerprint(title: string, content: string | null): string {
  const normalized =
    `${title.trim().toLowerCase().replace(/\s+/g, " ")}|${(content ?? "").trim().slice(0, 300).toLowerCase()}`;
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}
