# Data-provider configuration, demo mode and licensing

## Known access position

NSE's published material describes direct live feeds for subscribers or access through authorized data vendors. Delayed products are described as at least 15 minutes delayed and updated every minute. Historical data has request/subscription paths. NSE publishes licensed vendors and notes that application/web redistribution requires the applicable data license. See the source links in the root README.

At this implementation version there is **no verified programmatic NSE API contract or working NSE adapter**. The configured adapter interface deliberately avoids guessing an endpoint or scraping public display pages. `NSE_VENDOR_API_BASE_URL` and `NSE_VENDOR_API_KEY` are placeholders, not an integration.

## Provider selection

`MARKET_DATA_PROVIDER` is evaluated in `src/server/providers/factory.ts`:

| Value            | Adapter                 | Behaviour                                                                                                |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `none` (default) | `UnconfiguredProvider`  | No request, `null` quote, empty history, `UNCONFIGURED`/`UNKNOWN`.                                       |
| `demo`           | `DemoFixtureProvider`   | Only when `ALLOW_DEMO_MARKET_DATA=true` and `NODE_ENV` is not `production`. Synthetic labelled fixtures. |
| `nse-vendor`     | `VendorPendingProvider` | Placeholder. Reports missing pieces; **never** makes a request, even with credentials present.           |
| anything else    | `UnconfiguredProvider`  | Unknown value is ignored with an explicit warning; no provider is enabled.                               |

`MARKET_DATA_PROVIDER=none` remains the enforced default. Credential presence never changes state to `READY`; only a written contract plus an implemented, contract-tested adapter may do that, and the current code contains no such adapter.

## Adapter interface

`src/server/providers/types.ts` defines the replaceable boundary:

```ts
interface MarketDataProvider {
  readonly id: string;
  readonly demo: boolean;
  status(): Promise<ProviderStatus>;
  capabilities(): ProviderCapabilities; // display name, version, access level, entitlement, declared coverage
  getLatestQuote(request: QuoteRequest): Promise<MarketObservation | null>;
  getHistory(request: HistoricalRequest): Promise<MarketObservation[]>;
  selfTest(now?: Date): Promise<ProviderSelfTest>; // local checks; reports whether a network call was made
}
```

Implementation rules enforced by review and tests:

1. No invented endpoint, credential, field name or coverage claim. Undeclared coverage is `NOT_DECLARED`.
2. No scraping of public display pages; no fixture fallback hidden behind an unconfigured adapter.
3. Every observation carries `source`, `marketEventAt`, `publishedAt`, `ingestedAt`, `dataMode` and `validationStatus`. Unknown timing stays `UNKNOWN`.
4. Demo data additionally carries `demo: true`, `dataMode: 'UNKNOWN'` and an unmistakable source label.
5. `selfTest` must not contact a provider unless a contracted adapter has been implemented and explicitly enabled; it reports `networkCallMade` honestly.

## Demo mode (development only)

Demo mode exists so the dashboard and API can be exercised without credentials. It is refused in production and requires two settings:

```bash
MARKET_DATA_PROVIDER=demo
ALLOW_DEMO_MARKET_DATA=true
```

Three synthetic fixtures (`SCOM`, `EQTY`, `KEGN`) with deliberately unrealistic prices (0.01–0.03) and short series are served by `src/server/providers/demo-fixtures.ts`. Every response is labelled:

- `observation.demo = true`, `dataMode: UNKNOWN`, source `DEMO FIXTURE — SYNTHETIC VALUES, NOT AN NSE QUOTE`;
- response-level `provenance.kind = DEMO_FIXTURE` and a warning;
- the UI shows a persistent demo banner and never renders a demo price beside a market-data access label;
- `/api/v1/health` reports `demoMode: true`, `liveQuoteAdapterEnabled: false`;
- the data-source page lists the live quote feed as `DISABLED`.

Do not deploy demo mode to users. Return to `MARKET_DATA_PROVIDER=none` before any deployment.

## Provider configuration page and API

The dashboard page **Provider setup** (`GET /api/v1/providers/configuration`) shows:

- provider name, adapter id/version and integration status;
- credential **presence** only — `CONFIGURED`/`MISSING` per environment variable, with a note that values are never returned or rendered (there is no field carrying a secret);
- declared supported securities and coverage (symbols, fields, intervals, history depth, indices);
- access level (`REAL_TIME`, `DELAYED`, `END_OF_DAY` or `UNKNOWN`) and entitlement (`NONE`, `DEMO_FIXTURE`, `CONTRACTED`);
- last successful retrieval, last attempt, last failure and persisted-store timestamps, with a note that adapter runtime facts reset when the process restarts;
- API connection and data-validation test results, each with status, checks, run time and whether a network call was made;
- outstanding licensing and approval requirements with blocking flags.

`POST /api/v1/providers/test` re-runs the local checks (rate limited to 10/minute). The page is read-only: credentials are configured only through server-side environment variables or a secret manager.

## Independent data sources

Historical records and official announcements do **not** depend on the live quote adapter, but each keeps its own permission and freshness label (`GET /api/v1/data-sources`):

| Source                                                 | Independence | Freshness label | Permission gate                                                                                       |
| ------------------------------------------------------ | ------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| Stored historical sessions (`/history`, `/technicals`) | Yes          | `END_OF_DAY`    | `HISTORICAL_DATA_PERMISSION_CONFIRMED=true`                                                           |
| Official company announcements (`/announcements`)      | Yes          | `AS_PUBLISHED`  | `ANNOUNCEMENTS_PERMISSION_CONFIRMED=true` plus an enabled `ISSUER_ANNOUNCEMENT` row in `news_sources` |
| Security master (`/securities`)                        | Yes          | `REFERENCE`     | Operator-initiated reviewed import                                                                    |
| Live/delayed quote feed                                | No           | `UNKNOWN`       | Contract + implemented adapter                                                                        |

`/api/v1/history/:symbol` and `/api/v1/technicals/:symbol` are withheld (empty items plus an explicit reason and `permission.status = UNCONFIRMED`) until the historical attestation is set. Demo fixtures are labelled and exempt from the historical gate. Announcement records are registered by an operator, not fetched by the application. Once written permission is on file, enable a source row (the URL columns must be the official pages you actually reviewed, never guesses):

```sql
INSERT INTO news_sources (name, source_type, terms_url, enabled, last_checked_at)
VALUES ('<official announcement source>', 'ISSUER_ANNOUNCEMENT', '<reviewed terms URL>', true, now());
```

Stored articles must reference that source with `original_url`, `publisher` and `published_at`; only articles from an enabled `ISSUER_ANNOUNCEMENT` source are returned. There is no announcement fetcher, scheduler or scraper in this build.

The permission flags are operator attestations, not licences. Set them only when written permission is on file; the app records nothing about the rights themselves. Announcements are never fetched or scraped by this application — it only reads items already stored against an enabled source and links to the original document. When no permission is recorded, `/api/v1/announcements` returns `PERMISSION_UNCONFIRMED` with no items.

## Obtain and verify access

1. Define whether the product is internal research, individual use, public display, commercial service, redistribution, or derived data; these can have different rights.
2. Contact NSE Data Services (`dataservices@nse.co.ke`) using the current official Data Services page and complete any required evaluation/subscription steps. Alternatively, evaluate a vendor currently listed by NSE.
3. Obtain written rights for display, storage, historical retention, derived analytics, Telegram distribution, caching and attribution; confirm who is responsible for end-user reporting/fees.
4. Obtain official API specs and sample responses. Confirm auth, field semantics, market-event vs publication timestamps, delay guarantee, time zone, instrument IDs, retries/rate limits, revision handling and error codes.
5. Confirm separate permissions for news, issuer reports and corporate-action sources. A public URL does not automatically grant bulk collection or republication rights.
6. Implement a dedicated provider adapter in `src/server/providers/`; validate response payloads, preserve event/publish/ingest times and source, and mark `dataMode` exactly as contracted. Add fixture tests plus separately reported live integration tests. Then declare real coverage and access level in `capabilities()`.
7. Use provider sandbox/test credentials if offered. Do not mark a feed `READY` or prices real-time based on config presence alone.
8. Store secrets in a server-side secret manager or environment, rotate credentials, and redact them from logs. Do not use `VITE_` browser variables for secrets.

## Current behaviour summary

- Default adapter: `UNCONFIGURED`, `UNKNOWN` data mode, `null` quote, empty historical series.
- There is no hidden fixture fallback; demo data is opt-in, labelled and refused in production.
- Even once configured, a provider integration must independently validate market timestamps, data age, prices/units/currency, duplicate/correction behavior, outliers, coverage and service health before live display.
- The API's provider state indicates application wiring, not contractual permission or market availability.

## Security-master source

No automatic source synchronization is enabled. The importer takes a reviewed NSE/CDSC HTTPS CSV, upserts unique `(exchange,symbol)`, flags every record for review and rejects duplicate symbols in one import. Confirm the current official source, valid instrument type/status mapping, symbol changes/delistings and permitted reuse before importing. All users should be shown source and verification time.
