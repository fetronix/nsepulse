import { describe, expect, it } from 'vitest';
import { describeTelegramError, isTelegramTokenShape, redactToken } from '../../src/server/telegram/errors.js';

const TOKEN = '123456789:AAFakeTokenValueThatIsLongEnoughToMatchTheShape';

describe('redactToken', () => {
  it('removes a token from the URL Telegram puts in its error messages', () => {
    const message = `Call to 'https://api.telegram.org/bot${TOKEN}/getMe' failed!`;
    const redacted = redactToken(message);
    expect(redacted).not.toContain('AAFakeTokenValue');
    expect(redacted).toContain('bot<redacted>');
  });

  it('leaves messages without a token untouched', () => {
    expect(redactToken('plain message')).toBe('plain message');
  });
});

describe('isTelegramTokenShape', () => {
  it('accepts a BotFather-shaped token', () => {
    expect(isTelegramTokenShape(TOKEN)).toBe(true);
  });

  it('rejects empty, placeholder and truncated values without calling Telegram', () => {
    for (const value of ['', '   ', 'your-token-here', '123456:your-token-here', '123456:short', ':' + 'a'.repeat(40)])
      expect(isTelegramTokenShape(value)).toBe(false);
  });
});

describe('describeTelegramError', () => {
  it('maps a rejected token to UNAUTHORIZED and never echoes it', () => {
    const error = Object.assign(new Error('Unauthorized'), {
      name: 'GrammyError',
      error_code: 401,
      description: `Call to 'https://api.telegram.org/bot${TOKEN}/getMe' failed! Unauthorized`
    });
    const described = describeTelegramError(error);
    expect(described.kind).toBe('UNAUTHORIZED');
    expect(described.code).toBe(401);
    expect(described.hint).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(JSON.stringify(described)).not.toContain('AAFakeTokenValue');
  });

  it('maps a second poller to CONFLICT', () => {
    const described = describeTelegramError(
      Object.assign(new Error('Conflict'), {
        error_code: 409,
        description: 'Conflict: terminated by other getUpdates request'
      })
    );
    expect(described.kind).toBe('CONFLICT');
    expect(described.hint).toMatch(/another process/i);
  });

  it('maps a blocked bot to BLOCKED', () => {
    const described = describeTelegramError(
      Object.assign(new Error('Forbidden'), { error_code: 403, description: 'Forbidden: bot was blocked by the user' })
    );
    expect(described.kind).toBe('BLOCKED');
  });

  it('maps a flood limit to RATE_LIMIT', () => {
    const described = describeTelegramError(
      Object.assign(new Error('Too Many Requests'), {
        error_code: 429,
        description: 'Too Many Requests: retry after 5'
      })
    );
    expect(described.kind).toBe('RATE_LIMIT');
  });

  it('maps DNS and socket failures to NETWORK without claiming the bot is broken', () => {
    for (const error of [
      Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
      new Error('fetch failed'),
      new Error('socket hang up')
    ]) {
      const described = describeTelegramError(error);
      expect(described.kind).toBe('NETWORK');
      expect(described.hint).toMatch(/market-data service keeps running/i);
    }
  });

  it('falls back to UNKNOWN with a bounded, redacted description', () => {
    const described = describeTelegramError(new Error(`odd failure bot${TOKEN} ${'x'.repeat(500)}`));
    expect(described.kind).toBe('UNKNOWN');
    expect(described.description.length).toBeLessThanOrEqual(300);
    expect(described.description).not.toContain('AAFakeTokenValue');
  });

  it('handles a thrown non-error value', () => {
    const described = describeTelegramError('boom');
    expect(described.kind).toBe('UNKNOWN');
    expect(described.description).toBe('Telegram request failed.');
  });
});
