/**
 * Tests for the deduplication service.
 *
 * DB calls are mocked via vi.mock so no real database is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeTitle,
  normalizeContent,
  fingerprintTitle,
  fingerprintContent,
  isDuplicate,
} from "../services/deduplication";

// ---------------------------------------------------------------------------
// Mock @workspace/db so tests don't need a real Postgres connection
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
  articlesTable: {
    url: "url",
    titleFingerprint: "title_fingerprint",
    contentFingerprint: "content_fingerprint",
  },
}));

vi.mock("drizzle-orm", () => ({
  or: (...args: unknown[]) => ({ type: "or", args }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
}));

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------
describe("normalizeTitle", () => {
  it("lowercases the string", () => {
    expect(normalizeTitle("HELLO WORLD")).toBe("hello world");
  });

  it("strips punctuation", () => {
    expect(normalizeTitle("Hello, World! (2024)")).toBe("hello world 2024");
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("  multiple   spaces  ")).toBe("multiple spaces");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeContent
// ---------------------------------------------------------------------------
describe("normalizeContent", () => {
  it("lowercases content", () => {
    expect(normalizeContent("HELLO")).toBe("hello");
  });

  it("truncates to 1000 chars after normalisation", () => {
    const long = "a ".repeat(600); // 1200 chars
    const result = normalizeContent(long);
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  it("handles empty string", () => {
    expect(normalizeContent("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fingerprintTitle
// ---------------------------------------------------------------------------
describe("fingerprintTitle", () => {
  it("returns a 64-char hex string", () => {
    const fp = fingerprintTitle("Hello World");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(fingerprintTitle("Credit downgrades")).toBe(fingerprintTitle("Credit downgrades"));
  });

  it("is case-insensitive (same title different case → same fingerprint)", () => {
    expect(fingerprintTitle("Credit Downgrades")).toBe(fingerprintTitle("credit downgrades"));
  });

  it("differs for different titles", () => {
    expect(fingerprintTitle("Title A")).not.toBe(fingerprintTitle("Title B"));
  });
});

// ---------------------------------------------------------------------------
// fingerprintContent
// ---------------------------------------------------------------------------
describe("fingerprintContent", () => {
  it("returns a 64-char hex string for non-empty content", () => {
    const fp = fingerprintContent("Some article content here.");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null for empty content", () => {
    expect(fingerprintContent("")).toBeNull();
    expect(fingerprintContent("   ")).toBeNull();
  });

  it("is deterministic", () => {
    const content = "Federal Reserve raises rates by 25bp";
    expect(fingerprintContent(content)).toBe(fingerprintContent(content));
  });
});

// ---------------------------------------------------------------------------
// isDuplicate (with mocked DB)
// ---------------------------------------------------------------------------
describe("isDuplicate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns false when no DB hit is found", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([]);

    const result = await isDuplicate({
      url: "https://example.com/article",
      titleFingerprint: fingerprintTitle("Some Title"),
      contentFingerprint: fingerprintContent("Some content"),
    });
    expect(result).toBe(false);
  });

  it("returns true when a DB row is returned", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([{ id: 42 }]);

    const result = await isDuplicate({
      url: "https://example.com/article",
      titleFingerprint: fingerprintTitle("Some Title"),
      contentFingerprint: null,
    });
    expect(result).toBe(true);
  });
});
