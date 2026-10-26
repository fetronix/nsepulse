import { describe, expect, it, vi } from 'vitest';
import { MansaClient, parseRetryAfter } from '../../src/server/providers/mansa/client.js';
import { MansaError } from '../../src/server/providers/mansa/errors.js';

const KEY = 'mansa_live_sk_test_do_not_log_me';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
}

function buildClient(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  const sleep = vi.fn(async () => undefined);
  const client = new MansaClient({
    baseUrl: 'https://mansaapi.com',
    apiKey: KEY,
    fetchImpl,
    sleep,
    maxRetries: 2,
    dailyRequestBudget: 5,
    ...overrides
  });
  return { client, sleep };
}

async function expectMansaError(promise: Promise<unknown>, kind: string): Promise<MansaError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (thrown: unknown) => thrown
  );
  expect(error).toBeInstanceOf(MansaError);
  expect((error as MansaError).kind).toBe(kind);
  // The secret must never reach a message or stack trace.
  expect(`${(error as Error).message}${(error as Error).stack ?? ''}`).not.toContain(KEY);
  return error as MansaError;
}

describe('MansaClient authentication and transport', () => {
  it('sends a Bearer token over HTTPS and returns the documented envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { exchanges: [] }, meta: { count: 0 } })
    ) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    const envelope = await client.get('/api/v1/markets/exchanges');
    expect(envelope.data).toEqual({ exchanges: [] });
    expect(envelope.meta).toEqual({ count: 0 });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!;
    expect(String(url)).toBe('https://mansaapi.com/api/v1/markets/exchanges');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    // The key travels in the header only.
    expect(String(url)).not.toContain('mansa_live_sk');
    expect(String(url)).not.toContain('api_key');
  });

  it('refuses a non-HTTPS base URL so a bearer token is never sent in the clear', () => {
    expect(() => new MansaClient({ baseUrl: 'http://mansaapi.com', apiKey: KEY })).toThrowError(/HTTPS/);
  });

  it('classifies a rejected key as AUTH without echoing it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: 'INVALID_API_KEY', message: 'bad key' } }, { status: 401 })
    ) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    const error = await expectMansaError(client.get('/api/v1/markets/exchanges'), 'AUTH');
    expect(error.status).toBe(401);
    expect(error.message).toContain('401');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses to spend quota when the local daily budget is exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl, { dailyRequestBudget: 2 });
    await client.get('/health');
    await client.get('/health');
    expect(client.usage()).toEqual({ dayKey: expect.any(String), requestsUsed: 2, dailyRequestBudget: 2 });
    await expectMansaError(client.get('/health'), 'QUOTA');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resets the daily counter when the UTC day rolls over', async () => {
    let clock = Date.parse('2026-10-25T23:59:00.000Z');
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl, { dailyRequestBudget: 1, now: () => clock });
    await client.get('/health');
    expect(client.usage().requestsUsed).toBe(1);
    clock += 2 * 60_000;
    expect(client.usage()).toMatchObject({ requestsUsed: 0, dayKey: '2026-10-26' });
    await client.get('/health');
    expect(client.usage().requestsUsed).toBe(1);
  });
});

describe('MansaClient rate limits and retries', () => {
  it('honours a small Retry-After before retrying a 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: false }, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { ok: true } })) as unknown as typeof fetch;
    const { client, sleep } = buildClient(fetchImpl);
    const envelope = await client.get('/api/v1/markets/exchanges');
    expect(envelope.data).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not wait out a Retry-After longer than the configured patience', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false }, { status: 429, headers: { 'retry-after': '120' } })
    ) as unknown as typeof fetch;
    const { client, sleep } = buildClient(fetchImpl);
    const error = await expectMansaError(client.get('/api/v1/markets/exchanges'), 'RATE_LIMIT');
    expect(error.retryAfterMs).toBe(120_000);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx a bounded number of times and then gives up', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false }, { status: 503 })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'HTTP');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it('recovers when a 5xx is followed by a good response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: false }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { recovered: true } })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expect(client.get('/api/v1/markets/exchanges')).resolves.toMatchObject({
      data: { recovered: true }
    });
  });
});

describe('MansaClient failure classification', () => {
  it('reports a timeout when the request is aborted', async () => {
    const fetchImpl = vi.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    ) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl, { timeoutMs: 5 });
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'TIMEOUT');
  });

  it('reports a network failure without a response', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'NETWORK');
  });

  it('rejects a body that is not JSON', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'MALFORMED');
  });

  it('rejects success:false even with HTTP 200 and surfaces the provider error code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: 'INVALID_API_KEY', message: 'nope' } })
    ) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    const error = await expectMansaError(client.get('/api/v1/markets/exchanges'), 'MALFORMED');
    expect(error.message).toContain('INVALID_API_KEY');
  });

  it('requires the documented data envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'MALFORMED');
  });

  it('maps a plan refusal to UNSUPPORTED_PLAN', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false }, { status: 403 })) as unknown as typeof fetch;
    const { client } = buildClient(fetchImpl);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'UNSUPPORTED_PLAN');
  });

  it('never attempts a request without a key', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new MansaClient({ baseUrl: 'https://mansaapi.com', apiKey: '   ', fetchImpl });
    expect(client.configured).toBe(false);
    await expectMansaError(client.get('/api/v1/markets/exchanges'), 'CONFIGURATION');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sun, 25 Oct 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
  });
});
