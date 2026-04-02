/**
 * Centralized environment configuration for the API server.
 *
 * All process.env reads for application-level config live here.
 * DATABASE_URL is intentionally excluded — it is read by @workspace/db
 * at import time and cannot be moved here without restructuring that package.
 *
 * Import order note: this module has no internal project imports, so it is
 * safe to import from any other module without creating circular dependencies.
 */

// ── Server port ───────────────────────────────────────────────────────────────
// Precedence: PORT (Replit-injected per-artifact) → API_PORT (local dev) → 8080
const rawPort = process.env.PORT ?? process.env.API_PORT ?? "8080";
const resolvedPort = Number(rawPort);
if (Number.isNaN(resolvedPort) || resolvedPort <= 0) {
  throw new Error(
    `Invalid port value "${rawPort}" (from ${
      process.env.PORT !== undefined ? "PORT"
      : process.env.API_PORT !== undefined ? "API_PORT"
      : "default"
    }). Must be a positive integer.`,
  );
}

export const config = {
  // ── Server ──────────────────────────────────────────────────────────────────
  port: resolvedPort,

  nodeEnv: process.env.NODE_ENV ?? "development",

  // ── Logging ─────────────────────────────────────────────────────────────────
  logLevel: process.env.LOG_LEVEL ?? "info",

  // ── AI / OpenAI ─────────────────────────────────────────────────────────────
  // Replit AI proxy vars take priority; standard OPENAI_API_KEY is the fallback.
  // Both point at the same OpenAI API — only the base URL and key differ.
  openai: {
    apiKey:
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },

  // ── News feeds ──────────────────────────────────────────────────────────────
  // Optional — RSS feeds are the primary source. NewsAPI is currently invalid.
  newsApiKey: process.env.NEWS_API_KEY,
} as const;
