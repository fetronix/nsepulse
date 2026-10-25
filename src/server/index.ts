import { createApp } from './api/app.js';
import { config } from './config.js';
import { closeDatabase, tryAcquireProcessLock } from './db/client.js';
import { startScheduler } from './jobs/runner.js';
import { logger } from './logging/logger.js';
import { startTelegramBot } from './telegram/bot.js';

const app = createApp();
const stopScheduler = startScheduler();
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(
    {
      module: 'server',
      host: config.HOST,
      port: config.PORT,
      databaseConfigured: Boolean(config.DATABASE_URL),
      schedulerEnabled: config.ENABLE_SCHEDULER === 'true' && Boolean(config.DATABASE_URL)
    },
    'server_started'
  );
});

let bot: Awaited<ReturnType<typeof startTelegramBot>> | null = null;
let releaseBotLock: (() => Promise<void>) | null = null;

/**
 * Telegram polling is started only by the process that owns the advisory lock.
 *
 * Without this, a second replica (or a restart that overlaps the previous process) opens a
 * competing `getUpdates` loop and every command is answered twice. When no database is
 * configured there is no shared lock to take, so the in-process guard in startTelegramBot is
 * the only protection and that limitation is logged.
 */
async function startTelegramOnce(): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  try {
    if (config.DATABASE_URL) {
      releaseBotLock = await tryAcquireProcessLock(731_502_611);
      if (!releaseBotLock) {
        logger.warn(
          { module: 'telegram', reason: 'another instance holds the polling lock' },
          'telegram_polling_skipped'
        );
        return;
      }
    } else {
      logger.warn(
        { module: 'telegram', reason: 'DATABASE_URL is not configured' },
        'telegram_polling_lock_unavailable'
      );
    }
    bot = await startTelegramBot(config.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    logger.error(
      { module: 'telegram', errorClass: error instanceof Error ? error.name : 'UnknownError' },
      'telegram_start_failed'
    );
    if (releaseBotLock) {
      await releaseBotLock().catch(() => undefined);
      releaseBotLock = null;
    }
  }
}
void startTelegramOnce();

let shuttingDown = false;

/**
 * Graceful shutdown: stop accepting requests, stop scheduled work, close the bot and
 * release database connections, then exit. A second signal exits immediately, and a
 * 10-second deadline prevents a hung connection from blocking a deploy.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logger.warn({ module: 'server', signal }, 'shutdown_already_in_progress');
    process.exit(1);
  }
  shuttingDown = true;
  logger.info({ module: 'server', signal }, 'shutdown_started');

  const deadline = setTimeout(() => {
    logger.error({ module: 'server', signal }, 'shutdown_timeout');
    process.exit(1);
  }, 10_000);
  deadline.unref();

  try {
    stopScheduler();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (bot) {
      try {
        await bot.stop();
      } catch (error) {
        logger.warn(
          { module: 'telegram', errorClass: error instanceof Error ? error.name : 'UnknownError' },
          'telegram_stop_failed'
        );
      }
    }
    if (releaseBotLock) {
      try {
        await releaseBotLock();
        releaseBotLock = null;
      } catch {
        logger.warn({ module: 'telegram' }, 'telegram_polling_lock_release_failed');
      }
    }
    await closeDatabase();
    logger.info({ module: 'server', signal }, 'shutdown_complete');
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) {
    logger.error(
      { module: 'server', signal, errorClass: error instanceof Error ? error.name : 'UnknownError' },
      'shutdown_failed'
    );
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
