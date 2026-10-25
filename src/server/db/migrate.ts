import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { moduleLogger } from '../logging/logger.js';
import { getDatabase } from './client.js';

const log = moduleLogger('db.migrate');

if (!config.DATABASE_URL) {
  log.error(
    { job: 'migrate', outcome: 'refused', reason: 'DATABASE_URL is missing' },
    'DATABASE_URL is required for migrations.'
  );
  process.exit(1);
}

try {
  const startedAt = Date.now();
  await migrate(getDatabase()!, { migrationsFolder: './drizzle/generated' });
  log.info(
    { job: 'migrate', outcome: 'success', durationMs: Date.now() - startedAt },
    'Database migrations applied successfully.'
  );
  process.exit(0);
} catch (error) {
  log.error(
    {
      job: 'migrate',
      outcome: 'failure',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'unknown error'
    },
    'Migration failed.'
  );
  process.exit(1);
}
