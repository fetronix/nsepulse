import { describe, expect, it } from 'vitest';
import { createTelegramBot } from '../../src/server/telegram/bot.js';

type Captured = string[];

function instrumentBot() {
  const bot = createTelegramBot('123456:TEST_TOKEN');
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'NSE Pulse', username: 'nse_pulse_bot' } as never;
  const sent: Captured = [];
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
      entities: [
        {
          offset: 0,
          length: text.split(' ')[0]!.length,
          type: 'bot_command' as const
        }
      ]
    }
  };
}

describe('Telegram command handling', () => {
  it('replies to /help and validates missing quote arguments', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/help'));
    await bot.handleUpdate(update('/quote', 2));
    expect(sent[0]).toContain('/market');
    expect(sent[1]).toContain('Usage: /quote SYMBOL');
  });

  it('welcomes the user without promising unavailable data', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/start'));
    expect(sent[0]).toContain('not personalized investment advice');
    expect(sent[0]).toContain('only shown when an authorized provider is configured');
  });

  it('reports an honest market overview', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/market'));
    expect(sent[0]).toContain('Session: UNKNOWN');
    expect(sent[0]).toContain('Market data: NO_DATA');
    expect(sent[0]).toContain('No verified indices or quotes are currently available.');
  });

  it('reports provider status without exposing credentials', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/status'));
    expect(sent[0]).toContain('nse-authorized-feed: UNCONFIGURED');
    expect(sent[0]).not.toMatch(/api[_-]?key/i);
  });

  it('never invents a quote for a symbol outside the security master', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/quote SCOM'));
    expect(sent[0]).toContain('SCOM is not in the configured security master');
    expect(sent[0]).toContain('No quote was produced');
  });

  it('rejects a malformed symbol argument', async () => {
    const { bot, sent } = instrumentBot();
    await bot.handleUpdate(update('/quote <script>'));
    expect(sent[0]).toContain('Usage: /quote SYMBOL');
  });
});
