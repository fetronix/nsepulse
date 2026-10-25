# NSE Pulse — Kenyan Stock Market Intelligence

A Kenya-first market research application scaffold with a React/Vite dashboard, Express REST API, PostgreSQL/Drizzle schema, conservative provider boundary, tested analytical utilities, and an opt-in Telegram bot. The project is deliberately honest about unavailable data: **no market prices, company list, news, financials, or dividends are seeded or simulated.**

> **Status:** Early working increment, not a production-complete investment platform. The dashboard/API, database schema, CSV security-master importer, core indicators/calculations, health reporting, and a small Telegram command set work. Licensed market feed access, authentication, user-owned products, feed ingestion, full command set, news/fundamentals, delivery queues, and multi-user security controls are not yet implemented. See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## Architecture

- **Web:** React 18 + TypeScript + Vite. Navy/green responsive dashboard with API-backed overview, security search, quote lookup, and source/health disclosures.
- **API:** Express REST API under `/api/v1`; helmet, strict configured CORS origin, JSON size limit, Zod query validation, rate limit, safe error responses.
- **Storage:** PostgreSQL, Drizzle ORM, 31-table schema and versioned SQL migration in `drizzle/generated/`.
- **Provider boundary:** replaceable quote/history provider interface. Default is an explicitly unconfigured adapter that returns no data and does not scrape pages.
- **Research:** SMA, EMA, RSI, MACD, ATR, annualized historical volatility; dividend scenario, market capitalization, weighted scorecard, alert condition, and hypothetical-position calculation utilities.
- **Telegram:** grammY bot with `/start`, `/help`, `/market`, `/quote`, `/status`. Polling activates only when a token is configured. Unsupported data is reported as unavailable.
- **Jobs:** scheduler is disabled by default. Optional provider-health heartbeat uses a PostgreSQL advisory lock; it does not poll market data.

## Quick start

Requirements: Node.js 20.19+ (Node 20 LTS recommended), npm, PostgreSQL 14+ for persistent use.

```bash
cp .env.example .env
# Edit DATABASE_URL and other settings. Do not commit .env.
npm install
npm run db:migrate
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The API listens on `http://localhost:4000`; Vite proxies `/api` to it. With no PostgreSQL connection, health endpoints and empty-state UI still run, but no securities or observations are available.

For production artifacts:

```bash
npm ci
npm run build       # type checks + web production build
npm run build:api   # server TypeScript compilation to dist/server
npm run db:migrate  # run versioned migrations against DATABASE_URL
```

Serve the `dist/` Vite output using a static host or reverse proxy and run the Node API with `npm start`. Route `/api/*` to the API process. Bind behind HTTPS. For bot polling, run one dedicated process with `TELEGRAM_BOT_TOKEN` set and the API process's token unset, e.g. `npm run start:bot`; do not run multiple polling replicas with the same token. The optional scheduler requires `DATABASE_URL` and `ENABLE_SCHEDULER=true`; its only current task is a provider-health heartbeat.

## Environment variables

See [`.env.example`](.env.example). Important variables:

- `DATABASE_URL`: PostgreSQL connection string.
- `DATABASE_SSL=true`: use verified TLS to PostgreSQL (the default is false for local development; enable for hosted databases).
- `APP_ORIGIN`: exact browser origin allowed by Express CORS.
- `MARKET_DATA_PROVIDER`: remains `none` unless an adapter is implemented for a confirmed provider contract.
- `NSE_VENDOR_API_BASE_URL`, `NSE_VENDOR_API_KEY`: placeholders only; do not fill until NSE/vendor API docs and licensing are reviewed. No default endpoint is invented.
- `TELEGRAM_BOT_TOKEN`: optional, secret, server-side only.
- `ENABLE_SCHEDULER`: opt-in provider-health heartbeat; not an ingestion switch.

## API summary

OpenAPI JSON: `GET /api/v1/docs`; static YAML: [`docs/openapi.yaml`](docs/openapi.yaml).

- `GET /api/v1/health` — app, database and provider status.
- `GET /api/v1/providers` — provider adapter status.
- `GET /api/v1/market/overview` — no fabricated indices/activity; displays missing-source state.
- `GET /api/v1/securities?q=&limit=25&offset=0` — imported security master only.
- `GET /api/v1/quotes/{symbol}` — latest stored quote/provenance or honest unavailable reason.
- `GET /api/v1/history/{symbol}?from=ISO&to=ISO` — stored observations only.
- `GET /api/v1/technicals/{symbol}` — indicators calculated from stored historical rows when available.

Example when the source master or quote is missing:

```json
{
  "security": null,
  "observation": null,
  "reason": "Security not found in the configured security master."
}
```

## Security master import

Import requires a reviewed official NSE/CDSC CSV source URL and verification time. This command rejects duplicate symbols in the input and upserts existing symbols by `(exchange,symbol)`. Every imported record is still marked `review_required=true` for human review.

CSV columns: `symbol,name,instrumentType,listingStatus` (optional: `sector`). Do not import a scraped/third-party list without checking license, provenance, and currency.

```bash
SECURITY_MASTER_SOURCE_URL='https://www.nse.co.ke/...' \
SECURITY_MASTER_VERIFIED_AT='2026-10-25T09:00:00+03:00' \
DATABASE_URL='postgres://...' \
npx tsx src/server/db/import-securities.ts ./reviewed-nse-list.csv
```

This importer is not evidence that the chosen source is complete or permitted for redistribution. Maintain evidence of the official source and manual review separately.

## Tests and build

```bash
npm test
npm run typecheck
npm run build
npm run build:api
npm audit
```

Current automated checks use local deterministic fixtures and no real provider/database credentials. They are **mock/fixture tests**, not real-provider integration tests. PostgreSQL migration execution and restore tests require a reachable PostgreSQL service and were not verified in the current workspace.

## Data policy

NSE states that delayed data is delayed by at least 15 minutes and refreshed every minute; NSE also states that redistribution through software/web products requires the relevant license. Live, historical, corporate-action and reference-data products are offered subject to their access process. The implementation therefore does not infer live status from refresh frequency, scrape displayed values, or redistribute public-page data.

- [NSE Market Data Overview](https://www.nse.co.ke/dataservices/market-data-overview/)
- [NSE Delayed Data](https://www.nse.co.ke/dataservices/delayed-data/)
- [NSE Licensed Information Vendors](https://www.nse.co.ke/dataservices/nse-licensed-information-vendors/)
- [NSE Market Data Policy](https://www.nse.co.ke/market-data-policy/)

See [provider configuration guide](docs/PROVIDER_SETUP.md) for the access checklist.

## Operations

- **Logs:** JSON-shaped startup/provider-heartbeat logs; error bodies avoid internal details. Use a process manager (`systemd`, `pm2`, container orchestrator) and central log retention in deployment.
- **Health:** `GET /api/v1/health`. A missing DB/provider is reported explicitly; app health is not proof of market-feed health.
- **Backups:** daily encrypted `pg_dump` plus tested restore; see [operations guide](docs/OPERATIONS.md).
- **Migrations:** additive/versioned Drizzle SQL. Review generated SQL before rollout and take a backup before production migration.
- **Secrets:** server environment/secret manager only; never put API keys in browser variables (e.g. `VITE_*`) or commit them.

## Financial/research disclaimer

This software is an educational research tool, not a broker and not personalized investment, legal, or tax advice. Historical indicators and scenarios do not guarantee future outcomes. Check issuer announcements, source timestamps, licensing, eligibility, taxes, and fees independently.
