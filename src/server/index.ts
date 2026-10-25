import { createApp } from './api/app.js';
import { config } from './config.js';
import { closeDatabase, tryAcquireProcessLock } from './db/client.js';
import { startScheduler } from './jobs/runner.js';
import { logger } from './logging/logger.js';
import { classifyDatabaseError } from './db/errors.js';
import { startTelegramBot } from './telegram/bot.js';
import { describeTelegramError, isTelegramTokenShape, redactToken } from './telegram/errors.js';

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
  if (!config.TELEGRAM_BOT_TOKEN) {
    // Absence is a supported mode, not a failure: the HTTP API and market-data service run
    // without Telegram. Logged once so an operator can tell "off" from "broken".
    logger.info({ module: 'telegram', reason: 'TELEGRAM_BOT_TOKEN is not configured' }, 'telegram_disabled');
    return;
  }
  if (!isTelegramTokenShape(config.TELEGRAM_BOT_TOKEN)) {
    // A placeholder value must not become a network round-trip that fails with a bare 401.
    logger.warn(
      {
        module: 'telegram',
        reason: 'TELEGRAM_BOT_TOKEN does not look like a BotFather token (<id>:<secret>)'
      },
      'telegram_disabled'
    );
    return;
  }
  // Stage is tracked separately so a database problem during lock acquisition is never
  // reported as a Telegram failure (`errorClass: "error"` is the pg driver's error name).
  let stage: 'polling_lock' | 'polling_start' = 'polling_lock';
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
    stage = 'polling_start';
    bot = await startTelegramBot(config.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    // A database failure here means the advisory lock could not be taken, so polling is
    // skipped on purpose (starting it without the lock risks duplicate replies). Report the
    // storage cause, not a misattributed Telegram cause.
    const databaseError = classifyDatabaseError(error);
    if (stage === 'polling_lock' && databaseError.kind !== 'UNKNOWN') {
      logger.error(
        {
          module: 'telegram',
          stage,
          polledDisabledReason: 'polling lock could not be acquired',
          databaseError: {
            kind: databaseError.kind,
            code: databaseError.code,
            message: databaseError.message,
            object: databaseError.object
          },
          hint: databaseError.hint
        },
        'telegram_polling_not_started'
      );
      return;
    }
    // Classified, redacted, and non-fatal: a Telegram outage must never stop the market-data
    // service or the HTTP API from serving.
    const described = describeTelegramError(error);
    logger.error(
      {
        module: 'telegram',
        stage,
        errorClass: error instanceof Error ? redactToken(error.name) : 'UnknownError',
        kind: described.kind,
        code: described.code,
        description: described.description,
        hint: described.hint
      },
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
          { module: 'telegram', errorClass: error instanceof Error ? redactToken(error.name) : 'UnknownError' },
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
