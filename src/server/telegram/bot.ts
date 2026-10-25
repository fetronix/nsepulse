import { Bot } from 'grammy';
import { moduleLogger } from '../logging/logger.js';
import { defaultProviderSelection } from '../providers/factory.js';
import { MarketService } from '../services/market.js';

const log = moduleLogger('telegram');

const selection = defaultProviderSelection();
const providers = selection.registry;
const market = new MarketService(providers);
export function createTelegramBot(token: string) {
  const bot = new Bot(token);
  bot.command('start', async (ctx) =>
    ctx.reply(
      'Welcome to NSE Pulse. I provide sourced market research, not personalized investment advice. Market data is only shown when an authorized provider is configured. Use /help to see commands.'
    )
  );
  bot.command('help', async (ctx) =>
    ctx.reply(
      '/market — market overview and data freshness\n/quote SYMBOL — latest available stored quote\n/status — data and service status\n\nNo quote will be invented when market data is unavailable.'
    )
  );
  bot.command('market', async (ctx) => {
    const data = await market.overview();
    ctx.reply(
      `NSE Pulse · KES · Africa/Nairobi\nSession: ${data.sessionStatus}\nMarket data: ${data.dataFreshness.status}\nConfigured securities: ${data.counts.securities ?? 'database not configured'}\nNo verified indices or quotes are currently available.`
    );
  });
  bot.command('quote', async (ctx) => {
    const symbol = ctx.match.trim().split(/\s+/)[0]?.toUpperCase();
    if (!symbol || !/^[A-Z0-9.-]{1,24}$/.test(symbol))
      return ctx.reply('Usage: /quote SYMBOL (for example, /quote SCOM).');
    const result = await market.quote(symbol);
    if (!result.security)
      return ctx.reply(`${symbol} is not in the configured security master. No quote was produced.`);
    if (!result.observation) return ctx.reply(`${symbol}: no verified quote is available. ${result.reason ?? ''}`);
    const q = result.observation as {
      price: number;
      currency: string;
      source: string;
      marketEventAt: string | null;
      dataMode: string;
    };
    const demoPrefix =
      result.provenance?.kind === 'DEMO_FIXTURE' ? 'DEMO MODE — synthetic fixture, not market data.\n' : '';
    return ctx.reply(
      `${demoPrefix}${symbol}: ${q.currency} ${q.price}\nMode: ${q.dataMode}\nSource: ${q.source}\nMarket timestamp: ${q.marketEventAt ?? 'not supplied'}`
    );
  });
  bot.command('status', async (ctx) => {
    const statuses = await providers.statuses();
    ctx.reply(statuses.map((s) => `${s.provider}: ${s.state}\n${s.message}`).join('\n\n'));
  });
  bot.catch((error) => {
    // Only the error class is logged: Telegram update payloads may contain user content.
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
export async function startTelegramBot(token: string) {
  const bot = createTelegramBot(token);
  await bot.start({
    onStart: (info) => log.info({ botUsername: info.username }, 'telegram_started')
  });
  return bot;
}
