import { MansaError } from './errors.js';

/**
 * Minimal HTTPS client for the Mansa API.
 *
 * Documented behaviour this implements (https://mansaapi.com/docs):
 *  - Bearer-token authentication: `Authorization: Bearer mansa_live_sk_...`
 *  - `401` with `error.code` MISSING_API_KEY / INVALID_API_KEY
 *  - `429` when the daily limit is exceeded
 *  - a free tier of 100 requests per day
 *
 * Deliberate constraints:
 *  - Plain HTTP is refused, so a bearer token can never be sent in the clear.
 *  - The daily budget is enforced locally so a scheduled job cannot burn the whole
 *    quota by accident; exceeding it raises QUOTA instead of making the request.
 *  - Retries are bounded and honour `Retry-After`; a long `Retry-After` is surfaced to the
 *    caller rather than slept through, so a request never hangs for minutes.
 *  - Nothing here logs or throws the API key.
 */

export interface MansaUsage {
  dayKey: string;
  requestsUsed: number;
  dailyRequestBudget: number;
}

export interface MansaClientOptions {
  baseUrl: string;
  /** Secret. Never logged, never included in thrown messages. */
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  dailyRequestBudget?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Refuse to auto-wait longer than this for a Retry-After hint. */
  maxRetryDelayMs?: number;
}

export interface MansaEnvelope {
  data: unknown;
  meta: Record<string, unknown> | null;
  status: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

function dayKeyFor(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Parse `Retry-After` as either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - now);
  return null;
}

export class MansaClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly dailyRequestBudget: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetryDelayMs: number;
  private budgetDay: string;
  private requestsUsed = 0;

  constructor(options: MansaClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new MansaError('CONFIGURATION', 'MANSA_API_BASE_URL is not a valid absolute URL.');
    }
    if (parsed.protocol !== 'https:')
      throw new MansaError(
        'CONFIGURATION',
        'MANSA_API_BASE_URL must use HTTPS. A bearer token is never sent over plain HTTP.'
      );
    this.baseUrl = parsed;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.dailyRequestBudget = options.dailyRequestBudget ?? 100;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.budgetDay = dayKeyFor(this.now());
  }

  get configured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  usage(): MansaUsage {
    this.rollBudgetDay();
    return { dayKey: this.budgetDay, requestsUsed: this.requestsUsed, dailyRequestBudget: this.dailyRequestBudget };
  }

  private rollBudgetDay(): void {
    const today = dayKeyFor(this.now());
    if (today !== this.budgetDay) {
      this.budgetDay = today;
      this.requestsUsed = 0;
    }
  }

  private spendBudget(): void {
    this.rollBudgetDay();
    if (this.requestsUsed >= this.dailyRequestBudget)
      throw new MansaError(
        'QUOTA',
        `Local daily request budget of ${this.dailyRequestBudget} is exhausted; no request was sent. Raise MANSA_DAILY_REQUEST_BUDGET only within your Mansa plan limits.`
      );
    this.requestsUsed += 1;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): URL {
    const base = this.baseUrl.toString().replace(/\/+$/, '');
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    if (url.origin !== this.baseUrl.origin)
      throw new MansaError('CONFIGURATION', 'Resolved Mansa URL escaped the configured origin.');
    // Credentials travel in the Authorization header only, never in the query string.
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  /**
   * Perform one GET against the Mansa API and return the validated envelope.
   * Throws a classified MansaError on every failure path.
   */
  async get(path: string, query?: Record<string, string | number | undefined>): Promise<MansaEnvelope> {
    if (!this.configured) throw new MansaError('CONFIGURATION', 'MANSA_API_KEY is not configured.');
    const url = this.buildUrl(path, query);

    let lastError: MansaError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      this.spendBudget();
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
          signal: controller.signal
        });
      } catch (error) {
        lastError =
          controller.signal.aborted || (error as { name?: string })?.name === 'AbortError'
            ? new MansaError('TIMEOUT', `The Mansa request exceeded ${this.timeoutMs} ms and was aborted.`)
            : new MansaError('NETWORK', 'The Mansa request failed before a response was received.');
        if (!lastError.retryable || attempt === this.maxRetries) throw lastError;
        await this.sleep(this.backoffMs(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401)
        throw new MansaError(
          'AUTH',
          'Mansa rejected the API key (401). Check MANSA_API_KEY; the value is never logged.',
          {
            status: 401
          }
        );
      if (response.status === 403)
        throw new MansaError(
          'UNSUPPORTED_PLAN',
          'Mansa refused the request for this plan tier (403). Endpoint availability depends on the subscription.',
          { status: 403 }
        );
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.now());
        lastError = new MansaError(
          'RATE_LIMIT',
          'Mansa reported the daily rate limit (429). Free tier is 100 requests per day.',
          { status: 429, retryAfterMs: retryAfterMs ?? undefined }
        );
        if (attempt === this.maxRetries) throw lastError;
        if (retryAfterMs !== null && retryAfterMs > this.maxRetryDelayMs)
          throw new MansaError(
            'RATE_LIMIT',
            `Mansa asked to retry after ${Math.round(retryAfterMs / 1000)} s, which is longer than this client will wait.`,
            { status: 429, retryAfterMs }
          );
        await this.sleep(retryAfterMs ?? this.backoffMs(attempt));
        continue;
      }
      if (response.status >= 500) {
        lastError = new MansaError('HTTP', `Mansa returned a server error (HTTP ${response.status}).`, {
          status: response.status
        });
        if (attempt === this.maxRetries) throw lastError;
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (!response.ok)
        throw new MansaError('HTTP', `Mansa returned an unexpected status (HTTP ${response.status}).`, {
          status: response.status
        });

      return this.parseEnvelope(response);
    }

    throw lastError ?? new MansaError('HTTP', 'The Mansa request failed without a specific error.');
  }

  /**
   * Public `/health` probe (documented as no-auth). It deliberately does not spend the
   * authenticated daily budget: Mansa documents it as a public status surface.
   */
  async fetchPublicHealth(): Promise<{ ok: boolean; status: number }> {
    const url = this.buildUrl('/health');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      throw controller.signal.aborted || (error as { name?: string })?.name === 'AbortError'
        ? new MansaError('TIMEOUT', `The Mansa health probe exceeded ${this.timeoutMs} ms and was aborted.`)
        : new MansaError('NETWORK', 'The Mansa health probe failed before a response was received.');
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(250 * 2 ** attempt, 2_000);
  }

  private async parseEnvelope(response: Response): Promise<MansaEnvelope> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MansaError('MALFORMED', 'Mansa returned a body that is not valid JSON.', { status: response.status });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new MansaError('MALFORMED', 'Mansa returned an unexpected top-level payload.', { status: response.status });
    const record = payload as Record<string, unknown>;
    if (record.success === false) {
      const error = record.error as { code?: unknown; message?: unknown } | undefined;
      const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN_ERROR';
      const message = typeof error?.message === 'string' ? error.message.slice(0, 200) : 'No message supplied.';
      throw new MansaError('MALFORMED', `Mansa reported success:false (${code}): ${message}`, {
        status: response.status
      });
    }
    if (!('data' in record))
      throw new MansaError('MALFORMED', 'Mansa response is missing the documented data envelope.', {
        status: response.status
      });
    const meta =
      record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)
        ? (record.meta as Record<string, unknown>)
        : null;
    return { data: record.data, meta, status: response.status };
  }
}
