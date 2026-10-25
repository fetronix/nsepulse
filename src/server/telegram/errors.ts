/**
 * Telegram failure classification.
 *
 * `bot.start()` failures were logged as `{ errorClass }` only, which reduced four very
 * different problems — no token, a rejected token, a second poller, an unreachable API — to
 * the same opaque line. This maps them to a kind plus an operator hint.
 *
 * Telegram's HTTP error messages embed the full bot URL (`.../bot<token>/getMe`), so every
 * string that leaves this module is redacted first. The token is never logged.
 */

export type TelegramErrorKind =
  'UNAUTHORIZED' | 'CONFLICT' | 'BLOCKED' | 'NETWORK' | 'RATE_LIMIT' | 'MALFORMED_TOKEN' | 'UNKNOWN';

export interface TelegramErrorDescription {
  kind: TelegramErrorKind;
  /** Telegram `error_code` or Node system code, when available. */
  code: number | string | null;
  /** Redacted description safe for logs. */
  description: string;
  /** What the operator should do next. */
  hint: string;
}

const TOKEN_PATTERN = /bot\d+:[A-Za-z0-9_-]{10,}/g;

/** Remove any bot token, including the one embedded in Telegram request URLs. */
export function redactToken(value: string): string {
  return value.replace(TOKEN_PATTERN, 'bot<redacted>');
}

/**
 * Bot API tokens are `<numeric id>:<secret>` with a long secret part. A placeholder such as
 * `123456:your-token-here` would otherwise be sent to Telegram and produce a confusing 401.
 */
export function isTelegramTokenShape(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

export function describeTelegramError(error: unknown): TelegramErrorDescription {
  const candidate = error as {
    error_code?: unknown;
    code?: unknown;
    description?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code: number | string | null =
    typeof candidate?.error_code === 'number'
      ? candidate.error_code
      : typeof candidate?.code === 'string' || typeof candidate?.code === 'number'
        ? candidate.code
        : null;
  const raw =
    typeof candidate?.description === 'string'
      ? candidate.description
      : typeof candidate?.message === 'string'
        ? candidate.message
        : 'Telegram request failed.';
  const description = redactToken(raw).replace(/\s+/g, ' ').trim().slice(0, 300);

  if (code === 401 || /unauthorized|invalid token|token is invalid/i.test(description))
    return {
      kind: 'UNAUTHORIZED',
      code,
      description,
      hint: 'Telegram rejected TELEGRAM_BOT_TOKEN. Verify the token with BotFather and restart; the value itself is never logged.'
    };

  if (code === 409 || /\bterminated by other getUpdates\b|\bconflict\b/i.test(description))
    return {
      kind: 'CONFLICT',
      code,
      description,
      hint: 'Another process is polling this bot token. Stop the other instance, or let the advisory lock hand polling to a single instance.'
    };

  if (/bot was blocked by the user|forbidden|chat not found/i.test(description) || code === 403)
    return {
      kind: 'BLOCKED',
      code,
      description,
      hint: 'The bot cannot message that chat. The user must start the bot again, or the chat id is wrong.'
    };

  if (code === 429 || /\btoo many requests\b|\bflood\b/i.test(description))
    return {
      kind: 'RATE_LIMIT',
      code,
      description,
      hint: 'Telegram is rate limiting this bot. Reduce polling/report frequency; the bot retries on its own.'
    };

  if (
    typeof code === 'string' ||
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up/i.test(description)
  )
    return {
      kind: 'NETWORK',
      code,
      description,
      hint: 'api.telegram.org is unreachable from this host. The market-data service keeps running; polling can be restarted later.'
    };

  return {
    kind: 'UNKNOWN',
    code,
    description,
    hint: 'Telegram polling did not start for an unclassified reason. The HTTP API and market-data service are unaffected.'
  };
}
