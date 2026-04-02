import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Scheduled ingestion ────────────────────────────────────────────────────────
// Runs a refresh + backfill on startup and then every 45 minutes.
// Uses fetch against the running server so all route logic (logging, ETF snapshot,
// market validation) runs exactly as it does for a manual trigger.
const INGESTION_INTERVAL_MS = 45 * 60 * 1000;

async function runScheduledCycle(label: string): Promise<void> {
  const base = `http://localhost:${port}/api`;

  try {
    logger.info({ label }, "Scheduled ingestion: starting refresh");
    const refreshRes = await fetch(`${base}/refresh`, { method: "POST" });
    if (!refreshRes.ok) {
      logger.warn({ status: refreshRes.status, label }, "Scheduled refresh returned non-2xx");
    } else {
      const refreshData = (await refreshRes.json()) as Record<string, unknown>;
      logger.info({ label, ...refreshData }, "Scheduled ingestion: refresh complete");
    }
  } catch (err) {
    logger.error({ err, label }, "Scheduled ingestion: refresh failed");
  }

  try {
    logger.info({ label }, "Scheduled ingestion: starting structured-output backfill");
    const backfillRes = await fetch(`${base}/refresh/backfill`, { method: "POST" });
    if (!backfillRes.ok) {
      logger.warn({ status: backfillRes.status, label }, "Scheduled backfill returned non-2xx");
    } else {
      const backfillData = (await backfillRes.json()) as Record<string, unknown>;
      logger.info({ label, ...backfillData }, "Scheduled ingestion: backfill complete");
    }
  } catch (err) {
    logger.error({ err, label }, "Scheduled ingestion: backfill failed");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Initial cycle: delay 8 s to let the server fully start and DB connect
  setTimeout(() => {
    void runScheduledCycle("startup");
  }, 8000);

  // Subsequent cycles every 45 minutes
  setInterval(() => {
    void runScheduledCycle("scheduled");
  }, INGESTION_INTERVAL_MS);
});
