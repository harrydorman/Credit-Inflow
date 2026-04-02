# Credit Intelligence Dashboard

## Overview

A full-stack Bloomberg-terminal-style web application for credit analysts, fixed income traders, CLO professionals, and portfolio managers. Aggregates financial news from 17 RSS feeds, processes with OpenAI via Replit AI proxy, and presents structured credit intelligence as a top-down workflow: Market Overview → Sectors → Issuers → Articles.

## Navigation Hierarchy (Part 5 restructure)

- **`/`** — Market Overview (homepage): macro regime, risk summary, sector top risks, trend highlights
- **`/feed`** — Live Feed: article stream with filters and trend sidebar
- **`/sectors`** — Sector Analysis: clickable grid of all sectors, drills into article feed
- **`/issuers`** — Issuer Intelligence: per-company risk tracking
- **`/signals`** — Trend Signals: full trend detection alerts
- **`/brief`** — Daily Brief: top-10 credit events summary
- **`/article/:id`** — Article Detail: structured credit summary + scores with explanations

## Intelligence Layer (v2 — Credit-Inflow-improved)

A new core module `artifacts/api-server/src/lib/intelligence.ts` provides evidence-weighted trust scoring and signal enrichment for every article:

- **Source Registry** — classifies sources into primary (SEC, ratings agencies, Fed), secondary (Reuters, Bloomberg, WSJ), tertiary (investing.com) tiers
- **`buildTrustProfile(article, universe)`** — computes 0-100 trust score + label (high/medium/low) from source tier, content depth, evidence count, corroboration, market validation, and signal age
- **`buildEvidenceItems(article, universe)`** — structured evidence ledger (source, timing, rating, covenant, metric, corroboration, market items)
- **`findCorroboratingArticles(article, universe)`** — matches related articles by issuer and event type within a 7-day window
- **`buildSignalCard(article, universe)`** — creates actionable signal card: signalType, whyNow, keyEvidence, creditImplications, riskFlags, confidence, decisionUse
- **`buildIssuerSnapshot(issuerName, articles)`** — per-issuer risk summary: trend (deteriorating/stable/improving), riskLevel, keyDrivers, keyRisks, nextQuestions
- **`buildCreditPulse(articles)`** — market-wide CreditPulse: riskTone (Risk Off/Cautious/Balanced), highTrustSignals, corroboratedSignals, primarySourceSignals
- **`enrichArticle(article, universe)`** — attaches all of the above to an article object; used by articles, signals, issuers, and issuerThesis routes
- **`rankSignalStrength(article, universe)`** — composite rank combining urgency, creditSignalScore, trust, sentiment bias, and corroboration count

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec v0.3.0)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS (dark/amber theme)
- **AI**: OpenAI gpt-4o-mini via Replit AI proxy (AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY)
- **News**: RSS feeds (WSJ, NYT, MarketWatch, Investing.com, CNBC)

## CRITICAL: AI Integration Notes

- **MUST use Replit AI proxy**: `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`
- **Do NOT use** `OPENAI_API_KEY` (user's key is quota-exhausted)
- **NewsAPI** (`NEWS_API_KEY`) is invalid — RSS feeds are the primary source
- **Port 8080**: If EADDRINUSE, run `fuser -k 8080/tcp` before restarting API server

## Environment Variables

- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI proxy key for OpenAI
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI proxy base URL
- `NEWS_API_KEY` — NewsAPI (currently invalid — RSS is primary)
- `SESSION_SECRET` — Express session secret

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── aiProcessing.ts    # AI analysis + noise filter + scoring
│   │       │   ├── dataProviders.ts   # DataSourceProvider interface + RSS/NewsAPI providers
│   │       │   └── newsIngestion.ts   # Legacy (kept for compat)
│   │       ├── routes/
│   │       │   ├── articles.ts
│   │       │   ├── signals.ts
│   │       │   ├── issuers.ts         # Includes riskTrend, creditSignalTotal
│   │       │   ├── issuerThesis.ts    # GET /api/issuer-thesis/:issuer
│   │       │   ├── ingestion.ts       # POST /api/refresh (uses dataProviders)
│   │       │   └── trends.ts          # GET /api/trends
│   │       └── services/
│   │           └── trendDetection.ts  # 4 trend alert types
│   └── credit-dashboard/              # React frontend
│       └── src/pages/
│           ├── dashboard.tsx          # Top Credit Risks + Trend Alerts + Daily Brief
│           ├── article.tsx            # Trade Implications + CLO Analysis + Urgency Meter
│           ├── issuers.tsx            # riskTrend column + 1-10 urgency scale
│           ├── signals.tsx
│           └── brief.tsx
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml              # v0.3.0 — all new schemas + endpoints
│   ├── api-client-react/             # Generated React Query hooks (includes useGetTrends, useGetIssuerThesis)
│   ├── api-zod/                      # Generated Zod schemas
│   └── db/
│       └── src/schema/articles.ts    # 30+ columns including Phase 3 fields
├── pnpm-workspace.yaml
└── package.json
```

## API Endpoints (v0.3.0)

- `GET /api/articles` — List articles (filters: sector, eventType, sentiment, issuerName, covenantFlag, marketImpact, minUrgency, limit, offset)
- `GET /api/articles/:id` — Article detail with full AI analysis + all Phase 3 fields
- `GET /api/signals` — Aggregated credit signals by sector and event type
- `GET /api/signals/daily-brief` — Daily brief with covenantAlerts + criticalAlerts
- `GET /api/issuers` — Issuer risk aggregation with riskTrend + creditSignalTotal
- `GET /api/issuer-thesis/:issuer` — AI-generated credit thesis for a specific issuer
- `GET /api/trends` — Trend cluster detection (72h window, 4 alert types)
- `POST /api/refresh` — Trigger news ingestion + AI processing (with noise filter)

## Key Features

### Phase 1 — Core Intelligence
1. **Data Ingestion** — RSS feeds (WSJ, NYT, MarketWatch, Investing.com, CNBC) + NewsAPI
2. **AI Processing** — summary, sector, event type, sentiment, "Why It Matters", "Who Cares"
3. **CLO Impact Detection** — flags articles for CLO relevance
4. **Signal Aggregation** — risk scores by sector, event type distribution
5. **Daily Credit Brief** — curated daily summary with covenant + CLO alerts

### Phase 2 — Trader-Critical Signals
6. **Issuer Name Extraction** — AI extracts specific company names
7. **Urgency Scoring (1-5)** — triage score kept for backward compat
8. **Covenant Flag Detection** — binary flag + covenant type extraction
9. **Rating Agency Tracking** — Moody's, S&P, Fitch rating mentions
10. **Market Impact Classification** — high/medium/low
11. **Issuer Intelligence Page** — aggregated risk table per company

### Phase 3 — Advanced Credit Analytics
12. **Noise Reduction Filter** — keyword scoring threshold prevents low-signal articles from consuming AI tokens
13. **Hybrid Urgency Scoring (1-10)** — `finalUrgencyScore` = AI base score + rule adjustments (covenant, CCC, bankruptcy, etc.), capped at 10
14. **Credit Signal Score** — per-article ranking score based on credit event severity
15. **Trade Implications** — AI generates: tradeDirection, tradeRationale, potentialTrades[], marketsImpacted[]
16. **Credit Metric Flags** — leverageMentioned, liquidityConcern, refinancingRisk, earningsMiss
17. **Enhanced Rating Analysis** — ratingIsDowngrade, ratingIsUpgrade, ratingIsCCCThreshold
18. **Covenant Detail** — covenantType (e.g. "financial maintenance covenant", "PIK toggle")
19. **CLO Deep Analysis** — cloRelevance (high/medium/low), cloWarfImpact (WARF change direction), cloCCCBucketRisk, cloLoanVsBond, cloImpactTypes[], cloExplanation
20. **Market Technical Signals** — spreadWideningRisk, forcedSellingRisk, distressedRisk
21. **DataSourceProvider Abstraction** — modular provider pattern for easy addition of Bloomberg, Creditflux, etc.
22. **Trend Detection** — sector clusters, issuer deterioration, refinancing waves, downgrade waves
23. **Risk Trajectory** — riskTrend (improving/stable/deteriorating) per issuer
24. **Issuer Credit Thesis** — AI-generated 6-12 month credit thesis per issuer

### Dashboard UI
- **Top Credit Risks Today** — top 5 articles by finalUrgencyScore with visual bar + trade direction badges
- **Trend Alerts Panel** — live 72h trend cluster detection in sidebar
- **Article Detail** — Urgency Meter (10-segment visual), Trade Implications card, Credit Signal Flags, CLO Deep Analysis

## Database Schema (articles table)

Phase 1: id, title, source, publishedAt, url, rawContent, summary, sector, eventType, sentiment, whyItMatters, whoCares, cloImpact, issuerName, urgencyScore, covenantFlag, ratingMentioned, ratingAgency, marketImpact

Phase 3 additions: finalUrgencyScore, creditSignalScore, tradeDirection, tradeRationale, potentialTrades (json[]), marketsImpacted (json[]), leverageMentioned, liquidityConcern, refinancingRisk, earningsMiss, ratingIsDowngrade, ratingIsUpgrade, ratingIsCCCThreshold, covenantType, cloRelevance, cloLoanVsBond, cloWarfImpact, cloCCCBucketRisk, cloExplanation, cloImpactTypes (json[]), spreadWideningRisk, forcedSellingRisk, distressedRisk

## Running Codegen (after OpenAPI spec changes)

```bash
pnpm --filter @workspace/api-spec run codegen
```

## DB Push (after schema changes)

```bash
pnpm --filter @workspace/db run push
```

## Urgency Score Scale

Phase 1 `urgencyScore` (1-5): kept for backward compat  
Phase 3 `finalUrgencyScore` (1-10): primary metric  
- 8-10: CRITICAL (covenant breach, bankruptcy, restructuring, CCC threshold)
- 6-7: HIGH (downgrade, default risk, forced selling)
- 4-5: ELEVATED (spread widening, liquidity concern)
- 2-3: MODERATE (earnings miss, leverage concern)
- 1: INFORMATIONAL
