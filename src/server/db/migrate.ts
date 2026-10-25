import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { getDatabase } from './client.js';
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL is required for migrations.');
  process.exit(1);
}
try {
  await migrate(getDatabase()!, { migrationsFolder: './drizzle/generated' });
  console.log('Database migrations applied successfully.');
  process.exit(0);
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
}
