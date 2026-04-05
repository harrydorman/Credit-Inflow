/**
 * Unit tests for pure helper functions in ingestionService.
 *
 * Runs with Node.js built-in test runner (no external test framework needed):
 *   node --import tsx/esm --test src/services/__tests__/ingestionService.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContentFingerprint, sanitizeNullStr, sanitizeIssuer } from "../ingestionHelpers.js";

// ── sanitizeNullStr ────────────────────────────────────────────────────────────

describe("sanitizeNullStr", () => {
  it("returns null for null input", () => {
    assert.strictEqual(sanitizeNullStr(null), null);
  });

  it("returns null for undefined input", () => {
    assert.strictEqual(sanitizeNullStr(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(sanitizeNullStr(""), null);
  });

  it("returns null for whitespace-only string", () => {
    assert.strictEqual(sanitizeNullStr("   "), null);
  });

  it('returns null for "null" string', () => {
    assert.strictEqual(sanitizeNullStr("null"), null);
  });

  it('returns null for "undefined" string', () => {
    assert.strictEqual(sanitizeNullStr("undefined"), null);
  });

  it('returns null for "N/A" string', () => {
    assert.strictEqual(sanitizeNullStr("N/A"), null);
  });

  it('returns null for "n/a" string', () => {
    assert.strictEqual(sanitizeNullStr("n/a"), null);
  });

  it("trims whitespace and returns value", () => {
    assert.strictEqual(sanitizeNullStr("  hello world  "), "hello world");
  });

  it("returns non-empty string as-is", () => {
    assert.strictEqual(sanitizeNullStr("Ford Motor Company"), "Ford Motor Company");
  });
});

// ── sanitizeIssuer ─────────────────────────────────────────────────────────────

describe("sanitizeIssuer", () => {
  it("returns null for null input", () => {
    assert.strictEqual(sanitizeIssuer(null), null);
  });

  it("returns null for 'null' string", () => {
    assert.strictEqual(sanitizeIssuer("null"), null);
  });

  it("returns a non-null string for a real issuer", () => {
    const result = sanitizeIssuer("Ford Motor Company");
    assert.ok(result !== null, "should return non-null for a real issuer");
    assert.ok(result!.length > 0, "should return a non-empty string");
  });
});

// ── computeContentFingerprint ─────────────────────────────────────────────────

describe("computeContentFingerprint", () => {
  it("returns a 16-character hex string", () => {
    const fp = computeContentFingerprint("Test title", "Some content");
    assert.strictEqual(fp.length, 16);
    assert.match(fp, /^[0-9a-f]+$/);
  });

  it("is deterministic for the same inputs", () => {
    const fp1 = computeContentFingerprint("Same title", "Same content");
    const fp2 = computeContentFingerprint("Same title", "Same content");
    assert.strictEqual(fp1, fp2);
  });

  it("produces different fingerprints for different titles", () => {
    const fp1 = computeContentFingerprint("Title A", "Same content");
    const fp2 = computeContentFingerprint("Title B", "Same content");
    assert.notStrictEqual(fp1, fp2);
  });

  it("produces different fingerprints for different content", () => {
    const fp1 = computeContentFingerprint("Same title", "Content A");
    const fp2 = computeContentFingerprint("Same title", "Content B");
    assert.notStrictEqual(fp1, fp2);
  });

  it("handles null content gracefully", () => {
    const fp = computeContentFingerprint("Some title", null);
    assert.strictEqual(fp.length, 16);
  });

  it("is case-insensitive for deduplication (normalizes to lowercase)", () => {
    const fp1 = computeContentFingerprint("Ford Motor DOWNGRADE", "Bond prices fall on credit concern");
    const fp2 = computeContentFingerprint("ford motor downgrade", "bond prices fall on credit concern");
    assert.strictEqual(fp1, fp2, "fingerprints should match regardless of case");
  });

  it("normalizes extra whitespace in title", () => {
    const fp1 = computeContentFingerprint("Ford  Motor  Downgrade", "content");
    const fp2 = computeContentFingerprint("Ford Motor Downgrade", "content");
    assert.strictEqual(fp1, fp2, "extra whitespace in title should be normalized");
  });

  it("only uses first 300 chars of content for fingerprint", () => {
    const shortContent = "A".repeat(300);
    const longContent = "A".repeat(300) + "B".repeat(500);
    const fp1 = computeContentFingerprint("Title", shortContent);
    const fp2 = computeContentFingerprint("Title", longContent);
    assert.strictEqual(fp1, fp2, "content beyond 300 chars should not affect fingerprint");
  });

  it("detects near-duplicate article with different URL but same content", () => {
    const title = "Ford Motor credit downgrade triggers loan sell-off";
    const content = "Ford Motor's debt was downgraded by Moody's, triggering spread widening in the HY market.";

    // Simulate same story re-published with slightly different title casing
    const fp1 = computeContentFingerprint(title, content);
    const fp2 = computeContentFingerprint(title.toUpperCase(), content.toUpperCase());
    assert.strictEqual(fp1, fp2, "same story with different casing should produce same fingerprint");
  });
});
