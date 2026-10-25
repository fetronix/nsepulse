import { describe, expect, it } from 'vitest';
import { createTelegramBot } from '../../src/server/telegram/bot.js';

describe('Telegram command handling', () => {
  it('replies to help and validates missing quote arguments', async () => {
    const bot = createTelegramBot('123456:TEST_TOKEN');
    bot.botInfo = { id: 123456, is_bot: true, first_name: 'NSE Pulse', username: 'nse_pulse_bot' } as never;
    const sent: string[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') sent.push(String((payload as { text?: string }).text ?? ''));
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, text: '' } } as never;
    });
    const base = { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' as const, first_name: 'Test' }, from: { id: 1, is_bot: false, first_name: 'Test' }, text: '/help', entities: [{ offset: 0, length: 5, type: 'bot_command' as const }] } };
    await bot.handleUpdate(base);
    await bot.handleUpdate({ ...base, update_id: 2, message: { ...base.message, text: '/quote', entities: [{ offset: 0, length: 6, type: 'bot_command' as const }] } });
    expect(sent[0]).toContain('/market');
    expect(sent[1]).toContain('Usage: /quote SYMBOL');
  });
});
