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

- `GET /api/articles` — List all processed articles (supports filters: sector, eventType, sentiment, limit, offset)
- `GET /api/articles/:id` — Get article detail with full AI analysis
- `GET /api/signals` — Aggregated credit signals by sector and event type
- `GET /api/signals/daily-brief` — Daily credit brief: top negative events, impacted sectors, trends, CLO alerts
- `POST /api/refresh` — Trigger news ingestion + AI processing

## Key Features

1. **Data Ingestion** — Pulls from NewsAPI (credit market keywords) + RSS feeds (Bloomberg, Reuters, FT)
2. **AI Processing** — Each article gets: summary, sector tag, event type, sentiment analysis, "Why It Matters", "Who Cares"
3. **CLO Impact Detection** — Articles mentioning leveraged loans or CLO markets are flagged
4. **Signal Aggregation** — Risk scores by sector, event type distribution, high-risk sector highlighting
5. **Daily Credit Brief** — Curated daily summary of top negative events, trends, CLO alerts

## Frontend Pages

- `/` — Main feed with article list + daily brief sidebar
- `/article/:id` — Article detail with full AI analysis
- `/signals` — Sector risk matrix + event type breakdown
- `/brief` — Dedicated daily credit brief page

## Database Schema

- `articles` table — stores raw + AI-processed article data

## Running Codegen (after OpenAPI spec changes)

```bash
pnpm --filter @workspace/api-spec run codegen
```

## DB Push (after schema changes)

```bash
pnpm --filter @workspace/db run push
```
