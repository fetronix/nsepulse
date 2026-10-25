# Data-provider configuration and licensing

## Known access position

NSE's published material describes direct live feeds for subscribers or access through authorized data vendors. Delayed products are described as at least 15 minutes delayed and updated every minute. Historical data has request/subscription paths. NSE publishes licensed vendors and notes that application/web redistribution requires the applicable data license. See the source links in the root README.

At this implementation version there is **no verified programmatic NSE API contract or working NSE adapter**. The configured adapter interface deliberately avoids guessing an endpoint or scraping public display pages. `NSE_VENDOR_API_BASE_URL` and `NSE_VENDOR_API_KEY` are placeholders, not an integration.

## Obtain and verify access

1. Define whether the product is internal research, individual use, public display, commercial service, redistribution, or derived data; these can have different rights.
2. Contact NSE Data Services (`dataservices@nse.co.ke`) using the current official Data Services page and complete any required evaluation/subscription steps. Alternatively, evaluate a vendor currently listed by NSE.
3. Obtain written rights for display, storage, historical retention, derived analytics, Telegram distribution, caching and attribution; confirm who is responsible for end-user reporting/fees.
4. Obtain official API specs and sample responses. Confirm auth, field semantics, market-event vs publication timestamps, delay guarantee, time zone, instrument IDs, retries/rate limits, revision handling and error codes.
5. Confirm separate permissions for news, issuer reports and corporate-action sources. A public URL does not automatically grant bulk collection or republication rights.
6. Implement a dedicated provider adapter in `src/server/providers/`; validate response payloads, preserve event/publish/ingest times and source, and mark `dataMode` exactly as contracted. Add fixture tests plus separately reported live integration tests.
7. Use provider sandbox/test credentials if offered. Do not mark a feed `READY` or prices real-time based on config presence alone.
8. Store secrets in a server-side secret manager or environment, rotate credentials, and redact them from logs. Do not use `VITE_` browser variables for secrets.

## Current behavior

- Default adapter: `UNCONFIGURED`, `UNKNOWN` data mode, `null` quote, empty historical series.
- There is no hidden fixture fallback.
- Even once configured, a provider integration must independently validate market timestamps, data age, prices/units/currency, duplicate/correction behavior, outliers, coverage and service health before live display.
- The API's provider state indicates application wiring, not contractual permission or market availability.

## Security-master source

No automatic source synchronization is enabled. The importer takes a reviewed NSE/CDSC HTTPS CSV, upserts unique `(exchange,symbol)`, flags every record for review and rejects duplicate symbols in one import. Confirm the current official source, valid instrument type/status mapping, symbol changes/delistings and permitted reuse before importing. All users should be shown source and verification time.
