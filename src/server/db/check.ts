import { databaseHealth } from './client.js';
const health = await databaseHealth();
console.log(JSON.stringify(health, null, 2));
if (!health.reachable) process.exit(1);
