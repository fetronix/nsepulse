/**
 * Database doctor.
 *
 * `SELECT 1` is not a health check: it succeeds against a database where no migration has ever
 * been applied. This command therefore verifies reachability *and* that the application schema
 * exists, prints an actionable hint, and exits non-zero when the database cannot serve the API.
 *
 * Exit codes: 0 = reachable and initialised; 1 = misconfigured or not initialised (fix the
 * configuration, then run the migrations); 2 = configured but unreachable (fix the server).
 */
import { moduleLogger } from '../logging/logger.js';
import { closeDatabase, databaseHealth } from './client.js';

const log = moduleLogger('db.check');
const health = await databaseHealth();

const outcome = !health.reachable ? 'unreachable' : health.schema.initialised ? 'success' : 'schema_missing';

log.info({ job: 'db_check', outcome, database: health }, 'database_health_checked');

const output = process.stdout.isTTY ? `${JSON.stringify(health, null, 2)}\n` : `${JSON.stringify(health)}\n`;
process.stdout.write(output);

if (!health.configured) {
  await closeDatabase();
  process.exit(1);
}

if (!health.reachable) {
  process.stderr.write(
    '\n✖ PostgreSQL is not reachable. Check that the server is running and that DATABASE_URL is correct.\n'
  );
  await closeDatabase();
  process.exit(2);
}

if (!health.schema.initialised) {
  process.stderr.write(
    `\n✖ PostgreSQL is reachable but not initialised: ${health.schema.message}\n` +
      '  Every data route will fail until migrations run.\n' +
      '  Fix: npm run db:migrate\n\n'
  );
  await closeDatabase();
  process.exit(1);
}

await closeDatabase();
