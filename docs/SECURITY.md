# Security and privacy notes

## Present controls

- Helmet security headers; Express `x-powered-by` disabled.
- Explicit configured CORS origin (no wildcard credentialed CORS).
- 32 KB JSON request limit; API rate limit.
- Zod validation for symbol/date/pagination inputs.
- Safe generic API error responses; no secret-bearing provider configuration is returned by health APIs. Provider configuration and test endpoints expose credential *presence* only — no field ever carries a secret value, and tests assert injected values never appear in responses.
- `POST /api/v1/providers/test` is rate limited (10/minute), performs local checks only and reports whether any outbound request was made; the bundled adapters make none.
- Database secrets and Telegram token are environment-only; `.env` excluded from git.
- SQL uses parameterized queries; Drizzle query builder for application reads.

## Important gaps

This increment does not implement sign-in, sessions, passwords, user roles, user-owned watchlists/portfolios/alerts, Telegram account pairing, CSRF controls, deletion/export workflows, or admin APIs. Do not expose user-specific write endpoints until these are implemented and tested. Do not enable `passwordHash` or user table workflows as a substitute for an authentication implementation.

## Operational requirements before production

- Use HTTPS, secure host firewall, least-privilege PostgreSQL role, strong rotating secrets, server-side secret manager, TLS verification and dependency update process.
- Review request logging and configure log redaction/retention. Avoid storing provider raw payloads unless permitted and necessary.
- Set a data retention schedule for user/account, alert and market data; provide deletion/access request procedures appropriate to applicable law.
- Restrict admin access and audit changes when admin functions exist.
- Threat-model authentication/session handling, bot ownership verification, notification cross-user isolation, SSRF and webhook/polling behavior before enabling those features.
- Run SAST, dependency scanning, secure configuration checks and independent penetration testing before production launch.
