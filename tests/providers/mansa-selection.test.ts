import { describe, expect, it } from 'vitest';
import { createProviderSelection } from '../../src/server/providers/factory.js';
import { MansaProvider } from '../../src/server/providers/mansa/provider.js';
import { DEFAULT_PROVIDER_SETTINGS } from '../../src/server/providers/settings.js';
import { createApp } from '../../src/server/api/app.js';

const settings = (overrides: Partial<typeof DEFAULT_PROVIDER_SETTINGS> = {}) => ({
  ...DEFAULT_PROVIDER_SETTINGS,
  ...overrides
});

describe('provider selection — mansa', () => {
  it('builds the adapter only when a key is present', () => {
    const selection = createProviderSelection(settings({ provider: 'mansa' }), {
      mansaCredentials: { baseUrl: 'https://mansaapi.com', apiKey: 'mansa_live_sk_test' }
    });
    expect(selection.provider).toBeInstanceOf(MansaProvider);
    expect(selection.provider.live).toBe(true);
    expect(selection.provider.demo).toBe(false);
    expect(selection.warnings.join(' ')).toMatch(/delayed snapshot/i);
    expect(selection.warnings.join(' ')).toMatch(/not an NSE redistribution licence/);
  });

  it('falls back to the disabled adapter and explains why when the key is missing', () => {
    const selection = createProviderSelection(settings({ provider: 'mansa' }), {
      mansaCredentials: { baseUrl: 'https://mansaapi.com', apiKey: '   ' }
    });
    expect(selection.provider).not.toBeInstanceOf(MansaProvider);
    expect(selection.provider.id).toBe('nse-authorized-feed');
    expect(selection.warnings.join(' ')).toMatch(/MANSA_API_KEY is empty/);
  });

  it('refuses a non-HTTPS base URL instead of sending a token in the clear', async () => {
    const selection = createProviderSelection(settings({ provider: 'mansa' }), {
      mansaCredentials: { baseUrl: 'http://mansaapi.com', apiKey: 'mansa_live_sk_test' }
    });
    expect(selection.provider).not.toBeInstanceOf(MansaProvider);
    expect(selection.warnings.join(' ')).toMatch(/must use HTTPS/);
    const status = await selection.provider.status();
    expect(status.state).toBe('UNCONFIGURED');
  });

  it('keeps none as a valid, silent default', () => {
    const selection = createProviderSelection(settings());
    expect(selection.requestedProvider).toBe('none');
    expect(selection.provider.id).toBe('nse-authorized-feed');
    expect(selection.warnings).toEqual([]);
  });

  it('does not activate mansa when a different provider is requested', () => {
    const selection = createProviderSelection(settings({ provider: 'none', mansaApiKeyConfigured: true }), {
      mansaCredentials: { baseUrl: 'https://mansaapi.com', apiKey: 'mansa_live_sk_test' }
    });
    expect(selection.provider).not.toBeInstanceOf(MansaProvider);
  });
});

describe('missing Mansa key degrades safely', () => {
  it('leaves the rest of the API working', async () => {
    const selection = createProviderSelection(settings({ provider: 'mansa' }), {
      mansaCredentials: { baseUrl: 'https://mansaapi.com', apiKey: '' }
    });
    const app = createApp({ selection, quiet: true });

    const health = await request(app, '/api/v1/health/live');
    expect(health.status).toBe(200);

    const providers = await request(app, '/api/v1/providers');
    expect(providers.status).toBe(200);
    const items = providers.body.items as { state: string }[];
    expect(items[0]?.state).toBe('UNCONFIGURED');

    // The quote route must answer honestly rather than error or invent a price.
    const quote = await request(app, '/api/v1/quotes/SCOM');
    expect([200, 404]).toContain(quote.status);
    expect(JSON.stringify(quote.body)).not.toMatch(/"price":\s*\d/);
  });
});

async function request(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
