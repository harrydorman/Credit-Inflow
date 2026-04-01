/**
 * Market Data Service
 * Uses Yahoo Finance's public chart API — no API key required.
 * Provides ETF moves (HYG, LQD) and per-issuer stock moves.
 * Caches results for 15 minutes to avoid rate limiting.
 */

import { logger } from "./logger";

interface PriceData {
  ticker: string;
  move1D: number | null;   // % return over 1 day
  move5D: number | null;   // % return over 5 days
  lastClose: number | null;
  fetchedAt: Date;
}

interface MarketSnapshot {
  hyg: PriceData | null;   // HYG = HY credit proxy
  lqd: PriceData | null;   // LQD = IG credit proxy
  fetchedAt: Date;
}

// ── In-memory cache (15 min TTL) ─────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000;
const stockCache = new Map<string, PriceData>();
let etfSnapshotCache: MarketSnapshot | null = null;

// ── Issuer name → ticker map ──────────────────────────────────────────────────
// Covers the most frequently mentioned HY/CLO credit names
const ISSUER_TICKER_MAP: Record<string, string> = {
  // Retail
  "macy's": "M", "macys": "M",
  "nordstrom": "JWN",
  "foot locker": "FL",
  "gap": "GPS",
  "kohl's": "KSS", "kohls": "KSS",
  "dollar tree": "DLTR",
  "dollar general": "DG",
  "wayfair": "W",
  "bed bath beyond": "BBBY",
  // Energy
  "chesapeake energy": "CHK",
  "callon petroleum": "CPE",
  "denbury": "DEN",
  "crestwood": "CEQP",
  "sunoco": "SUN",
  "par pacific": "PARR",
  // Healthcare
  "envision healthcare": "EVHC",
  "team health": "TDOC",
  "radnet": "RDNT",
  "surgery partners": "SGRY",
  "option care health": "OPCH",
  // Technology
  "dell": "DELL", "dell technologies": "DELL",
  "hp": "HPQ", "hewlett packard": "HPQ",
  "xerox": "XRX",
  "lumen": "LUMN", "lumen technologies": "LUMN",
  "avaya": "AVYA",
  "mcafee": "MCFE",
  "nielsen": "NLSN",
  // Telecom / Media
  "directv": "T",
  "dish network": "DISH",
  "iheartmedia": "IHRT",
  "cumulus media": "CMLS",
  "clear channel": "CCO",
  // Industrials
  "transdigm": "TDG",
  "gates industrial": "GTES",
  "haynes international": "HAYN",
  "moog": "MOG-A",
  "wesco international": "WCC",
  // Consumer / Gaming
  "caesars": "CZR", "caesars entertainment": "CZR",
  "mgm": "MGM", "mgm resorts": "MGM",
  "las vegas sands": "LVS",
  "penn national": "PENN", "penn entertainment": "PENN",
  "royal caribbean": "RCL",
  "carnival": "CCL",
  // Big names
  "ford": "F", "ford motor": "F",
  "gm": "GM", "general motors": "GM",
  "boeing": "BA",
  "mccormick": "MKC",
  "nike": "NKE",
  "amazon": "AMZN",
  "meta": "META",
  "google": "GOOGL", "alphabet": "GOOGL",
  "apple": "AAPL",
  "microsoft": "MSFT",
  "tesla": "TSLA",
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

export function getTickerForIssuer(issuerName: string): string | null {
  const normalized = normalizeName(issuerName);
  for (const [key, ticker] of Object.entries(ISSUER_TICKER_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return ticker;
  }
  return null;
}

// ── Yahoo Finance price fetcher ───────────────────────────────────────────────
async function fetchYahooPrice(ticker: string): Promise<PriceData | null> {
  const cached = stockCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=6d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CreditIntelligenceDashboard/1.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      logger.warn({ ticker, status: res.status }, "Yahoo Finance returned non-200");
      return null;
    }

    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
        error?: { code?: string; description?: string };
      };
    };

    if (data.chart?.error) {
      logger.warn({ ticker, error: data.chart.error }, "Yahoo Finance chart error");
      return null;
    }

    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c): c is number => c !== null && c !== undefined) ?? [];
    if (closes.length < 2) return null;

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const first = closes[0];

    const move1D = prev > 0 ? ((last - prev) / prev) * 100 : null;
    const move5D = first > 0 ? ((last - first) / first) * 100 : null;

    const result: PriceData = { ticker, move1D, move5D, lastClose: last, fetchedAt: new Date() };
    stockCache.set(ticker, result);
    return result;
  } catch (err) {
    logger.warn({ err, ticker }, "Yahoo Finance fetch failed");
    return null;
  }
}

// ── ETF Snapshot (HYG + LQD) ─────────────────────────────────────────────────
export async function getETFSnapshot(): Promise<MarketSnapshot> {
  if (etfSnapshotCache && Date.now() - etfSnapshotCache.fetchedAt.getTime() < CACHE_TTL_MS) {
    return etfSnapshotCache;
  }

  const [hyg, lqd] = await Promise.allSettled([
    fetchYahooPrice("HYG"),
    fetchYahooPrice("LQD"),
  ]);

  etfSnapshotCache = {
    hyg: hyg.status === "fulfilled" ? hyg.value : null,
    lqd: lqd.status === "fulfilled" ? lqd.value : null,
    fetchedAt: new Date(),
  };

  logger.info({
    hygMove1D: etfSnapshotCache.hyg?.move1D?.toFixed(3),
    lqdMove1D: etfSnapshotCache.lqd?.move1D?.toFixed(3),
  }, "ETF snapshot fetched");

  return etfSnapshotCache;
}

// ── Market Validation ─────────────────────────────────────────────────────────
export interface MarketValidationResult {
  stockMove1D: number | null;
  stockMove5D: number | null;
  hyETFMove: number | null;
  validationSignal: "confirmed" | "mixed" | "unconfirmed";
  confidenceScore: "high" | "medium" | "low";
}

export async function validateWithMarketData(params: {
  issuerName: string | null;
  sentiment: string | null;
  finalUrgencyScore: number | null;
  creditSignalScore: number | null;
  etfSnapshot: MarketSnapshot;
}): Promise<MarketValidationResult> {
  const { issuerName, sentiment, finalUrgencyScore, creditSignalScore, etfSnapshot } = params;

  let stockMove1D: number | null = null;
  let stockMove5D: number | null = null;

  // Fetch stock data if we can identify the issuer
  if (issuerName) {
    const ticker = getTickerForIssuer(issuerName);
    if (ticker) {
      const stockData = await fetchYahooPrice(ticker);
      if (stockData) {
        stockMove1D = stockData.move1D ?? null;
        stockMove5D = stockData.move5D ?? null;
      }
    }
  }

  const hyETFMove = etfSnapshot.hyg?.move1D ?? null;
  const isNegative = sentiment === "negative";
  const isPositive = sentiment === "positive";

  // ── Validation signal logic ─────────────────────────────────────────────────
  let validationSignal: "confirmed" | "mixed" | "unconfirmed";

  if (stockMove1D !== null && hyETFMove !== null) {
    if (isNegative && stockMove1D < -0.5 && hyETFMove < -0.1) {
      validationSignal = "confirmed";   // negative news + stock down + HY ETF down
    } else if (isPositive && stockMove1D > 0.5) {
      validationSignal = "confirmed";   // positive news + stock up
    } else if (isNegative && stockMove1D > 0.5) {
      validationSignal = "mixed";       // negative news but stock up (divergence)
    } else if (isPositive && stockMove1D < -0.5) {
      validationSignal = "mixed";       // positive news but stock down
    } else {
      validationSignal = "unconfirmed"; // move exists but not directionally clear
    }
  } else if (hyETFMove !== null) {
    // No stock data — use ETF only
    if (isNegative && hyETFMove < -0.2) {
      validationSignal = "confirmed";
    } else if (isNegative && hyETFMove > 0.2) {
      validationSignal = "mixed";
    } else {
      validationSignal = "unconfirmed";
    }
  } else {
    validationSignal = "unconfirmed"; // no market data available
  }

  // ── Confidence score logic ──────────────────────────────────────────────────
  const signalStrength = (finalUrgencyScore ?? 0) >= 6 || (creditSignalScore ?? 0) >= 3;
  const weakSignal = (finalUrgencyScore ?? 0) <= 3 && (creditSignalScore ?? 0) <= 1;

  let confidenceScore: "high" | "medium" | "low";
  if (signalStrength && validationSignal === "confirmed") {
    confidenceScore = "high";
  } else if (signalStrength || validationSignal === "confirmed") {
    confidenceScore = "medium";
  } else if (weakSignal) {
    confidenceScore = "low";
  } else {
    confidenceScore = "medium";
  }

  return { stockMove1D, stockMove5D, hyETFMove, validationSignal, confidenceScore };
}
