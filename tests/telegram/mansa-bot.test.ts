import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimPollingSlot,
  createTelegramBot,
  isTelegramPollingStarted,
  resetTelegramPollingGuardForTests
} from '../../src/server/telegram/bot.js';
import type { MarketService } from '../../src/server/services/market.js';

const NOW = new Date('2026-10-25T10:00:00.000Z');

/** Minimal stand-in for MarketService; the bot must depend only on these four methods. */
function fakeMarket(overrides: Record<string, unknown> = {}) {
  return {
    overview: vi.fn(async () => ({
      sessionStatus: 'UNKNOWN',
      dataFreshness: { latestObservationAt: '2026-10-25T09:55:00.000Z', status: 'FRESH' },
      counts: { securities: 64, observations: 12 }
    })),
    quote: vi.fn(async (symbol: string) => ({
      security: { id: 'sec-1', symbol, name: 'Safaricom PLC' },
      observation: {
        symbol,
        price: 12.45,
        currency: 'KES',
        source: 'Mansa API (mansaapi.com)',
        marketEventAt: '2026-10-25T09:55:00.000Z',
        dataMode: 'DELAYED',
        changePercent: 1.22,
        volume: 1_500_000
      },
      reason: null,
      provenance: { kind: 'PROVIDER_QUOTE' },
      warnings: ['Provider snapshot — delayed market data, not real-time.']
    })),
    movers: vi.fn(async (type: 'gainers' | 'losers') => ({
      available: true,
      type,
      items: [
        {
          symbol: 'SCOM',
          price: 12.45,
          changePercent: 4.2,
          currency: 'KES',
          marketEventAt: '2026-10-25T09:55:00.000Z',
          dataMode: 'DELAYED'
        },
        { symbol: 'EQTY', price: null, changePercent: null, currency: 'KES', marketEventAt: null, dataMode: 'UNKNOWN' }
      ],
      reason: null,
      retrievedAt: NOW.toISOString(),
      warnings: []
    })),
    ...overrides
  } as unknown as MarketService;
}

function instrumentBot(market: MarketService) {
  const bot = createTelegramBot('123456:TEST_TOKEN', { market, now: () => NOW });
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'NSE Pulse', username: 'nse_pulse_bot' } as never;
  const sent: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') sent.push(String((payload as { text?: string }).text ?? ''));
    return {
      ok: true,
      result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, text: '' }
    } as never;
  });
  return { bot, sent };
}

function update(text: string, updateId = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 1, type: 'private' as const, first_name: 'Test' },
      from: { id: 1, is_bot: false, first_name: 'Test' },
      text,
      entities: [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' as const }]
    }
  };
}

describe('Telegram quotes backed by the Mansa adapter', () => {
  it('shows ticker, price, currency, change, source, timestamp and freshness', async () => {
    const { bot, sent } = instrumentBot(fakeMarket());
    await bot.handleUpdate(update('/quote scom'));
    const message = sent[0]!;
    expect(message).toContain('SCOM: KES 12.45 (+1.22%)');
    expect(message).toContain('Source: Mansa API (mansaapi.com)');
    expect(message).toContain('Provider timestamp: 2026-10-25T09:55:00.000Z');
    expect(message).toContain('Freshness: delayed (not real-time) · 5 min old');
    expect(message).toContain('Volume: 1,500,000');
    expect(message).toContain('not investment advice');
  });

  it('never describes delayed provider data as live or real-time', async () => {
    const { bot, sent } = instrumentBot(fakeMarket());
    await bot.handleUpdate(update('/quote SCOM'));
    const message = sent[0]!.toLowerCase();
    expect(message).not.toMatch(/\blive price|real-time price|current live\b/);
    expect(message).toContain('not real-time');
  });

  it('reports unavailability instead of producing a quote', async () => {
    const market = fakeMarket({
      quote: vi.fn(async () => ({
        security: null,
        observation: null,
        reason: 'No verified quote is available: the configured provider did not supply one (RATE_LIMIT).',
        provenance: null,
        warnings: []
      }))
    });
    const { bot, sent } = instrumentBot(market);
    await bot.handleUpdate(update('/quote SCOM'));
    expect(sent[0]).toContain('SCOM is not in the configured security master.');
    expect(sent[0]).toContain('No verified quote is available');
    expect(sent[0]).not.toMatch(/KES \d/);
  });

  it('reports a known symbol with no quote as unavailable rather than blank', async () => {
    const market = fakeMarket({
      quote: vi.fn(async (symbol: string) => ({
        security: { id: 'sec-1', symbol, name: 'Safaricom PLC' },
        observation: null,
        reason: 'No verified quote is available: the provider returned no quote for this symbol.',
        provenance: null,
        warnings: []
      }))
    });
    const { bot, sent } = instrumentBot(market);
    await bot.handleUpdate(update('/quote SCOM'));
    expect(sent[0]).toContain('SCOM: no verified quote is available.');
    expect(sent[0]).not.toMatch(/KES \d/);
  });

  it('labels demo fixtures unmistakably', async () => {
    const market = fakeMarket({
      quote: vi.fn(async (symbol: string) => ({
        security: { id: `demo:${symbol}`, symbol, name: 'Demo' },
        observation: {
          symbol,
          price: 1.23,
          currency: 'KES',
          source: 'DEMO FIXTURE',
          marketEventAt: null,
          dataMode: 'UNKNOWN',
          changePercent: null
        },
        reason: null,
        provenance: { kind: 'DEMO_FIXTURE' },
        warnings: ['Demo fixture data — synthetic values, not NSE market data.']
      }))
    });
    const { bot, sent } = instrumentBot(market);
    await bot.handleUpdate(update('/quote SCOM'));
    expect(sent[0]).toContain('DEMO MODE — synthetic fixture, not market data.');
    expect(sent[0]).toContain('Freshness: unknown');
  });
});

describe('Telegram gainers and losers', () => {
  it('lists gainers with change and age', async () => {
    const { bot, sent } = instrumentBot(fakeMarket());
    await bot.handleUpdate(update('/gainers'));
    expect(sent[0]).toContain('Top gainers · NSE');
    expect(sent[0]).toContain('SCOM');
    expect(sent[0]).toContain('KES 12.45');
    expect(sent[0]).toContain('+4.20%');
    expect(sent[0]).toContain('(5 min old)');
    expect(sent[0]).toContain('Delayed provider snapshot, not real-time.');
  });

  it('shows an explicit gap rather than inventing a price when the provider omits one', async () => {
    const { bot, sent } = instrumentBot(fakeMarket());
    await bot.handleUpdate(update('/losers'));
    expect(sent[0]).toContain('Top losers · NSE');
    expect(sent[0]).toContain('EQTY');
    expect(sent[0]).toContain('price unavailable');
  });

  it('reports unavailable movers with the provider reason', async () => {
    const market = fakeMarket({
      movers: vi.fn(async (type: 'gainers' | 'losers') => ({
        available: false,
        type,
        items: [],
        reason: 'No verified movers are available: RATE_LIMIT (HTTP 429).',
        retrievedAt: null,
        warnings: []
      }))
    });
    const { bot, sent } = instrumentBot(market);
    await bot.handleUpdate(update('/gainers'));
    expect(sent[0]).toContain('Gainers are unavailable.');
    expect(sent[0]).toContain('RATE_LIMIT');
  });

  it('does not present an empty list as a quiet market', async () => {
    const market = fakeMarket({
      movers: vi.fn(async (type: 'gainers' | 'losers') => ({
        available: true,
        type,
        items: [],
        reason: 'The provider returned no movers for this exchange.',
        retrievedAt: NOW.toISOString(),
        warnings: []
      }))
    });
    const { bot, sent } = instrumentBot(market);
    await bot.handleUpdate(update('/gainers'));
    expect(sent[0]).toContain('Gainers are unavailable.');
    expect(sent[0]).toContain('The provider returned no movers');
  });
});

describe('Telegram resilience', () => {
  it('contains a handler failure instead of crashing the process', async () => {
    const market = fakeMarket({
      quote: vi.fn(async () => {
        throw new Error('telegram or provider exploded');
      })
    });
    const { bot, sent } = instrumentBot(market);
    // The guard must contain the failure: no rejection, and an honest reply.
    await expect(bot.handleUpdate(update('/quote SCOM'))).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('could not be completed just now');
    expect(sent[0]).toContain('No price or data was produced');
  });

  it('reports status without exposing the API key value', async () => {
    const bot = createTelegramBot('123456:TEST_TOKEN', {
      market: fakeMarket(),
      providers: {
        statuses: async () => [
          {
            provider: 'mansa',
            configured: true,
            state: 'DEGRADED',
            message:
              'Credentials are present but no authenticated Mansa response has been verified in this process yet.',
            lastSuccessAt: null,
            dataMode: 'UNKNOWN'
          }
        ],
        primary: {},
        all: []
      } as never,
      now: () => NOW
    });
    bot.botInfo = { id: 1, is_bot: true, first_name: 'x', username: 'x' } as never;
    const sent: string[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') sent.push(String((payload as { text?: string }).text ?? ''));
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, text: '' } } as never;
    });
    await bot.handleUpdate(update('/status'));
    expect(sent[0]).toContain('mansa: DEGRADED');
    expect(sent[0]).not.toMatch(/mansa_live_sk/);
  });

  it('handles a Telegram API failure on reply without breaking other updates', async () => {
    const { bot } = instrumentBot(fakeMarket());
    let first = true;
    const sent: string[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage' && first) {
        first = false;
        throw new Error('ETIMEDOUT telegram');
      }
      if (method === 'sendMessage') sent.push(String((payload as { text?: string }).text ?? ''));
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, text: '' } } as never;
    });
    await bot.handleUpdate(update('/quote SCOM'));
    await bot.handleUpdate(update('/quote EQTY', 2));
    // First command: the reply failed, so the operator sees the fallback. The second
    // command still works, proving one transport error does not wedge the bot.
    expect(sent[0]).toContain('could not be completed just now');
    expect(sent[1]).toContain('EQTY');
  });
});

describe('Single polling loop', () => {
  beforeEach(() => resetTelegramPollingGuardForTests());

  it('claims the polling slot once and refuses a second claim', () => {
    expect(isTelegramPollingStarted()).toBe(false);
    expect(claimPollingSlot()).toBe(true);
    expect(claimPollingSlot()).toBe(false);
    expect(isTelegramPollingStarted()).toBe(true);
    resetTelegramPollingGuardForTests();
    expect(claimPollingSlot()).toBe(true);
  });
});
