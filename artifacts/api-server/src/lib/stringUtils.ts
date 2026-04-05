/**
 * lib/stringUtils.ts
 *
 * Shared string sanitisation helpers used by both the ingestion service and
 * the pipeline runner.  Extracted to a standalone module so neither service
 * depends on the other (avoiding a circular import).
 */

/**
 * Normalises a string value that may represent "no value".
 *
 * Returns `null` when the input is:
 *   - null or undefined
 *   - empty / whitespace-only
 *   - a sentinel string ("null", "undefined", "N/A", "n/a")
 *
 * Otherwise trims and returns the value.
 */
export function sanitizeNullStr(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (
    trimmed === "" ||
    trimmed === "null" ||
    trimmed === "undefined" ||
    trimmed === "N/A" ||
    trimmed === "n/a"
  )
    return null;
  return trimmed;
}
