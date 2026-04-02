# Credit Intelligence Dashboard — Implementation Notes

## Sprint: Hardening Pass (April 2026)

---

### Batch 0 — Foundation (Previous Session)
**Changes:**
- Built Bloomberg-terminal dark UI with amber accents
- 7 navigation pages: Market Overview, Live Feed, Sectors, Issuers, `/issuer/:name`, Signals, Daily Brief
- 17 RSS feeds ingested via `dataProviders.ts`
- AI processing via OpenAI (Replit AI proxy) in `aiProcessing.ts`
- Full schema: articles with urgency scoring, credit signals, CLO fields, trust profiles
- Content enricher: `contentEnricher.ts` — fetches full article HTML for open sources
- Source registry: 12 source profiles with tier (primary / secondary / tertiary)
- Issuer detail page: `/issuer/:name` with Analyst Snapshot, Credit Signals, Trade Implications, Article Timeline
- Daily Brief upgraded to PM note format with Issuer Hotspots section

---

### Batch 1 — Data Quality & Null Hardening (April 2, 2026 AM)
**Problem:** AI sometimes returned the literal string "null" instead of a null value. This caused `issuerName = "null"` to appear in the issuers list and `ratingAgency = "null"` to display as "null: B" in the UI.

**Fixes:**
- `ingestion.ts`: Added `sanitizeNullStr()` helper — strips "null", "undefined", "N/A", empty strings → proper null
- Applied to all 15 string fields in both INSERT and Phase 2 backfill UPDATE
- DB: Bulk-cleaned 52 existing rows with null-string field values (`UPDATE ... WHERE ... IN ('null','undefined','N/A','')`)
- `issuers.ts`: Added defensive `!== "null"` guard in issuerMap loop
- `brief.tsx` + `issuer-detail.tsx`: Added `&& field !== "null"` guard in rating agency badge render

**Added:**
- `GET /api/debug/ingestion-stats` — first observability endpoint (totals, coverage %, enrichment stats)

**Verified:**
- Issuers list: 12 clean names, 0 "null" issuer
- Brief: "null: B" → "B" (no agency prefix when ratingAgency is null)
- All 12 issuer detail pages return HTTP 200 with valid data

---

### Batch 2 — Hardening Sprint (April 2, 2026 PM)

#### 2a — Scheduled Auto-Ingestion + Overlap Lock
**File changed:** `artifacts/api-server/src/index.ts`

Pre-existing: 45-minute interval scheduler calling `/api/refresh` then `/api/refresh/backfill`.

**Added:**
- `isIngestionRunning: boolean` flag — prevents overlapping cycles (scheduler skips if previous run still in progress)
- Per-phase duration timing (`durationMs`) logged for refresh and backfill phases
- Total cycle duration logged on completion
- Clear log messages: `"cycle: starting"`, `"refresh complete"`, `"backfill complete"`, `"cycle: finished"`

Preserved: manual `/api/refresh` endpoint unchanged.

#### 2b — Failure Classification
**File changed:** `lib/db/src/schema/articles.ts`
**New column:** `process_failure_reason TEXT` (nullable)

Values:
| Reason | Meaning |
|---|---|
| `null` | Processed OK — article has full AI output |
| `"empty_content"` | raw_content was empty/null after enrichment |
| `"noise_filtered"` | passesNoiseFilter() returned false |
| `"ai_null"` | AI returned null (OpenAI failure or low-quality input) |
| `"ai_error"` | Unhandled exception during AI call (future use) |
| `"duplicate"` | Duplicate URL (future use) |

**DB push applied:** `pnpm --filter @workspace/db run push`

**Backfill of existing 33 unprocessed articles:**
- 14 empty_content (raw_content NULL or 0 bytes — came from feeds with no description)
- 19 noise_filtered (content present but failed keyword/quality threshold)

**ingestion.ts changes:**
- Added `empty_content` check **before** noise filter — saves stub immediately with `process_failure_reason: "empty_content"`
- Noise-filtered articles now saved with `process_failure_reason: "noise_filtered"`
- Successfully processed articles saved with `processFailureReason: null`
- AI null return saves `processFailureReason: "ai_null"`
- Phase 2 backfill clears `processFailureReason` to null on successful re-process

#### 2c — Canonical Issuer Normalization
**New file:** `artifacts/api-server/src/lib/canonicalIssuers.ts`

Contains `CANONICAL_MAP: Record<string, string>` with 60+ variant → canonical name entries covering:
- Nike / Nike Inc. / Nike, Inc. → "Nike"
- JPMorgan / JP Morgan / JPMorgan Chase & Co → "JPMorgan"
- Amazon.com / Amazon.com Inc. → "Amazon"
- KKR & Co / KKR & Co. Inc → "KKR"
- Blue Owl / Blue Owl Capital → "Blue Owl"
- (and 55+ more)

`canonicalizeIssuer(name)` performs case-insensitive lookup. Falls back to trimmed input if no mapping found.

**ingestion.ts:** New `sanitizeIssuer()` helper = `canonicalizeIssuer(sanitizeNullStr(val))`. Applied to `issuerName` in both INSERT and Phase 2 UPDATE.

#### 2d — Observability Expansion
**File changed:** `artifacts/api-server/src/routes/debug.ts`

`GET /api/debug/ingestion-stats` now returns:
```json
{
  "totals": { "totalArticles", "aiProcessed", "aiNotProcessed" },
  "failureReasonBreakdown": {
    "processed_ok", "noise_filtered", "empty_content", "ai_null", "ai_error", "other"
  },
  "structuredOutputCoverage": {
    "withCreditSummary", "withCreditSummaryPct",
    "withScoreExplanation", "withScoreExplanationPct",
    "withPotentialTrades", "withPotentialTradesPct",
    "withTradeImplication", "withTradeImplicationPct"
  },
  "issuerExtractionCoverage": {
    "withIssuerName", "withIssuerNamePct", "badIssuerNameStrings"
  },
  "contentEnrichment": {
    "enrichmentSuccessRate", "expandedArticles", "rssSnippetArticles",
    "preEnricherRows", "avgDepthScoreAll", "avgDepthScoreProcessed",
    "avgRawContentLenChars", "maxRawContentLenChars"
  },
  "avgDepthBySource": [ { "source", "avgDepth", "articles" } ... ]
}
```

#### 2e — Article Detail Navigation (verified, not built — already existed)
- `artifacts/credit-dashboard/src/pages/article.tsx` — full detail page (urgency meter, trust profile, signal card, credit summary, score explanation, trade implications, CLO section, evidence ledger)
- `artifacts/credit-dashboard/src/App.tsx` — route `/article/:id` registered
- `dashboard.tsx`, `signals.tsx`, `issuer-detail.tsx` — all already link to `/article/:id`
- Navigation loop is complete: signal → article → issuer → articles

---

## Validated State (End of Sprint)
| Check | Result |
|---|---|
| Debug endpoint | ✅ Returns 7 sections, all correct |
| Failure reason breakdown | ✅ 52 processed_ok / 19 noise_filtered / 15 empty_content / 0 ai_null |
| Scheduled ingestion overlap lock | ✅ `isIngestionRunning` flag prevents concurrent runs |
| Issuers list | ✅ 12 clean names, 0 "null" |
| Structured output coverage | ✅ 100% creditSummary, 100% scoreExplanation, 90% potentialTrades |
| Content enrichment | ✅ Yahoo Finance avg depth 70, 3 expanded articles |
| Bad issuer name strings | ✅ 0 |
| Article detail page | ✅ Full navigation loop working |

---

## Known Limitations
1. **issuerName coverage 25%** — Macro articles (Fed, ETF, geopolitical) correctly have no named issuer; no fabrication
2. **19 noise_filtered articles** — These are legitimately filtered (personal finance, sports, unrelated news); they're not recoverable without lowering the quality bar
3. **14 empty_content articles** — These came from RSS feeds that returned no description; the enricher is correctly gating them
4. **Pre-enricher rows (72)** — Articles from before the content enricher was deployed have no contentDepthScore or contentSourceType; this heals itself organically as new articles come in
5. **Content expansion rate** — Only 3 articles have been fully expanded (`expanded_article`); most fall back to `rss_snippet`. Paywalled sources (WSJ, FT, Bloomberg) will never expand.

---

## Codebase Map
```
lib/db/src/schema/articles.ts          — DB schema (108 lines, 50+ columns)
artifacts/api-server/src/
  index.ts                             — Server entry + scheduled ingestion loop (lock, timing)
  lib/
    aiProcessing.ts                    — OpenAI call via Replit proxy; returns ArticleAnalysis
    contentEnricher.ts                 — HTML fetch + depth scoring
    canonicalIssuers.ts                — Issuer name normalization map (NEW)
    intelligence.ts                    — enrichArticle, buildIssuerSnapshot, buildDailyBrief
    dataProviders.ts                   — 17 RSS feed parsers
    marketData.ts                      — ETF snapshot + market validation
    logger.ts                          — Pino logger
  routes/
    ingestion.ts                       — POST /api/refresh, POST /api/refresh/backfill
    articles.ts                        — GET /api/articles, GET /api/articles/:id
    issuers.ts                         — GET /api/issuers, GET /api/issuers/:name
    signals.ts                         — GET /api/signals, GET /api/signals/daily-brief
    debug.ts                           — GET /api/debug/ingestion-stats (NEW, expanded)
    marketOverview.ts                  — GET /api/market-overview
    trends.ts                          — GET /api/trends
artifacts/credit-dashboard/src/
  App.tsx                              — Wouter router (7 routes incl. /article/:id)
  pages/
    market-overview.tsx                — Market Overview page
    dashboard.tsx                      — Live Feed (article cards → /article/:id)
    sectors.tsx                        — Sector risk table
    signals.tsx                        — Signal stream → /article/:id
    issuers.tsx                        — Issuer table → /issuer/:name
    issuer-detail.tsx                  — Per-issuer deep dive
    brief.tsx                          — Daily Credit Brief (PM note format)
    article.tsx                        — Article detail page (full signal card, trust profile)
```
