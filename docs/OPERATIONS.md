# Deployment and operations

## Runtime

- Node.js 20.19+ and Linux.
- PostgreSQL 14+; persistent storage required for real usage.
- HTTPS reverse proxy/load balancer. Serve Vite `dist/` as static assets and proxy `/api/*` to Express.
- Keep one API process for low traffic; use a separate one-instance Telegram polling process when enabled. Do not share one bot token among polling instances.
- The optional scheduler uses PostgreSQL advisory lock to avoid concurrent heartbeat work. No market ingestion is scheduled yet.

## Build and start

```bash
npm ci
npm run build
npm run build:api
npm run db:migrate
NODE_ENV=production npm start
```

Serve files in `dist/` with a static web host. Set `APP_ORIGIN` to the browser origin. The Vite development proxy is not part of the production server.

For a separate bot process, configure its environment with `TELEGRAM_BOT_TOKEN`, but leave the API process token blank to avoid starting a second poller. Use a process supervisor with restart-on-failure and graceful SIGTERM.

## Health and logs

- Liveness/diagnostic endpoint: `GET /api/v1/health`.
- Logs are JSON-shaped events on stdout/stderr. Do not add raw provider payloads, secrets, user content or full Telegram update objects to logs.
- Monitor API uptime, DB connectivity/latency, job status, Telegram delivery failures, provider timestamps, and ingestion quality once those systems are connected.
- App `status: ok` is not proof that data exists or is fresh; inspect the independent database/provider fields.

## PostgreSQL backup/restore

Use encrypted storage, least-privilege backup credentials, and a retention policy that matches local privacy and market-data license terms. A basic manual dump/restore pattern:

```bash
# Backup (secure the output path and encryption/key policy)
pg_dump --format=custom --no-owner --file="nse-pulse-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"

# Restore into a newly provisioned recovery database after checking the target
createdb nse_pulse_restore_test
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" nse-pulse-backup.dump
```

Schedule regular backups, keep an off-host copy, restrict access, encrypt at rest/in transit, and perform a restore drill before relying on backups. Confirm stored market data can be retained under the applicable license. No automated backup service is bundled.

## Migrations and rollback

1. Back up first.
2. Review SQL in `drizzle/generated/` and check whether changes are additive.
3. Deploy code compatible with the current schema, then run `npm run db:migrate` once.
4. Verify `GET /api/v1/health`, application queries, and logs.
5. Do not manually drop/recreate tables as a rollback. Prefer a new corrective migration or restore to a separate recovery DB. Migration rollback is not automatically generated; data-destructive changes require a deliberate backup/restore plan.

## Restart and troubleshooting

- API not starting: confirm Node version, `PORT`, `HOST`, `DATABASE_URL` syntax and logs.
- Dashboard cannot reach API: ensure reverse proxy maps `/api` to port `4000`; `APP_ORIGIN` must match browser origin.
- `DATABASE_URL` missing: only degraded empty-state behavior is expected; configure Postgres and run migrations.
- DB unreachable: check network/firewall, TLS settings and role grants; do not put credentials in diagnostic logs.
- Provider `UNCONFIGURED`: expected until access agreement, supported adapter, endpoint documentation and secrets are provided.
- Quotes absent: importer/feed are not active; do not use synthetic or scraped values as a workaround.
- Bot inactive: configure token on exactly one polling process and check Telegram connectivity; the token is secret.
- Scheduler disabled: set `ENABLE_SCHEDULER=true` with DB available only if the provider-health heartbeat is wanted. It does not ingest data.
