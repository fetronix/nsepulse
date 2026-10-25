# Engineering readiness matrix

Scope: the NSE Pulse repository at the commit that contains this document. Every row states a
requirement, the current status, **the exact command that was run**, the **actual result
observed**, the evidence left in the repository, and the limitation that remains.

Rules used when writing this file:

- A requirement is only marked **Met** if the command was executed and its output observed.
- Anything that could not be executed here is marked **Blocked** (environment) or
  **Not implemented** (product scope), never "assumed".
- No score, rating, payout or endorsement is implied by any status below.
- Where a claim depends on external data or a third party, the row names what is missing.

Environment used for the run below: Linux sandbox, Node `v22.22.3`, npm `10.9.8`, no Docker
daemon, no PostgreSQL server, no network access to a market-data provider.

## 1. Reproducible installation

| Item          | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Requirement   | The project installs from a clean checkout using the committed lockfile                            |
| Status        | **Met**                                                                                            |
| Verification  | `git clone <repo> /tmp/fresh && cd /tmp/fresh && npm ci`                                           |
| Actual result | Completed; `found 0 vulnerabilities`; `node_modules` created from `package-lock.json`              |
| Evidence      | `package-lock.json`, `engines` (`node >=22.12 <23`, `npm >=10`), `.nvmrc` = `22`, CI uses `npm ci` |
| Limitation    | Only Node 22.22.3 was exercised; other versions in range were not tested                           |

## 2. Type checking

| Item          | Value                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Requirement   | App and server type-check under strict settings                                                        |
| Status        | **Met**                                                                                                |
| Verification  | `npm run typecheck` (fresh clone)                                                                      |
| Actual result | Exit 0, no diagnostics                                                                                 |
| Evidence      | `tsconfig.json`, `tsconfig.server.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns` |
| Limitation    | Type checking proves consistent types, not runtime correctness                                         |

## 3. Linting and formatting

| Item          | Value                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement   | ESLint (TS + React) and Prettier pass with no suppressions added to go green                                                                           |
| Status        | **Met**                                                                                                                                                |
| Verification  | `npm run lint`, `npm run format:check` (fresh clone)                                                                                                   |
| Actual result | ESLint exit 0; Prettier `All matched files use Prettier code style!`                                                                                   |
| Evidence      | `eslint.config.js` (flat config; `no-explicit-any` error in app/server/test code), `prettier.config.js`, `.prettierignore`                             |
| Limitation    | One documented exception exists: `react-hooks/set-state-in-effect` is disabled for client data-fetching effects, with the reason written in the config |

## 4. Automated tests and coverage gates

| Item          | Value                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Meaningful test suite with enforced, non-lowered coverage thresholds                                                                                                                           |
| Status        | **Met** for unit/API/client suites; **Blocked** for the PostgreSQL integration suite                                                                                                           |
| Verification  | `npm run test:coverage` (fresh clone); `npm run test:integration` (fresh clone, no `TEST_DATABASE_URL`)                                                                                        |
| Actual result | `24 test files, 196 tests passed`; statements 88.24 % (878/995), branches 80.74 % (776/961), functions 89.95 % (215/239), lines 88.31 % (786/890). Integration run: `1 file / 7 tests skipped` |
| Evidence      | `vitest.config.ts` thresholds 70/60/70/70 (statements/branches/functions/lines), `vitest.integration.config.ts`, `tests/**`                                                                    |
| Limitation    | Integration tests need a reachable PostgreSQL; they skip rather than pretend to pass. Provider behaviour is verified against mocked HTTP, not a live feed                                      |

## 5. CI pipeline

| Item          | Value                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | CI fails on any quality, test, coverage, build or audit failure; no production secrets; least privilege                                                                                                                                 |
| Status        | **Met**                                                                                                                                                                                                                                 |
| Verification  | Push to the working branch, then `gh run list` / `gh run view <id>`                                                                                                                                                                     |
| Actual result | Run `40185483519` concluded `success` for commit `7008cb0`; earlier run `40184808744` failed and the defect (devDependencies missing from the lockfile) was fixed in `da766a8`                                                          |
| Evidence      | `.github/workflows/ci.yml` jobs `quality`, `test`, `build`, `integration`, `security`; `.github/dependabot.yml`                                                                                                                         |
| Limitation    | The integration job's PostgreSQL path is exercised on GitHub runners only, not locally; job logs could not be downloaded from this sandbox (`gh run view --log-failed` returned `EOF`), so only the run/conclusion summary was verified |

## 6. Dependency security

| Item          | Value                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | High-severity advisories block CI; updates arrive automatically                                                                                                  |
| Status        | **Met at the recorded commit**                                                                                                                                   |
| Verification  | `npm audit --audit-level=high` (fresh clone)                                                                                                                     |
| Actual result | `found 0 vulnerabilities`                                                                                                                                        |
| Evidence      | CI `security` job, Dependabot weekly config, `413e6b1`-style upgrade commits                                                                                     |
| Limitation    | An audit result is only valid for the moment it runs. This is **not** a claim of zero vulnerabilities in general. No SAST or penetration test has been performed |

## 7. Secret hygiene

| Item          | Value                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | No secrets in the repository; accidental commits are caught                                                                                       |
| Status        | **Met**                                                                                                                                           |
| Verification  | `npm run check:secrets`; plus a deliberate probe (a synthetic `ghp_…` token written to a scratch file)                                            |
| Actual result | Clean scan over tracked files; the probe made the scan exit 1 and print `file:line — GitHub token`; after deleting the file the scan passed again |
| Evidence      | `scripts/check-secrets.mjs`, CI `security` job, `.gitignore` (`.env`, dumps, `.pgdata`)                                                           |
| Limitation    | Pattern-based scanning is a guard, not proof; a leaked credential would still require rotation and history rewriting                              |

## 8. Production build and runtime

| Item          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Client and server build artefacts start and answer health probes without a database                                                                                                                                                                                                                                                                                                                                                             |
| Status        | **Met**                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Verification  | `npm run build`, `npm run build:api`, then `NODE_ENV=production node dist/server/index.js` and `curl`                                                                                                                                                                                                                                                                                                                                           |
| Actual result | Vite build produced `dist/index.html` + hashed assets; `dist/server/index.js` created; `GET /api/v1/health/live` → 200; `/api/v1/health/ready` → 200 `status: "ready"` with `database.configured=false` and `provider.state=UNCONFIGURED`; `/api/v1/providers/configuration` → `integrationStatus: "UNCONFIGURED"`; `/api/v1/announcements` → `state: "PERMISSION_UNCONFIRMED"`; `SIGTERM` produced `shutdown_started` then `shutdown_complete` |
| Evidence      | `src/server/index.ts`, `src/server/api/app.ts`, `src/server/services/health.ts`                                                                                                                                                                                                                                                                                                                                                                 |
| Limitation    | Verified in a production-mode simulation with `npm ci --omit=dev`; not inside a container                                                                                                                                                                                                                                                                                                                                                       |

## 9. Containerisation

| Item          | Value                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Multi-stage image, non-root, health check, no secrets, migrations opt-in, loopback-only database                             |
| Status        | **Blocked** (no Docker in this environment) — configuration reviewed, build not executed                                     |
| Verification  | `npx js-yaml docker-compose.yml` parses; Dockerfile stages reviewed; `docker build .` **not run**                            |
| Actual result | Compose file is valid YAML with services `db`, `app`, `db-test` (profile `test`); image build and container start unverified |
| Evidence      | `Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml`, `.dockerignore`, README §15, `docs/OPERATIONS.md`                |
| Limitation    | Run `docker compose up --build` and `docker build -t nse-pulse .` where Docker exists before relying on it                   |

## 10. Database migrations

| Item          | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Versioned migrations that fail safely and apply in order                                                                                                      |
| Status        | **Partially met** — migration scripts exist and fail safely; execution against PostgreSQL not verified here                                                   |
| Verification  | `node dist/server/db/migrate.js` with no `DATABASE_URL`                                                                                                       |
| Actual result | Exits non-zero with a structured error explaining that `DATABASE_URL` is not configured                                                                       |
| Evidence      | `drizzle/generated/`, `src/server/db/migrate.ts`, `npm run db:check`, CI integration job                                                                      |
| Limitation    | No PostgreSQL server or client in this sandbox (`psql`/`initdb` absent); migration application, rollback and restore must be verified against a real database |

## 11. Environment completeness

| Item          | Value                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Every variable the code reads is documented, validated and defaulted                                                                                                                                                                                    |
| Status        | **Met**                                                                                                                                                                                                                                                 |
| Verification  | Extraction of environment reads from `src/server/config.ts` and the CLI importers compared with `.env.example`; `npm run test:coverage` covers `tests/server/config.test.ts` (defaults, enum rejection, demo refusal in production, `LOG_LEVEL` levels) |
| Actual result | 16 documented variables, no duplicates, no undocumented reads; `SECURITY_MASTER_SOURCE_URL` and `SECURITY_MASTER_VERIFIED_AT` documented as per-command inputs; `RUN_MIGRATIONS` documented as container-only                                           |
| Evidence      | `.env.example`, `src/server/config.ts`, README §8                                                                                                                                                                                                       |
| Limitation    | Third-party libraries read additional variables (e.g. `PG*`, `NODE_OPTIONS`) that are not ours to validate                                                                                                                                              |

## 12. Observability

| Item          | Value                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Structured logs, correlation ids, health probes, graceful shutdown, no secrets in logs                                                                                                                                                                                                             |
| Status        | **Met**                                                                                                                                                                                                                                                                                            |
| Verification  | `npm run test:coverage` (`tests/server/logging.test.ts`, `tests/server/health.test.ts`, `tests/api/health-routes.test.ts`); runtime curl + log inspection                                                                                                                                          |
| Actual result | JSON log lines carry `service`, `env`, `module`, `time`, `level`, `msg`; request lines add `req.correlationId`, method, path (no query), status, `responseTime`; `x-request-id` echoed when UUID-shaped, regenerated otherwise; redaction covers authorization/cookie/token/apiKey/password/secret |
| Evidence      | `src/server/logging/logger.ts`, `src/server/services/health.ts`, `docs/OPERATIONS.md`, `docs/SECURITY.md`                                                                                                                                                                                          |
| Limitation    | Log retention, shipping and alerting are deployment concerns not implemented here                                                                                                                                                                                                                  |

## 13. Domain-honesty constraints

| Item          | Value                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Never present unavailable, demo or stale data as live; preserve provenance and permission labels                                                                                                                                                                |
| Status        | **Met**                                                                                                                                                                                                                                                         |
| Verification  | Unit/API tests for demo labelling, permission gating, freshness states and quote-unavailable reasons; runtime curl of the unconfigured server                                                                                                                   |
| Actual result | `MARKET_DATA_PROVIDER=none` reports `liveQuoteAdapterEnabled: false`; announcements return `PERMISSION_UNCONFIRMED`; readiness reports `dataFreshness: NO_DATA`; demo fixtures require `ALLOW_DEMO_MARKET_DATA=true` and are refused when `NODE_ENV=production` |
| Evidence      | `src/server/providers/**`, `src/server/services/data-sources.ts`, `tests/server/market-service.test.ts`, `tests/server/data-sources.test.ts`                                                                                                                    |
| Limitation    | No licensed dataset exists, so nothing about real NSE values is verified                                                                                                                                                                                        |

## 14. Documentation

| Item          | Value                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | README, env reference, operations, security, status, API description and contribution guide match the code                                                            |
| Status        | **Met**                                                                                                                                                               |
| Verification  | README commands cross-checked against `package.json` scripts; `docs/openapi.yaml` parsed and its paths compared with the routes registered in `src/server/api/app.ts` |
| Actual result | 13 documented paths match 13 registered routes; all documented commands exist in `package.json`                                                                       |
| Evidence      | `README.md` (20 sections), `.env.example`, `docs/OPERATIONS.md`, `docs/SECURITY.md`, `docs/PROJECT_STATUS.md`, `docs/openapi.yaml`, `CONTRIBUTING.md`                 |
| Limitation    | OpenAPI entries are summaries, not full schemas; response shapes are described in prose and tests rather than JSON Schema                                             |

## 15. Licensing and provenance

| Item          | Value                                                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Truthful provenance inventory, no false ownership claims, no repository licence assertion                                                                                                                                                                                                      |
| Status        | **Met as an inventory** — the repository has no `LICENSE` file, and none was added                                                                                                                                                                                                             |
| Verification  | `npx license-checker --production --json`, `npx license-checker --json`, `git log`, `package.json`                                                                                                                                                                                             |
| Actual result | Production tree: 122 packages — MIT 111, ISC 6, BSD-2-Clause 2, BSD-3-Clause 1, Apache-2.0 1 (plus the project itself, unlicensed). Full tree: 423 packages — MIT 353, ISC 24, Apache-2.0 20, BSD-2-Clause 9, BSD-3-Clause 7, MPL-2.0 6, CC-BY-4.0 1 (`caniuse-lite`), 0BSD 1, BlueOak-1.0.0 1 |
| Evidence      | `docs/DATAFACTOR_REVIEW.md`                                                                                                                                                                                                                                                                    |
| Limitation    | No licence review by counsel; no market-data licence exists; copyright ownership beyond the recorded commit authorship is not established                                                                                                                                                      |

## 16. Integration testing against real PostgreSQL

| Item          | Value                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement   | Repository-layer tests run against a disposable database, not mocks only                                                                                                                                                                              |
| Status        | **Blocked** in this environment                                                                                                                                                                                                                       |
| Verification  | `npm run test:integration` with no `TEST_DATABASE_URL`; `which psql`, `which initdb`, `docker info`                                                                                                                                                   |
| Actual result | Suite skips (`7 tests skipped`); `psql`, `initdb` and the Docker daemon are all absent                                                                                                                                                                |
| Evidence      | `tests/integration/database.test.ts`, `tests/integration/setup.ts`, `vitest.integration.config.ts`, CI `integration` job, compose `db-test` profile                                                                                                   |
| Limitation    | Run `docker compose --profile test up -d db-test` then `TEST_DATABASE_URL=postgres://nse_pulse_test:test_only@127.0.0.1:5433/nse_pulse_test npm run test:integration` where Docker is available. The guard refuses a URL without a test database name |

## 17. Items explicitly not ready

| Item                                    | Status          | Why                                                                |
| --------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Live market-data ingestion              | Not implemented | No provider contract, credentials or licence                       |
| Authentication, sessions, roles         | Not implemented | No user-scoped write endpoints exist                               |
| Watchlists, portfolios, alerts delivery | Not implemented | Depends on authentication                                          |
| News, fundamentals, corporate actions   | Not implemented | No permitted source                                                |
| Telegram notification queue             | Not implemented | Bot is read-only and polling-only                                  |
| Load, penetration and chaos testing     | Not performed   | Out of scope for this increment                                    |
| Commercial-use clearance                | Unknown         | No repository licence; market-data rights belong to the data owner |

## How to re-run everything

```bash
cd <fresh clone>
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run check:secrets
npm run test:coverage
npm audit --audit-level=high
npm run build
npm run build:api
docker compose --profile test up -d db-test   # if Docker exists
TEST_DATABASE_URL=postgres://nse_pulse_test:test_only@127.0.0.1:5433/nse_pulse_test npm run test:integration
docker build -t nse-pulse .
docker compose up -d && curl -s localhost:4000/api/v1/health/ready
```

If a step cannot be run in your environment, record it as not run. Do not upgrade this matrix
on the strength of a different machine's results.
