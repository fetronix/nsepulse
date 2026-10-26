# Security and privacy notes

## Present controls

- Helmet security headers; Express `x-powered-by` disabled.
- Explicit configured CORS origin (no wildcard credentialed CORS).
- 32 KB JSON request limit; API rate limit.
- Zod validation for symbol/date/pagination inputs.
- Safe generic API error responses; no secret-bearing provider configuration is returned by health APIs. Provider configuration and test endpoints expose credential _presence_ only — no field ever carries a secret value, and tests assert injected values never appear in responses.
- `POST /api/v1/providers/test` is rate limited (10/minute), performs local checks only and reports whether any outbound request was made; the bundled adapters make none.
- Database secrets, the Telegram token and `MANSA_API_KEY` are environment-only; `.env` excluded from git. The Mansa key is held only by the adapter's HTTP client, is never placed in a query string, and is never written to `ProviderSettings` (so it cannot be serialised into a response by accident). The client refuses a non-HTTPS base URL, so a bearer token cannot be sent in the clear, and every error message is built from status codes rather than the request, so a rejected key never appears in an error, log line or stack trace.
- Structured logging (pino) with redaction paths for authorization headers, cookies, tokens, API keys and passwords; request logs carry a correlation id and a path without query string, never headers or bodies.
- Caller-supplied `x-request-id` values are only echoed when they match a UUID-like pattern; otherwise a new id is generated to prevent log injection.
- CI runs `npm audit --audit-level=high` and the repository secret scan (`npm run check:secrets`), which also fails if a `.env` file other than `.env.example` is tracked.
- SQL uses parameterized queries; Drizzle query builder for application reads.
- Announcements are only surfaced when their stored source link is an absolute HTTP(S) URL; anything else is filtered out and reported instead of rendered.

## Important gaps

This increment does not implement sign-in, sessions, passwords, user roles, user-owned watchlists/portfolios/alerts, Telegram account pairing, CSRF controls, deletion/export workflows, or admin APIs. Do not expose user-specific write endpoints until these are implemented and tested. Do not enable `passwordHash` or user table workflows as a substitute for an authentication implementation.

## Operational requirements before production

- Use HTTPS, secure host firewall, least-privilege PostgreSQL role, strong rotating secrets, server-side secret manager, TLS verification and dependency update process.
- Review request logging and configure log redaction/retention. Avoid storing provider raw payloads unless permitted and necessary.
- Set a data retention schedule for user/account, alert and market data; provide deletion/access request procedures appropriate to applicable law.
- Restrict admin access and audit changes when admin functions exist.
- Threat-model authentication/session handling, bot ownership verification, notification cross-user isolation, SSRF and webhook/polling behavior before enabling those features.
- Run SAST, dependency scanning, secure configuration checks and independent penetration testing before production launch.

## Secret handling in this repository

- `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `node_modules/`, `dist/`, `coverage/`, `.vite/`, logs, database dumps and editor artifacts.
- `npm run check:secrets` scans every git-tracked file (plus untracked files with `--all`) for private-key blocks, cloud/provider token shapes and long assigned secret literals, and fails if a `.env` file other than `.env.example` is tracked. Verified by adding a synthetic GitHub-token string to a scratch file: the scan exits 1 and names the file and line.
- This is a guard against accidental commits, not a substitute for provider-side secret scanning or history rewriting after a leak.

## Accepted risks

These are known, currently accepted limitations. Each is recorded with the reason it is accepted and what would have to change to close it.

| Risk                                                    | Why it is accepted now                                                                                                            | Closure condition                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No authentication or authorisation                      | No user-owned data is served or written; the API is read-only over public market metadata, plus provider configuration state.     | Do not add user-scoped write endpoints until sessions, ownership checks and CSRF protection exist with tests. |
| `POST /api/v1/providers/test` reachable without auth    | It performs local configuration checks only; the bundled adapters make no outbound request and it is rate limited to 10/minute.   | Revisit before adding any adapter that performs outbound calls from that endpoint.                            |
| In-memory rate limiting                                 | A single-process deployment only; no shared store is configured.                                                                  | Replace with a shared store (e.g. Redis) before running more than one API replica.                            |
| Telegram bot trusts updates from the configured token   | The bot only serves read-only queries and has no privileged commands.                                                             | Add sender allow-listing and ownership verification before adding mutating commands.                          |
| Dependency advisories in transitive/build-only packages | Current `npm audit --audit-level=high` is clean; low/moderate advisories in build tooling may be fixed only by upstream releases. | Re-run the audit every CI run; upgrade when a non-breaking release exists.                                    |
| Market data is unavailable by default                   | `MARKET_DATA_PROVIDER=none`; no credentials, endpoints or scraping are shipped.                                                   | Selecting a provider requires documented licensing, credentials in the environment and a fresh provider test. |
| No penetration test or SAST baseline                    | This is an unreleased internal increment.                                                                                         | Explicitly required before any production launch.                                                             |

The absence of findings above must never be read as "zero vulnerabilities": the authoritative statement is the result of the most recent `npm audit` in CI, and it is only true for the commit that ran it.

## Reporting a problem

Report suspected vulnerabilities privately to the repository maintainers rather than in a public issue. Do not include live credentials, market-data payloads or personal data in a report.
