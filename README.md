# NSE Pulse — Kenyan Market Research Workspace

NSE Pulse is a Kenya-first market research application: a React/Vite dashboard, an Express
REST API, a PostgreSQL schema managed with Drizzle, a conservative market-data provider
boundary, tested analytical utilities, and an opt-in Telegram bot.

The project is deliberately honest about missing data. **No prices, security lists,
announcements, financials or dividends are seeded, simulated or scraped.** With the default
configuration the application runs, reports what it cannot answer, and says so explicitly
rather than filling gaps with invented numbers.

> **Read this first:** this is an early working increment, not a production-ready investment
> platform. Licensed market data, authentication, user-owned products and feed ingestion are
> not implemented. Current status and verified checks: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).
> Readiness matrix with per-requirement evidence: [`docs/ENGINEERING_READINESS.md`](docs/ENGINEERING_READINESS.md).
> Changes, and what is deliberately not done: [`CHANGELOG.md`](CHANGELOG.md).

---

## 1. Project overview

NSE Pulse exists to make the boundary between _available_ and _unavailable_ market data
explicit. Every response that could be mistaken for a live quote carries a data mode, a
source, a permission basis and a freshness label. The application never infers "live" from
refresh frequency.

What it is for:

- exploring the Nairobi Securities Exchange universe once an official security master is imported;
- computing indicators and research scenarios over stored observations;
- showing operators exactly which provider, credential and licence is missing;
- demonstrating a defensible provider-integration boundary before any data contract exists.

What it is not: a broker, a price feed, a redistribution channel for NSE data, or advice.

## 2. Current status

| Area                                                                | Status                                                                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard, API, provider commissioning view                         | Working, tested against fixtures                                                                                                                                       |
| Database schema and versioned migrations                            | Working; migration execution verified only where PostgreSQL is reachable                                                                                               |
| Indicators, calculations, data-quality rules                        | Working, unit tested                                                                                                                                                   |
| Structured logging, correlation ids, health probes                  | Working, tested                                                                                                                                                        |
| Container build and Compose environment                             | Authored; image build requires Docker (unavailable in the authoring environment)                                                                                       |
| Real provider ingestion                                             | Mansa adapter implemented (`MARKET_DATA_PROVIDER=mansa`), **not live-verified** — no authenticated response was obtainable while building it; `none` stays the default |
| Authentication, user-owned watchlists/portfolios/alerts             | **Not implemented** — deliberately no user-scoped write endpoints                                                                                                      |
| Full Telegram command set, notification delivery, news/fundamentals | **Not implemented**                                                                                                                                                    |

Details, including what must not be claimed in an assessment of this repository, are in
[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## 3. Features

- **Provider commissioning page** (`/providers` in the UI, `GET /api/v1/providers/configuration`):
  provider name, integration status, credential _presence_, declared coverage, access level,
  last successful retrieval, connection and data-validation test results, and outstanding
  licensing requirements. No credential value is ever returned.
- **Explicit demo mode**: three synthetic fixtures with deliberately unrealistic prices,
  available only with a double opt-in and never in production; every value is labelled
  `demo` / `SYNTHETIC VALUES, NOT AN NSE QUOTE`.
- **Independent sources**: stored historical sessions and official announcements are served
  separately from the live quote adapter, each behind its own permission flag and freshness label.
- **Research utilities**: SMA, EMA, RSI, MACD, ATR, annualised historical volatility;
  dividend scenario, market-cap, weighted scorecard, alert-condition and hypothetical-position maths.
- **Data provenance**: event timestamp versus ingestion timestamp, verified announcement versus
  derived interpretation, declared versus estimated dividend, missing versus genuine zero.
- **Observability**: Pino structured logs with correlation ids, `/health/live` and
  `/health/ready` probes, provider/job outcome logging, graceful shutdown.
- **Telegram bot** (opt-in): `/start`, `/help`, `/market`, `/quote`, `/gainers`, `/losers`, `/status`; unavailable data
  is reported as unavailable.

## 4. Architecture

```
Browser (React 18 + Vite, TypeScript)
   │  fetch /api/*
   ▼
Express API  /api/v1        helmet · CORS allowlist · JSON limit · Zod validation · rate limits
   ├── services/            market data selection, data sources, health
   ├── providers/           MarketDataProvider interface + none/demo/placeholder adapters
   ├── db/                  Drizzle schema, repositories, versioned SQL migrations
   └── jobs/                opt-in scheduler, provider-health heartbeat (advisory lock)
   ▼
PostgreSQL (Drizzle ORM)
   ▲
Telegram bot (grammY) — separate process, read-only queries
```

Layers talk through interfaces: route handlers call services, services call repositories or
provider adapters. Provider adapters cannot be enabled by a credential alone — a provider must
be selected in configuration _and_ implemented.

## 5. Technology stack

| Concern  | Choice                                                               |
| -------- | -------------------------------------------------------------------- |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `noImplicitReturns`) |
| UI       | React 18, Vite 8                                                     |
| API      | Express 5, Zod, helmet, express-rate-limit, pino + pino-http         |
| Data     | PostgreSQL, Drizzle ORM + drizzle-kit                                |
| Bot      | grammY                                                               |
| Tests    | Vitest, Testing Library + happy-dom, supertest                       |
| Tooling  | ESLint (flat config, typescript-eslint), Prettier, tsx               |

## 6. Prerequisites

- **Node.js 22** (`>=22.12 <23`; `.nvmrc` pins `22`) and npm `>=10`.
- **PostgreSQL 14+** for anything that persists data. Docker Engine with Compose is optional but
  is the quickest way to get a disposable database.
- No market-data credentials are required, and none are accepted in CI.

Operations that need PostgreSQL: `npm run db:migrate`, `npm run db:check`, the CSV security-master
import, `npm run test:integration`, and any API call that reads stored securities, quotes,
history or announcements. Everything else — type checking, linting, unit tests, the client build,
`/health/live` — runs without a database.

### Supported environment

| Requirement | Value                 | Notes                                                                                    |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------- |
| Node.js     | `>=22.12.0 <23`       | Enforced at install time (`.npmrc` → `engine-strict=true`), pinned in `.nvmrc` and in CI |
| npm         | `>=10`                | `npm ci` is the supported install                                                        |
| OS          | Linux, macOS, Windows | Line endings are normalised to LF by `.gitattributes`                                    |
| PostgreSQL  | 16                    | Optional locally; the API starts read-only without it                                    |

`npm ci` on an unsupported Node release fails immediately with `EBADENGINE` instead of letting
the toolchain fail later. Switch with `nvm use` (reads `.nvmrc`).

> **Windows note.** The repository uses LF line endings because Prettier is configured with
> `endOfLine: 'lf'`. `.gitattributes` enforces that in every checkout, so `npm run format:check`
> behaves identically on Windows. If you cloned before that file existed and every file is
> reported as unformatted, your working tree is still CRLF — renormalise it once:
>
> ```bash
> git add --renormalize .
> git checkout -- .
> npm run format:check
> ```

## 7. Installation

```bash
git clone <repository-url> nsepulse
cd nsepulse
cp .env.example .env      # credentials match the Compose database defaults
npm ci                    # reproducible install from package-lock.json
```

`npm install` works too, but CI and the documented workflow use `npm ci`, which fails if
`package.json` and `package-lock.json` disagree.

## 8. Configuration

Every variable the application reads is documented in [`.env.example`](.env.example). The API
validates the environment at startup with Zod and exits non-zero with field-level errors rather
than running with a half-valid configuration.

| Variable                                                                      | Default                       | Notes                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                                    | `development`                 | `development` \| `test` \| `production`                                                                |
| `PORT`, `HOST`                                                                | `4000`, `0.0.0.0`             | API bind address                                                                                       |
| `APP_ORIGIN`                                                                  | `http://localhost:5173`       | Exact CORS origin; no wildcard                                                                         |
| `DATABASE_URL`, `DATABASE_SSL`                                                | empty, `false`                | Without a connection the API runs read-only/degraded                                                   |
| `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` | unset, `5432`                 | Alternative to `DATABASE_URL`; composed into one URL at startup. `DATABASE_URL` wins when both are set |
| `MARKET_DATA_PROVIDER`                                                        | `none`                        | `none` \| `mansa` \| `demo` (dev) \| `nse-vendor` (placeholder)                                        |
| `ALLOW_DEMO_MARKET_DATA`                                                      | `false`                       | Required opt-in for fixtures; refused when `NODE_ENV=production`                                       |
| `NSE_VENDOR_API_BASE_URL`, `NSE_VENDOR_API_KEY`                               | empty                         | Placeholders. No default endpoint is invented                                                          |
| `MANSA_API_BASE_URL`, `MANSA_API_KEY`                                         | `https://mansaapi.com`, empty | Mansa adapter. HTTPS only; key is server-side and never returned                                       |
| `MANSA_REQUEST_TIMEOUT_MS`                                                    | `10000`                       | Per-request timeout                                                                                    |
| `MANSA_DAILY_REQUEST_BUDGET`                                                  | `100`                         | Local ceiling matching the documented free tier                                                        |
| `MANSA_CACHE_TTL_SECONDS`                                                     | `300`                         | Snapshot cache lifetime; bounds upstream calls                                                         |
| `HISTORICAL_DATA_PERMISSION_CONFIRMED`                                        | `false`                       | Operator attestation; rows are withheld otherwise                                                      |
| `ANNOUNCEMENTS_PERMISSION_CONFIRMED`                                          | `false`                       | Separate attestation for issuer announcements                                                          |
| `TELEGRAM_BOT_TOKEN`                                                          | empty                         | Secret, server-side only; polling disabled when unset                                                  |
| `SESSION_SECRET`                                                              | placeholder                   | Reserved for a future auth implementation; no sessions exist yet                                       |
| `LOG_LEVEL`                                                                   | `info`                        | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent`                                           |
| `ENABLE_SCHEDULER`                                                            | `false`                       | Opt-in provider-health heartbeat, not an ingestion switch                                              |
| `SECURITY_MASTER_SOURCE_URL`, `SECURITY_MASTER_VERIFIED_AT`                   | none                          | Supplied per import command; the importer refuses to run without both                                  |
| `RUN_MIGRATIONS`                                                              | unset                         | Container entrypoint only; applies migrations on start                                                 |
| `MIGRATIONS_FOLDER`                                                           | `./drizzle/generated`         | Directory `npm run db:migrate` reads; override when mounting elsewhere                                 |
| `TEST_DATABASE_URL`                                                           | unset                         | Integration suite only. Full `postgres://` URL to a disposable database; must parse with `new URL()`   |
| `REQUIRE_INTEGRATION_TESTS`                                                   | `false`                       | Integration suite only. `true` = fail instead of skip when no database is configured (CI sets this)    |

The integration-harness variables are read only by the test suite; the application never looks at
them, so leaving them unset changes nothing about how the app runs. They are documented because a
contributor who found `REQUIRE_INTEGRATION_TESTS` in the test setup previously had no documented way
to satisfy it.

Secrets belong in the server environment or a secret manager. Never in a `VITE_*` variable,
which is compiled into the browser bundle.

### Two ways to configure the database

Either one connection string:

```dotenv
DATABASE_URL=postgres://nse_pulse:local_dev_only_change_me@localhost:5432/nse_pulse
```

or the same connection as components, for environments that keep credentials apart:

```dotenv
SQL_HOST=localhost
SQL_PORT=5432
SQL_DB_NAME=nse_pulse
SQL_ADMIN_USER=nse_pulse
SQL_ADMIN_PASSWORD=local_dev_only_change_me
```

`DATABASE_URL` takes precedence if both are present, and a warning is logged. Values are
URI-encoded, so a generated password containing `@`, `:` or `/` still works. Setting only part
of the `SQL_*` group is a startup error naming the missing keys — never a silent degraded start.
The password is not logged: `server_started` reports only the source (`DATABASE_URL` or `SQL_*`),
host, port and database name.

## 9. Running locally

A fresh clone needs a migrated database before the dashboard has anything to show:

```bash
cp .env.example .env        # then set DATABASE_URL
npm run db:migrate          # required once per database
npm run db:check            # expect exit 0
```

```bash
npm run dev          # API (tsx watch) + Vite dev server together
npm run dev:api      # API only on :4000
npm run dev:web      # Vite only on :5173, proxies /api to :4000
```

Open the Vite URL (normally `http://localhost:5173`). The dashboard shows the provider state,
per-source freshness and an empty-state explanation whenever data is unavailable.

## 10. Database and migrations

```bash
docker compose up -d db     # disposable local PostgreSQL bound to 127.0.0.1:5432
npm run db:migrate          # apply versioned SQL migrations from drizzle/generated
npm run db:check            # connectivity AND schema check (see exit codes below)
npm run db:generate         # author a new migration after editing the Drizzle schema
```

`npm run db:check` verifies more than connectivity: a reachable database with no migrations
applied is reported as a failure, because every data route would fail against it.

| Exit | Meaning                                                   | Fix                                           |
| ---- | --------------------------------------------------------- | --------------------------------------------- |
| `0`  | Reachable and initialised                                 | —                                             |
| `1`  | `DATABASE_URL` missing, or reachable but **not migrated** | set `DATABASE_URL`, then `npm run db:migrate` |
| `2`  | Configured but unreachable                                | start PostgreSQL, check host/port/credentials |

A data route answered with **503** (instead of 500) means the same thing: the API is running,
the storage is not usable. The response body carries `detail` and a `hint`, and
`GET /api/v1/health/ready` reports `checks.database.schemaInitialised: false`. Log lines
`database_request_failed` include the driver `kind`, SQLSTATE `code` and the offending object,
so a missing table is never reported as an unexplained "Internal server error".

Migrations are additive, versioned and reviewed before rollout; take a backup first in any
non-disposable environment. Reset the local database with:

```bash
docker compose down -v && docker compose up -d db && npm run db:migrate
```

## 11. API reference

OpenAPI JSON: `GET /api/v1/docs`. Static description: [`docs/openapi.yaml`](docs/openapi.yaml).

| Method | Path                                      | Purpose                                                                                |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/v1/health/live`                     | Liveness: process only, no dependency calls                                            |
| GET    | `/api/v1/health/ready`                    | Readiness: process, database, provider, data freshness (503 when blocking checks fail) |
| GET    | `/api/v1/health`                          | Combined status; reports `demoMode` and `liveQuoteAdapterEnabled`                      |
| GET    | `/api/v1/providers`                       | Adapter inventory and states                                                           |
| GET    | `/api/v1/providers/configuration`         | Commissioning view (credential presence only)                                          |
| POST   | `/api/v1/providers/test`                  | Local connection/validation checks, rate limited to 10/min                             |
| GET    | `/api/v1/data-sources`                    | Per-source permission basis and freshness                                              |
| GET    | `/api/v1/announcements?limit=25`          | Official announcements from an enabled, permitted source                               |
| GET    | `/api/v1/market/overview`                 | Overview with explicit missing-source state                                            |
| GET    | `/api/v1/securities?q=&limit=25&offset=0` | Search the imported security master                                                    |
| GET    | `/api/v1/quotes/{symbol}`                 | Latest stored observation with provenance                                              |
| GET    | `/api/v1/history/{symbol}?from=&to=`      | Stored observations, permission gated                                                  |
| GET    | `/api/v1/technicals/{symbol}`             | Indicators derived from stored observations                                            |

Unavailable data is never an empty success: responses carry a `reason` and, where relevant, a
data mode. Example for an unknown symbol:

```json
{ "security": null, "observation": null, "reason": "Security not found in the configured security master." }
```

## 12. Provider commissioning and demo mode

The default `MARKET_DATA_PROVIDER=none` is an explicit "not commissioned" state, not a bug.
The commissioning page answers the questions an operator actually has: which provider is
selected, whether credentials are present (never their values), what coverage it declares,
what access level it grants, when a retrieval last succeeded, what the local connection test
reported, and which licence obligations are outstanding.

Demo fixtures are for development only:

```bash
MARKET_DATA_PROVIDER=demo
ALLOW_DEMO_MARKET_DATA=true
```

Each value is labelled `demo`, `dataMode: UNKNOWN` and source
`DEMO FIXTURE — SYNTHETIC VALUES, NOT AN NSE QUOTE`; the UI shows a permanent banner. Demo mode
is refused when `NODE_ENV=production` and can never be reached by credential presence alone.
See [`docs/PROVIDER_SETUP.md`](docs/PROVIDER_SETUP.md) for the access checklist.

### Mansa market data

The only implemented live adapter is Mansa (https://mansaapi.com/docs). It is off unless you
select it **and** supply a key:

```bash
MARKET_DATA_PROVIDER=mansa
MANSA_API_BASE_URL=https://mansaapi.com
MANSA_API_KEY=mansa_live_sk_your_key_here   # .env only — never commit it
```

Turning it on, in order:

```bash
# 1. edit .env: MARKET_DATA_PROVIDER=mansa  (keep MANSA_API_KEY server-side)
# 2. restart, then confirm the adapter resolved without a warning:
npm run dev:api
#    {"module":"providers","requestedProvider":"mansa","provider":"mansa",...,"warnings":[...]}

# 3. one authenticated call, printed without the key:
npm run mansa:probe

# 4. or ask the API directly:
curl -s localhost:4000/api/v1/quotes/SCOM
curl -s localhost:4000/api/v1/providers
```

What to expect, stated honestly:

- Until an authenticated response arrives, the adapter reports `DEGRADED`/`ERROR`; it never
  pretends to be `READY`, and `/quotes/{symbol}` answers with a `reason` rather than a price.
- `/market/overview` and the dashboard read **stored** observations. With
  `ENABLE_SCHEDULER=false` nothing refreshes the stored snapshot, so counts stay at 0 and
  indices/breadth stay empty. Set `ENABLE_SCHEDULER=true` (requires the database) to refresh
  every 30 minutes — 48 calls/day of the documented 100 — or query per symbol, which needs no
  scheduler.
- The Telegram bot reads the same normalized service, so `/quote SCOM` works with the scheduler
  off while `/gainers` and scheduled reports need a configured bot token.

Endpoints used, all taken verbatim from Mansa's published documentation:

| Endpoint                                                       | Purpose                                  |
| -------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/v1/markets/exchanges`                                | Discover the Kenya exchange code         |
| `GET /api/v1/markets/exchanges/{code}/stocks`                  | Exchange list; warms the snapshot cache  |
| `GET /api/v1/markets/exchanges/{code}/stocks/{ticker}`         | Single stock quote                       |
| `GET /api/v1/markets/exchanges/{code}/movers`                  | Gainers/losers for `/gainers`, `/losers` |
| `GET /api/v1/markets/exchanges/{code}/stocks/{ticker}/history` | Daily history (Pro plan and above)       |
| `GET /health`                                                  | Public platform probe (no key, no quota) |

Behaviour worth knowing before you enable it:

- **It is never called real-time.** Mansa documents a 30-minute freshness target during market
  hours, so a fresh payload is labelled `DELAYED`; anything older than the target becomes
  `UNKNOWN`, and anything older than 24 hours is marked stale.
- **Quota is enforced locally.** `MANSA_DAILY_REQUEST_BUDGET` (default 100, the documented free
  tier) is checked before every request. Responses are cached for `MANSA_CACHE_TTL_SECONDS`, the
  snapshot is refreshed every 30 minutes by the scheduler, and N Telegram users share one cache.
- **Failures fail closed.** Timeouts, 401/403/429, 5xx and malformed payloads return _no_ quote
  and a classified reason. Nothing is interpolated.
- **The field names inside a stock record are not published.** Mansa's worked examples cover
  ETFs, indices, history and insider trades, but not `/stocks`, and the OpenAPI schema for
  `data` is a free-form object. The adapter therefore tolerates a documented-style alias set and
  records which alias actually matched on every observation. Confirm yours against your own key:

```bash
MANSA_API_KEY=mansa_live_sk_your_key_here npm run mansa:probe
```

The probe prints the real key names and the normalised result, and never prints the key.

- **A Mansa key is not an NSE redistribution licence.** Confirm Mansa's terms before publishing
  prices to third parties.

When no key is present the app runs exactly as before: `UNCONFIGURED`, no outbound request, and
`/quote` says no verified quote is available.

Security master import (reviewed official CSV, not a scrape):

```bash
SECURITY_MASTER_SOURCE_URL='https://<official-source>/reviewed-list.csv' \
SECURITY_MASTER_VERIFIED_AT='2026-10-25T09:00:00+03:00' \
npm run db:import-securities -- ./reviewed-nse-list.csv
```

The connection comes from `DATABASE_URL` **or** the `SQL_*` variables. A freshly migrated
database has an empty `securities` table, so `/api/v1/securities` and the Stocks explorer stay
empty until this import runs; `/market/overview` reports `counts.securities: 0`.

Columns: `symbol,name,instrumentType,listingStatus` (optional `sector`). Imported rows stay
`review_required=true` until a human verifies them.

## 13. Testing and coverage

```bash
npm test                        # unit + API + client tests (Vitest)
npm run test:coverage           # same suite with coverage thresholds enforced
npm run test:integration        # requires TEST_DATABASE_URL — real PostgreSQL
npm run test:integration:verified  # same, but fails if the suite only skipped
npm run test:integration:local  # one command: starts a disposable container, migrates, runs
```

### Local integration run

`npm run test:integration:local` is the whole workflow, and needs only Docker:

```bash
npm run test:integration:local            # start db-test → migrate → run → remove container
npm run test:integration:local -- --keep  # leave the container running to inspect it
```

It starts **only** the `db-test` service from `docker-compose.yml` (profile `test`, tmpfs
storage, published on `127.0.0.1:5433`), waits for readiness, applies migrations, then runs
`test:integration:verified` with `REQUIRE_INTEGRATION_TESTS=true`. Cleanup uses
`docker compose --profile test rm -sf db-test` — deliberately **not** `down`, which would stop
your `db` and `app` too, and never `-v`, which would delete the `postgres-data` volume holding
your local database. The suite refuses to run unless the target database name contains `test`
and differs from `DATABASE_URL`.

Without Docker, run the same steps against any PostgreSQL 16 instance:

```bash
createdb nse_pulse_some_test
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/nse_pulse_some_test npm run test:integration:verified
```

The live Mansa check is separate and doubly opt-in: it needs **both** `MANSA_API_KEY` **and**
`MANSA_LIVE_TESTS=true`, so a key in `.env` does not turn `npm test` into a paid API call.

```bash
MANSA_LIVE_TESTS=true npx vitest run tests/manual/mansa-live.test.ts
```

`test:integration` exits 0 when every test skips, so it is not proof on its own. Use
`test:integration:verified`, which asserts a minimum number of _passed_ tests from the JSON
report; CI sets `REQUIRE_INTEGRATION_TESTS=true` so a missing database fails the job instead of
skipping it.

- Coverage thresholds (statements/lines/functions 70%, branches 60%) are enforced in
  `vitest.config.ts`; they are a floor, not a target. Current measured coverage is reported by
  CI and recorded in [`docs/ENGINEERING_READINESS.md`](docs/ENGINEERING_READINESS.md).
- Test layers are labelled: pure unit tests (calculations, indicators, quality rules),
  API tests via supertest, client tests via Testing Library + happy-dom, repository tests
  against a disposable PostgreSQL instance, and provider-adapter tests with mocked HTTP.
- **No test contacts a live market-data provider, and no CI job holds production credentials.**
  Any claim about provider behaviour is therefore a claim about the adapter contract, not about
  a real feed.

## 14. Quality gates and CI

```bash
npm run typecheck     # tsc for app and server configs
npm run lint          # ESLint flat config (TS + React, no blanket any)
npm run format:check  # Prettier
npm run check:secrets # repository secret scan
npm run check         # typecheck + lint + format:check + secret scan (fast gate)
npm run verify        # check + coverage + both builds (the full gate)
npm run build:all     # typecheck → vite build → server tsc (correct order, see below)
npm run verify        # everything above, with coverage
```

Build both halves with `npm run build:all`. `npm run build` builds only the client and **empties
`dist/`**, deleting a server build produced earlier — which is why the container once shipped no
server bundle. `tests/cli/build-pipeline.test.ts` and the CI build job assert the ordering and the
artefacts.

CI (`.github/workflows/ci.yml`) runs quality, test, build, integration (disposable PostgreSQL)
and security jobs on every push and pull request, with pinned action versions, least-privilege
permissions and no repository secrets. Dependabot (`.github/dependabot.yml`) raises weekly
dependency and action updates. Results are read from the pull-request checks list; coverage and
test reports are uploaded as job artifacts. A failing test, lint rule, coverage threshold, audit
finding or build fails the run — no job is allowed to fail softly.

## 15. Docker

The container runs the **API only**. The built client (`dist/index.html`, `dist/assets/`) is
served by a static host or reverse proxy, and `APP_ORIGIN` must be set to that origin.

```bash
docker build -t nse-pulse .
docker run --rm -p 127.0.0.1:4000:4000 -e MARKET_DATA_PROVIDER=none nse-pulse

docker compose up -d db        # database only
docker compose up --build      # app + database
docker compose --profile test up -d db-test   # disposable integration database on 127.0.0.1:5433
```

The runtime image is multi-stage, installs production dependencies only, runs as the
unprivileged `node` user, contains no `.env` or secrets, and declares a health check against
`/api/v1/health/live`. Migrations run only when `RUN_MIGRATIONS=true`. PostgreSQL is bound to
loopback, never published publicly. Credentials in `docker-compose.yml` are obvious local
placeholders and must be replaced anywhere else. Full reset: `docker compose down -v`.

> **Verification status:** the image has **not** been built in this environment — no Docker
> daemon, socket or registry access was available. What was verified instead: the compose file
> validates against the official Compose Specification schema, the build-stage file set compiles,
> and the runtime-stage file set (production dependencies only) applies migrations and serves
> `/health/live` and `/health/ready` against real PostgreSQL. Build the image where Docker exists
> before relying on it; see [`docs/ENGINEERING_READINESS.md`](docs/ENGINEERING_READINESS.md) §9
> for the exact commands and the full list of what a simulation cannot prove.

## 16. Deployment and operations

- Run the API behind HTTPS and a reverse proxy; route `/api/*` to the Node process and serve
  `dist/` statically.
- Run exactly one Telegram polling process per token (`npm run start:bot`).
- Point orchestrator probes at `/api/v1/health/live` (liveness) and `/api/v1/health/ready`
  (readiness, 503 when a blocking dependency fails).
- `SIGTERM`/`SIGINT` trigger graceful shutdown with a 10-second deadline; a second signal exits
  immediately. Logs are JSON lines; set `LOG_LEVEL` per environment.
- Daily encrypted `pg_dump` plus a tested restore; review generated SQL before migrating production.

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for log fields, probes, backups and teardown.

## 17. Security

Controls present: helmet headers, configured CORS origin, 32 KB JSON limit, rate limits,
Zod input validation, parameterised SQL, generic error bodies, log redaction, validated
`x-request-id` echo, secret-free provider endpoints, a repository secret scan, and a CI
`npm audit --audit-level=high` gate.

Not implemented: authentication, sessions, roles, user-owned watchlists/portfolios/alerts,
CSRF protection, and admin APIs. **Do not expose user-scoped write endpoints until these exist
with tests.** A list of accepted risks and their closure conditions lives in
[`docs/SECURITY.md`](docs/SECURITY.md) — note that "no findings" is not the same as "zero
vulnerabilities"; the authoritative statement is the most recent successful audit for a specific commit.
Report vulnerabilities privately to the maintainers.

## 18. Data policy and licensing constraints

NSE states that delayed data is delayed by at least 15 minutes and that redistribution through
software or web products requires the relevant licence. The application therefore does not infer
live status from refresh frequency, does not scrape displayed values, and does not redistribute
public-page data.

- [NSE Market Data Overview](https://www.nse.co.ke/dataservices/market-data-overview/)
- [NSE Delayed Data](https://www.nse.co.ke/dataservices/delayed-data/)
- [NSE Licensed Information Vendors](https://www.nse.co.ke/dataservices/nse-licensed-information-vendors/)
- [NSE Market Data Policy](https://www.nse.co.ke/market-data-policy/)

No market dataset ships with this repository. Historical and announcement endpoints stay
withheld until an operator confirms written permission. Commercial redistribution of market
data requires a separate agreement with the data owner — nothing in this repository grants one.
Third-party dependency licences and provenance are inventoried in
[`docs/DATAFACTOR_REVIEW.md`](docs/DATAFACTOR_REVIEW.md); this project does not carry a
repository `LICENSE` file, so no licence is asserted here.

## 19. Known limitations and roadmap

- The Mansa adapter is implemented and unit-tested against mocked responses, but **no
  authenticated Mansa response has been observed from this environment** (outbound access to
  `mansaapi.com` is blocked here), so its live behaviour and the exact `/stocks` field names
  remain unconfirmed. `npm run mansa:probe` is the verification step; until it is run and passes,
  do not describe the app as serving live NSE prices.
- Mansa's free tier does not include per-stock history (Pro plan), and a Mansa key is not an NSE
  redistribution licence.
- No authentication or user-owned data; no alerts delivery pipeline.
- Telegram command set is minimal; no notification queue or retries beyond job retries.
- No news, fundamentals or corporate-action ingestion; dividends are declared-versus-estimated
  calculations only.
- PostgreSQL migration execution and integration tests require a reachable database and are
  unverified in environments without one.
- No penetration test, SAST baseline or load test has been performed.

## 20. Contributing and disclaimer

Contributions are welcome under the constraints in [`CONTRIBUTING.md`](CONTRIBUTING.md): small
reviewable commits, tests with behaviour changes, no committed secrets, no invented data, no
lowered quality gates, and no `MARKET_DATA_PROVIDER` change without a real, licensed adapter.
Run `npm run verify` before opening a pull request.

This software is an educational research tool — not a broker, and not personalised investment,
legal or tax advice. Historical indicators and scenarios do not guarantee future outcomes.
Verify issuer announcements, timestamps, licensing, eligibility, taxes and fees independently.
