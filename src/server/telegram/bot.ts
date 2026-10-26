import { Bot } from 'grammy';
import { moduleLogger } from '../logging/logger.js';
import { defaultProviderSelection } from '../providers/factory.js';
import type { ProviderRegistry } from '../providers/types.js';
import { MarketService } from '../services/market.js';

const log = moduleLogger('telegram');

/**
 * One provider registry and one MarketService per process.
 *
 * Every command reads through this service, so N Telegram users share a single cached
 * upstream request path instead of each triggering its own provider call (the Mansa free
 * tier allows 100 requests/day).
 */
const defaultSelection = defaultProviderSelection();
const defaultMarket = new MarketService(defaultSelection.registry);

export interface TelegramBotDeps {
  /** Injected in tests; defaults to the process-wide service. */
  market?: MarketService;
  providers?: ProviderRegistry;
  /** Injectable clock so freshness text is deterministic in tests. */
  now?: () => Date;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatChange(changePercent: number | null | undefined): string | null {
  if (changePercent === null || changePercent === undefined || !Number.isFinite(changePercent)) return null;
  const sign = changePercent > 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
}

function formatAge(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const observed = new Date(iso).getTime();
  if (!Number.isFinite(observed)) return null;
  const minutes = Math.round((now.getTime() - observed) / 60_000);
  if (minutes < 0) return 'timestamp is in the future';
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h old`;
  return `${Math.round(hours / 24)} d old`;
}

function freshnessLine(dataMode: string, marketEventAt: string | null, now: Date): string {
  const age = formatAge(marketEventAt, now);
  const mode = dataMode === 'DELAYED' ? 'delayed (not real-time)' : dataMode.toLowerCase();
  return age ? `Freshness: ${mode} · ${age}` : `Freshness: ${mode}`;
}

const NO_ADVICE = 'Research information only; not investment advice.';

const FALLBACK_REPLY =
  'That command could not be completed just now. No price or data was produced. Please try again shortly.';

type CommandContext = {
  reply: (text: string) => Promise<unknown>;
  match?: string;
};

export function createTelegramBot(token: string, deps: TelegramBotDeps = {}) {
  const market = deps.market ?? defaultMarket;
  const providers = deps.providers ?? defaultSelection.registry;
  const now = deps.now ?? (() => new Date());
  const bot = new Bot(token);
  const log = moduleLogger('telegram');

  /**
   * Wrap every command so one failing handler — a provider timeout, a Telegram API error, a
   * bug — is logged and answered with an honest "nothing was produced" reply instead of
   * escaping as an unhandled rejection or taking the shared process down with it.
   */
  const guard =
    (command: string, handler: (ctx: CommandContext) => Promise<unknown>) =>
    async (ctx: CommandContext): Promise<void> => {
      try {
        await handler(ctx);
      } catch (error) {
        log.error(
          {
            handler: command,
            errorClass: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message.slice(0, 160) : 'unknown'
          },
          'telegram_command_failed'
        );
        try {
          await ctx.reply(FALLBACK_REPLY);
        } catch {
          // The transport is what failed; there is nothing left to do but let it go.
          log.warn({ handler: command }, 'telegram_fallback_reply_failed');
        }
      }
    };

  bot.command(
    'start',
    guard('start', async (ctx) =>
      ctx.reply(
        'Welcome to NSE Pulse. I provide sourced market research, not personalized investment advice. Market data is only shown when an authorized provider is configured. Use /help to see commands.'
      )
    )
  );

  bot.command(
    'help',
    guard('help', async (ctx) =>
      ctx.reply(
        [
          '/market — market overview and data freshness',
          '/quote SYMBOL — latest available quote',
          '/gainers — top gainers on NSE',
          '/losers — top losers on NSE',
          '/status — data and service status',
          '',
          'Quotes are only shown when a provider returns them, and are labelled with their timestamp and freshness.',
          'No quote will be invented when market data is unavailable.'
        ].join('\n')
      )
    )
  );

  bot.command(
    'market',
    guard('market', async (ctx) => {
      const data = await market.overview();
      const statuses = await providers.statuses();
      const providerLine = statuses.map((status) => `Provider: ${status.provider} (${status.state})`).join('\n');
      await ctx.reply(
        [
          'NSE Pulse · KES · Africa/Nairobi',
          `Session: ${data.sessionStatus}`,
          `Market data: ${data.dataFreshness.status}`,
          `Configured securities: ${data.counts.securities ?? 'database not configured'}`,
          providerLine,
          'No verified indices or quotes are currently available.',
          NO_ADVICE
        ].join('\n')
      );
    })
  );

  bot.command(
    'quote',
    guard('quote', async (ctx) => {
      const symbol = (ctx.match ?? '').trim().split(/\s+/)[0]?.toUpperCase();
      if (!symbol || !/^[A-Z0-9.-]{1,24}$/.test(symbol))
        return ctx.reply('Usage: /quote SYMBOL (for example, /quote SCOM).');
      const result = await market.quote(symbol);
      if (!result.observation) {
        const head = result.security
          ? `${symbol}: no verified quote is available.`
          : `${symbol} is not in the configured security master. No quote was produced.`;
        return ctx.reply([head, result.reason ?? '', NO_ADVICE].filter(Boolean).join('\n'));
      }
      const q = result.observation as {
        price: number;
        currency: string;
        source: string;
        marketEventAt: string | null;
        dataMode: string;
        changePercent?: number | null;
        volume?: number | null;
      };
      const change = formatChange(q.changePercent);
      const timestamp = now();
      const demoPrefix =
        result.provenance?.kind === 'DEMO_FIXTURE' ? 'DEMO MODE — synthetic fixture, not market data.\n' : '';
      const lines = [
        `${demoPrefix}${symbol}: ${q.currency} ${formatPrice(q.price)}${change ? ` (${change})` : ''}`,
        `Mode: ${q.dataMode}`,
        `Source: ${q.source}`,
        `Provider timestamp: ${q.marketEventAt ?? 'not supplied'}`
      ];
      lines.push(freshnessLine(q.dataMode, q.marketEventAt, timestamp));
      if (q.volume !== null && q.volume !== undefined) lines.push(`Volume: ${q.volume.toLocaleString('en-KE')}`);
      for (const warning of result.warnings.slice(0, 2)) lines.push(`Note: ${warning}`);
      lines.push(NO_ADVICE);
      return ctx.reply(lines.join('\n'));
    })
  );

  const moversCommand = (type: 'gainers' | 'losers') =>
    guard(type, async (ctx: CommandContext) => {
      const result = await market.movers(type, 5);
      if (!result.available || !result.items.length) {
        return ctx.reply(
          [
            type === 'gainers' ? 'Gainers are unavailable.' : 'Losers are unavailable.',
            result.reason ?? 'No verified mover data is available.',
            NO_ADVICE
          ].join('\n')
        );
      }
      const timestamp = now();
      const rows = result.items.map((item) => {
        const parts = [item.symbol.padEnd(12)];
        parts.push(item.price === null ? 'price unavailable' : `${item.currency} ${formatPrice(item.price)}`);
        const change = formatChange(item.changePercent);
        if (change) parts.push(change);
        const age = formatAge(item.marketEventAt, timestamp);
        if (age) parts.push(`(${age})`);
        return parts.join('  ');
      });
      return ctx.reply(
        [
          `${type === 'gainers' ? 'Top gainers' : 'Top losers'} · NSE`,
          ...rows,
          'Delayed provider snapshot, not real-time.',
          NO_ADVICE
        ].join('\n')
      );
    });

  bot.command('gainers', moversCommand('gainers'));
  bot.command('losers', moversCommand('losers'));

  bot.command('status', async (ctx) => {
    const statuses = await providers.statuses();
    await ctx.reply([...statuses.map((s) => `${s.provider}: ${s.state}\n${s.message}`), NO_ADVICE].join('\n\n'));
  });

  bot.catch((error) => {
    // Only the error class is logged: Telegram update payloads may contain user content.
    // A handler failure is contained here so a Telegram API error cannot take down the
    // market-data service or the HTTP server sharing this process.
    const cause = (error as { error?: unknown }).error;
    log.error(
      {
        handler: 'bot.catch',
        errorClass: cause instanceof Error ? cause.name : typeof cause,
        errorMessage: cause instanceof Error ? cause.message.slice(0, 160) : 'unknown telegram error'
      },
      'telegram_update_failed'
    );
  });

  return bot;
}

let pollingStarted = false;

/**
 * Claim the single polling slot for this process. Returns false when something already
 * holds it, which is what stops two `getUpdates` loops answering the same command twice.
 */
export function claimPollingSlot(): boolean {
  if (pollingStarted) return false;
  pollingStarted = true;
  return true;
}

export function releasePollingSlot(): void {
  pollingStarted = false;
}

/** Test seam: reset the in-process polling guard between tests. */
export function resetTelegramPollingGuardForTests(): void {
  releasePollingSlot();
}

export function isTelegramPollingStarted(): boolean {
  return pollingStarted;
}

/**
 * Start long polling exactly once per process.
 *
 * A second call throws instead of opening a competing `getUpdates` loop, which is what
 * produces duplicated replies when a supervisor or an import both start the bot.
 * Cross-process duplication is prevented separately by a PostgreSQL advisory lock taken in
 * `src/server/index.ts` before this function is called.
 */
export async function startTelegramBot(token: string, deps: TelegramBotDeps = {}) {
  if (pollingStarted)
    throw new Error('Telegram polling is already running in this process; refusing to start a second loop.');
  pollingStarted = true;
  const bot = createTelegramBot(token, deps);
  try {
    await bot.start({
      onStart: (info) => log.info({ botUsername: info.username }, 'telegram_started')
    });
  } catch (error) {
    pollingStarted = false;
    throw error;
  }
  return bot;
}
