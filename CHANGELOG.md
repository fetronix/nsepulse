# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). This file describes what the
code actually does now; it is not a roadmap and contains no claims about data that has not
been verified.

## [Unreleased]

Nothing has been released yet. `package.json` still reports `0.1.0`, and no tag exists — a
version number here will only be written when there is a reviewed release to attach it to.

### Added

- **Local integration workflow.** `npm run test:integration:local` starts the disposable
  `db-test` Compose service, waits for readiness (falling back to `pg_isready` polling when
  Compose predates `up --wait`), applies migrations, runs the integration suite with
  `REQUIRE_INTEGRATION_TESTS=true`, and removes that container afterwards. Cleanup uses
  `rm -sf db-test` specifically: `down` would also stop a developer's own `db`/`app`, and
  `-v` would delete the `postgres-data` volume. A missing Docker daemon produces an exit code
  of 1 and a manual fallback, never a silent skip.
- `docs/OPERATIONS.md` now documents the integration workflow and its failure messages.
- Tests for quote resolution against a live adapter (provider success, undated snapshot, old
  snapshot, provider failure with and without a stored fallback).
- Tests for the Mansa adapter's parsing rules — exchange discovery, mover mapping, snapshot
  lookup, capability/status derivation — and for its TTL cache (expiry, single-flight
  de-duplication, eviction), which is what keeps the adapter inside Mansa's documented 100
  requests/day.
- Tests for the Telegram polling guard that prevents two `getUpdates` loops answering the
  same command.
- `CHANGELOG.md`.

### Changed

- **The database schema is split by domain** (`identity`, `market`, `research`, `personal`,
  `operations`) behind a re-exporting barrel, so `drizzle.config.ts` and every existing
  import path still work. `npx drizzle-kit generate` reports "No schema changes" before and
  after, which is how the move was verified.
- **`MarketService` is split** into `market/provenance.ts` (what a value may call itself) and
  `market/quote.ts` (the quote branch order), leaving the class to orchestrate.
- **The Mansa adapter is split** into `descriptor.ts`, `discovery.ts`, `movers.ts` and
  `snapshot.ts`, with the HTTP calls left in the provider. These are now pure functions and
  are tested directly.
- **The UI is split** into `App.tsx` (shell and state), `pages/*` (one page each) and
  `components/*` (the provider cards). The rendered output is unchanged.
- `MANSA_LIVE_TESTS` documented in `.env.example`; the live Mansa test requires it in
  addition to `MANSA_API_KEY`, so a key in a developer's `.env` cannot turn `npm test` into a
  billable API call.
- The environment-variable guard now also scans `tests/`, ignores process-level variables and
  strips comments before matching.

### Fixed

- A provider snapshot with no market event timestamp was reported as "older than 24 hours".
  It is still treated as stale, but the warning now says freshness cannot be asserted, which
  is what is actually known.
- Formatting failures caused by CRLF checkouts (110 files when the working tree carried CRLF)
  are prevented by `.gitattributes` (`* text=auto eol=lf`) together with Prettier's
  `endOfLine: 'lf'`. Existing clones may need
  `git add --renormalize . && git checkout -- .`.

### Security

- No credentials are rendered anywhere in the UI; the provider page reports configured or
  missing state only, and the tests assert that no secret value appears in API responses or
  logs.

## Not done

Recorded here so the gap is not mistaken for an oversight:

- No live Mansa or NSE request has been verified in this environment. `MARKET_DATA_PROVIDER`
  stays `none` by default, and nothing in this release claims live prices.
- `@types/express` is on v5 while the runtime is Express 4. The build is clean, but the types
  describe an API the server does not run; aligning them is deliberate follow-up work.
- No `LICENSE` file exists in the repository. The package declares no licence, and none was
  added automatically.
