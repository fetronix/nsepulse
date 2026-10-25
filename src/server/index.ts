import { createApp } from './api/app.js';
import { config } from './config.js';
import { startTelegramBot } from './telegram/bot.js';
import { startScheduler } from './jobs/runner.js';

const app = createApp();
const stopScheduler = startScheduler();
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(JSON.stringify({ level: 'info', event: 'server_started', host: config.HOST, port: config.PORT, env: config.NODE_ENV, databaseConfigured: Boolean(config.DATABASE_URL) }));
});
if (config.TELEGRAM_BOT_TOKEN) void startTelegramBot(config.TELEGRAM_BOT_TOKEN).catch(() => console.error(JSON.stringify({ level: 'error', event: 'telegram_start_failed' })));
const shutdown = (signal: string) => { console.log(JSON.stringify({ level: 'info', event: 'shutdown', signal })); stopScheduler(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
