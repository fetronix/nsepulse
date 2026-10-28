# Deployment and operations

## Runtime

- Node.js 20.19+ and Linux.
- PostgreSQL 14+; persistent storage required for real usage.
- HTTPS reverse proxy/load balancer. Serve Vite `dist/` as static assets and proxy `/api/*` to Express.
- Keep one API process for low traffic; use a separate one-instance Telegram polling process when enabled. Do not share one bot token among polling instances.
- The optional scheduler uses PostgreSQL advisory lock to avoid concurrent heartbeat work. No market ingestion is scheduled yet.

## Containers

`Dockerfile` is a three-stage build (build → production dependencies → runtime). The runtime image:

- runs as the unprivileged `node` user,
- installs production dependencies only (`npm ci --omit=dev`),
- contains compiled JavaScript and the Drizzle migrations folder — no source, tests, dev dependencies, `.env` file or secrets (the OpenAPI document is served from compiled code, so no YAML copy is needed),
- declares a `HEALTHCHECK` against `GET /api/v1/health/live`,
- applies migrations only when `RUN_MIGRATIONS=true`, so multiple replicas can start without racing. The runner reads `MIGRATIONS_FOLDER` (default `./drizzle/generated`), applies entries in journal order, records each exactly once, and leaves a failed migration unrecorded so a corrected re-run can apply it.

Build and run locally (no production database or credentials required):

```bash
docker build -t nse-pulse .
docker run --rm -p 127.0.0.1:4000:4000 \
  -e MARKET_DATA_PROVIDER=none \
  nse-pulse
curl -s http://127.0.0.1:4000/api/v1/health/ready
```

With PostgreSQL via Compose:

```bash
docker compose up -d db                      # disposable local database on 127.0.0.1:5432
npm ci && npm run db:migrate                 # migrate from the host
npm run dev                                  # API + Vite with hot reload
# or run the whole stack in containers:
docker compose up --build
```

Disposable integration-test database:

```bash
docker compose --profile test up -d db-test
TEST_DATABASE_URL=postgres://nse_pulse_test:test_only@127.0.0.1:5433/nse_pulse_test npm run test:integration:verified
```

Preview mode (`MARKET_DATA_PROVIDER=demo` + `ALLOW_DEMO_MARKET_DATA=true`) is refused when `NODE_ENV=production`, so the container cannot serve synthetic fixtures even if the variables are supplied.

## Build and start

```bash
npm ci
npm run build:all      # typecheck -> vite build -> server tsc; use this, not the pieces
npm run db:migrate
NODE_ENV=production npm start
```

`npm run build` builds only the client and **empties `dist/`**, deleting a server build that
was produced earlier. Always build both halves with `npm run build:all`, which encodes the only
correct order (Vite first, server compilation second). `tests/cli/build-pipeline.test.ts` and
the CI build job enforce this.

Serve files in `dist/` with a static web host. Set `APP_ORIGIN` to the browser origin. The Vite development proxy is not part of the production server.

For a separate bot process, configure its environment with `TELEGRAM_BOT_TOKEN`, but leave the API process token blank to avoid starting a second poller. Use a process supervisor with restart-on-failure and graceful SIGTERM.

## Health and logs

- Liveness: `GET /api/v1/health/live` — process is up; never touches the database or a provider. Use for container restart probes.
- Readiness: `GET /api/v1/health/ready` — returns `200` with `status: ready` when the instance can serve honest responses, `503` with `status: not_ready` when a configured database is unreachable. A database that is not configured is the documented servable mode, so it reports `ready` with `dataFreshness: NO_DATA`.
- Diagnostic: `GET /api/v1/health` — app, database, provider, demo and live-adapter state.
- Logs are newline-delimited JSON (pino) on stdout with `service`, `env`, `module`, `time` and `level` fields. Request logs add `correlationId` (also returned as the `x-request-id` response header), method, path without query string, status code and duration. Set `LOG_LEVEL` to `fatal|error|warn|info|debug|trace|silent` (default `info`); tests run at `silent` unless `LOG_LEVEL` is set.
- Secret-looking fields (`authorization`, `cookie`, `token`, `apiKey`, `password`, `secret`) are redacted by the logger configuration, but call sites must still avoid logging payloads, credentials, user content or full Telegram update objects.
- Errors are logged with `errorClass` and `errorMessage` only; stack traces are not written to the API response.
- Monitor API uptime, DB connectivity/latency, job status, Telegram delivery failures, provider timestamps, and ingestion quality once those systems are connected.
- App `status: ok` is not proof that data exists or is fresh; inspect the independent database/provider fields.
- Provider commissioning: `GET /api/v1/providers/configuration` (dashboard **Provider setup**) reports integration state, credential presence without values, declared coverage, last retrieval, test results and licensing requirements. `POST /api/v1/providers/test` runs local checks only and reports whether a network call was made (none in the bundled adapters).
- Data-source permissions: `GET /api/v1/data-sources` shows each source's permission basis and freshness label. Historical and announcement endpoints stay withheld until the matching `*_PERMISSION_CONFIRMED` attestation is set.

## PostgreSQL backup/restore

Use encrypted storage, least-privilege backup credentials, and a retention policy that matches local privacy and market-data license terms. A basic manual dump/restore pattern:

```bash
# Backup (secure the output path and encryption/key policy)
pg_dump --format=custom --no-owner --file="nse-pulse-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"

# Restore into a newly provisioned recovery database after checking the target
createdb nse_pulse_restore_test
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" nse-pulse-backup.dump
```

### Drill actually executed (2026-10-25, PostgreSQL 16.14)

Performed against disposable local databases, never a production one. Recorded so the procedure
above is known to work rather than assumed:

| Step                          | Command                                                                                      | Observed result                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Empty database                | `createdb nse_pulse_drill_test`                                                              | 0 tables in `public`                                                         |
| Initialise schema             | `DATABASE_URL=… npm run db:migrate`                                                          | 31 tables, 67 indexes, 30 foreign keys, 1 `drizzle.__drizzle_migrations` row |
| Idempotency                   | `npm run db:migrate` again                                                                   | success in 35 ms, still 31 tables and 1 journal row                          |
| Seed disposable data          | `INSERT` of 3 securities, 3 observations, 3 historical rows                                  | 3/3/3 rows                                                                   |
| Backup                        | `pg_dump -Fc`                                                                                | 70,232 bytes, 167 TOC entries, sha256 `e706420f…bfab3`                       |
| Restore                       | `pg_restore --no-owner --no-privileges --exit-on-error` into `nse_pulse_drill_test_restored` | exit 0                                                                       |
| Integrity                     | per-table `count(*)` and md5 of ordered row text for all 31 tables                           | 0 mismatches; indexes 67/67 and foreign keys 30/30 identical                 |
| Restored DB is a valid target | `npm run db:migrate` against the restored database                                           | no-op, journal still 1 row                                                   |

The dump/restore tools were PostgreSQL 16.2 clients against a 16.14 server. A `pg_dump` older
than the server refuses to run (a 14.x client aborted with "server version mismatch"), so match
major versions in real operations.

Schedule regular backups, keep an off-host copy, restrict access, encrypt at rest/in transit, and perform a restore drill before relying on backups. Confirm stored market data can be retained under the applicable license. No automated backup service is bundled.

## Migrations and rollback

1. Back up first.
2. Review SQL in `drizzle/generated/` and check whether changes are additive.
3. Deploy code compatible with the current schema, then run `npm run db:migrate` once.
4. Verify `GET /api/v1/health`, application queries, and logs.
5. Do not manually drop/recreate tables as a rollback. Prefer a new corrective migration or restore to a separate recovery DB. Migration rollback is not automatically generated; data-destructive changes require a deliberate backup/restore plan.
6. Migration sequencing, idempotency and failure behaviour are exercised by `tests/integration/migrations.test.ts` against a disposable database, using synthetic migrations in a temporary folder (the repository itself ships a single migration).

## Integration test workflow

| Step                              | Command                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Everything, one command           | `npm run test:integration:local`                                             |
| Keep the container for inspection | `npm run test:integration:local -- --keep`                                   |
| Manual, against any PostgreSQL 16 | `TEST_DATABASE_URL=postgres://…/name_test npm run test:integration:verified` |

The script starts only the `db-test` compose service (profile `test`, ephemeral tmpfs data,
`127.0.0.1:5433`), waits for `pg_isready`, applies migrations, runs the suite with
`REQUIRE_INTEGRATION_TESTS=true`, then removes that one container. It never runs
`docker compose down` and never passes `-v`, so the `postgres-data` volume behind a developer's
`db` service is never touched.

Failure modes and what they mean:

| Output                                                      | Meaning                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `✖ Docker is not available`                                 | No daemon/socket. Use the manual command above.                                                              |
| `✖ docker compose (v2) is not available`                    | Install the Compose plugin; v1 `docker-compose` is not supported.                                            |
| `✖ docker-compose.yml does not declare a "db-test" service` | Wrong working directory, or the service was renamed.                                                         |
| `✖ Migrations failed; not running the suite.`               | Schema problem; the suite is deliberately not attempted.                                                     |
| `Integration assertion failed: only N test(s) passed`       | PostgreSQL was reachable but the suite did not execute — the guard that stops a skipped suite looking green. |

## Supported runtime

| Item          | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Node.js       | `>=22.12.0 <23`, enforced by `.npmrc` (`engine-strict=true`); `npm ci` fails with `EBADENGINE` otherwise |
| npm           | `>=10`                                                                                                   |
| Line endings  | LF in every checkout, enforced by `.gitattributes`                                                       |
| HTTP timeouts | 15 s headers, 30 s request, 5 s keep-alive (`src/server/api/http.ts`)                                    |

`npm run check` is the fast gate (typecheck, lint, formatting, secret scan); `npm run verify` adds
coverage and both production builds.

## Restart and troubleshooting

- API not starting: confirm Node version (`node -v` must be 22.x; `npm ci` fails fast on anything else), `PORT`, `HOST`, the database settings and the logs.
- **Every file reported as unformatted by `npm run format:check`**: the working tree has CRLF line endings, not unformatted code. Prettier is configured with `endOfLine: 'lf'` and `.gitattributes` normalises checkouts. Renormalise an older clone once with `git add --renormalize . && git checkout -- .`.
- **`shutdown_started` without `shutdown_complete`**: the 10-second deadline fired and the process exited 1. Check for a stuck request; `server.close()` waits for active requests, idle keep-alive sockets are dropped immediately.
- Dashboard cannot reach API: ensure reverse proxy maps `/api` to port `4000`; `APP_ORIGIN` must match browser origin.
- `DATABASE_URL` missing: only degraded empty-state behavior is expected; configure Postgres (either `DATABASE_URL` or the `SQL_HOST`/`SQL_PORT`/`SQL_DB_NAME`/`SQL_ADMIN_USER`/`SQL_ADMIN_PASSWORD` group) and run migrations.
- `Incomplete database configuration: SQL_DB_NAME, SQL_ADMIN_USER must be set…`: part of the `SQL_*` group is missing while no `DATABASE_URL` is present. The startup message names the missing keys only; it never prints values.
- DB unreachable: check network/firewall, TLS settings and role grants; do not put credentials in diagnostic logs.
- **Data routes return 503 or the overview reports `database.state: SCHEMA_MISSING`**: the API is up but the database has no application tables (`SQLSTATE 42P01`). Run `npm run db:check` (exit `1`) and then `npm run db:migrate` with the same `DATABASE_URL`. `GET /api/v1/health/ready` returns `503` with `checks.database.schemaInitialised: false` and a hint until this is fixed.
- **Reading the logs**: `database_request_failed` includes `databaseError.kind` (`SCHEMA_MISSING`, `AUTH`, `PERMISSION`, `CONNECTION`, `UNKNOWN`), the SQLSTATE `code` and the object named by the driver — this is the information the old handler discarded, because Drizzle's message is only `Failed query: …` and the cause sits on `error.cause`.
- **`telegram_disabled` (level 30/40)**: expected when `TELEGRAM_BOT_TOKEN` is absent, and reported when the value does not look like a BotFather token (`<id>:<secret>`). Polling is skipped; the API and market-data service keep running.
- **`telegram_polling_not_started`**: the _database_ prevented the advisory lock from being taken, so polling was deliberately skipped to avoid duplicate replies. Read `databaseError`/`hint`; this is not a Telegram problem.
- **`telegram_start_failed`**: now carries `stage`, `kind` (`UNAUTHORIZED`, `CONFLICT`, `BLOCKED`, `NETWORK`, `RATE_LIMIT`, `UNKNOWN`), a redacted `description` and a `hint`. The token itself is never logged.
- Provider `UNCONFIGURED`: expected until access agreement, supported adapter, endpoint documentation and secrets are provided. Credential presence alone does not change this state.
- Demo banner visible: `MARKET_DATA_PROVIDER=demo` is active. Fixture values are synthetic; set `MARKET_DATA_PROVIDER=none` and `ALLOW_DEMO_MARKET_DATA=false` before any deployment. Demo mode is refused in production.
- Configuration page shows credentials `MISSING`: expected. Set the values only as server-side secrets after a contract and API specification exist; never add them to the browser bundle.
- Historical data present but withheld: `HISTORICAL_DATA_PERMISSION_CONFIRMED` is not `true`. Record written permission before enabling; the flag is an operator attestation, not a licence.
- No announcements shown: expected unless permission is recorded and an `ISSUER_ANNOUNCEMENT` source row is enabled. The application never scrapes or fetches announcements itself.
- Quotes absent: importer/feed are not active; do not use synthetic or scraped values as a workaround.
- Shutdown: `SIGTERM`/`SIGINT` stop the scheduler, stop accepting connections, stop the Telegram bot, close the database pool and exit; a 10-second deadline forces termination. A second signal exits immediately.
- Bot inactive: configure token on exactly one polling process and check Telegram connectivity; the token is secret.
- Scheduler disabled: set `ENABLE_SCHEDULER=true` with DB available only if the provider-health heartbeat is wanted. It does not ingest data.
