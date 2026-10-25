import { moduleLogger } from '../logging/logger.js';
import { databaseHealth } from './client.js';

const log = moduleLogger('db.check');
const health = await databaseHealth();
log.info(
  { job: 'db_check', outcome: health.reachable ? 'success' : 'failure', database: health },
  'database_health_checked'
);
const output = process.stdout.isTTY ? `${JSON.stringify(health, null, 2)}\n` : `${JSON.stringify(health)}\n`;
process.stdout.write(output);
if (!health.reachable) process.exit(1);
