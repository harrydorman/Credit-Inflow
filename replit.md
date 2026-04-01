# Credit Intelligence Dashboard

## Overview

A full-stack MVP web application for credit analysts, fixed income traders, CLO professionals, and portfolio managers. Aggregates financial news and transforms it into structured, actionable credit insights using AI.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS
- **AI**: OpenAI API (gpt-4o-mini) for article analysis
- **News**: NewsAPI + RSS feeds

## Environment Variables Required

- `OPENAI_API_KEY` — OpenAI API key for article analysis
- `NEWS_API_KEY` — NewsAPI key for fetching financial news

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── credit-dashboard/   # React frontend dashboard
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## API Endpoints

- `GET /api/articles` — List articles (filters: sector, eventType, sentiment, issuerName, covenantFlag, marketImpact, minUrgency, limit, offset)
- `GET /api/articles/:id` — Article detail with full AI analysis
- `GET /api/signals` — Aggregated credit signals by sector and event type (includes covenant/critical alerts)
- `GET /api/signals/daily-brief` — Daily brief with covenantAlerts + criticalAlerts sections
- `GET /api/issuers` — Issuer risk aggregation (sorted by covenant flag, urgency, negative count)
- `POST /api/refresh` — Trigger news ingestion + AI processing

## Key Features

### Phase 1
1. **Data Ingestion** — Pulls from NewsAPI (credit market keywords) + RSS feeds (Bloomberg, Reuters, FT)
2. **AI Processing** — Each article gets: summary, sector tag, event type, sentiment analysis, "Why It Matters", "Who Cares"
3. **CLO Impact Detection** — Articles mentioning leveraged loans or CLO markets are flagged
4. **Signal Aggregation** — Risk scores by sector, event type distribution, high-risk sector highlighting
5. **Daily Credit Brief** — Curated daily summary of top negative events, trends, CLO alerts

### Phase 2 (Trader-Critical Signals)
6. **Issuer Name Extraction** — AI extracts specific company names (e.g. "Ford Motor Credit", "Dish Network")
7. **Urgency Scoring** — 1-5 triage score (5=critical/covenant breach, 4=downgrade, 3=spread widening, 2=moderate, 1=info)
8. **Covenant Flag Detection** — Binary flag for covenant breach mentions — most critical signal for credit traders
9. **Rating Agency Tracking** — Moody's, S&P, Fitch rating mentions with specific rating extracted
10. **Market Impact Classification** — high/medium/low impact per article
11. **Issuer Intelligence Page** — Aggregated risk table per company with risk score, clickable to filter feed

## Frontend Pages

- `/` — Main feed with covenant/urgency/impact filters + daily brief sidebar with covenant alerts
- `/article/:id` — Article detail with full AI analysis + all new fields
- `/signals` — Sector risk matrix + event type breakdown + covenant/critical alert sections
- `/issuers` — Issuer Intelligence table: risk score, covenant flag, urgency, rating per company
- `/brief` — Daily brief with Covenant Alerts (top) + Critical Events + CLO Alerts sections

## Database Schema

- `articles` table — raw + AI-processed data including: issuerName, urgencyScore, covenantFlag, ratingMentioned, ratingAgency, marketImpact

## Running Codegen (after OpenAPI spec changes)

```bash
pnpm --filter @workspace/api-spec run codegen
```

## DB Push (after schema changes)

```bash
pnpm --filter @workspace/db run push
```
