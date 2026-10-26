// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/ui/App.js';
import { ProviderSetupPage } from '../../src/client/ui/ProviderSetupPage.js';
import {
  announcements,
  blockedTests,
  dataSources,
  demoConfiguration,
  health,
  overview,
  unconfiguredConfiguration
} from '../fixtures/provider.js';

type Route = (init?: RequestInit) => unknown;

let routes: Record<string, Route>;

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.replace('/api/v1', '');
      const handler = routes[`${init?.method ?? 'GET'} ${path}`] ?? routes[path];
      if (!handler) throw new Error(`Unhandled request: ${init?.method ?? 'GET'} ${path}`);
      const body = handler(init);
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

beforeEach(() => {
  routes = {};
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('market overview shell', () => {
  it('renders the unconfigured empty state without fabricating market values', async () => {
    routes['/market/overview'] = () => overview;
    routes['/health'] = () => health;
    render(<App />);

    expect(await screen.findByText(/Market feed not connected/)).toBeTruthy();
    expect(screen.getByText(/NSE prices and indices are intentionally blank/)).toBeTruthy();
    expect(screen.getByText('UNKNOWN')).toBeTruthy();
    expect(screen.getByText(/Activity data unavailable/)).toBeTruthy();
    expect(screen.queryByText(/DEMO MODE/)).toBeNull();
  });

  it('surfaces an error banner when the API cannot be reached', async () => {
    routes['/market/overview'] = () => new Error('network down');
    routes['/health'] = () => new Error('network down');
    render(<App />);
    expect(await screen.findByText(/The API could not be reached/)).toBeTruthy();
  });

  it('shows the server explanation when the API reports an unmigrated database', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const path = String(input).replace('/api/v1', '');
        if (path === '/market/overview')
          return {
            ok: false,
            status: 503,
            json: async () => ({
              error: 'The database schema is not initialised',
              hint: 'Run `npm run db:migrate` against this DATABASE_URL.'
            })
          } as unknown as Response;
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: 'The database schema is not initialised',
            hint: 'Run `npm run db:migrate` against this DATABASE_URL.'
          })
        } as unknown as Response;
      })
    );
    render(<App />);
    expect(await screen.findByText(/The database schema is not initialised/)).toBeTruthy();
    expect(screen.getByText(/npm run db:migrate/)).toBeTruthy();
  });

  it('shows demo labelling when the API reports demo mode', async () => {
    routes['/market/overview'] = () => overview;
    routes['/health'] = () => ({ ...health, demoMode: true });
    render(<App />);
    expect(await screen.findByText(/Demo mode active — no market feed connected/)).toBeTruthy();
    expect(screen.getByText(/Only synthetic development fixtures are available/)).toBeTruthy();
  });

  it('searches the security master and opens a quote', async () => {
    const user = userEvent.setup();
    routes['/market/overview'] = () => overview;
    routes['/health'] = () => health;
    routes['/securities?q=&limit=50'] = () => ({
      items: [
        {
          id: 'sec-1',
          symbol: 'SCOM',
          name: 'Safaricom PLC',
          exchange: 'NSE',
          instrumentType: 'EQUITY',
          listingStatus: 'LISTED',
          sector: 'Telecommunication'
        }
      ]
    });
    routes['/quotes/SCOM'] = () => ({
      security: { id: 'sec-1', symbol: 'SCOM', name: 'Safaricom PLC' },
      observation: {
        price: 12.5,
        dataMode: 'END_OF_DAY',
        source: 'reviewed-eod-import',
        marketEventAt: '2026-10-24T00:00:00.000Z',
        stale: true
      },
      provenance: { kind: 'STORED_OBSERVATION' }
    });

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Stocks explorer/ }));
    expect(await screen.findByText('Safaricom PLC')).toBeTruthy();
    await user.click(screen.getByText('Safaricom PLC'));
    expect(await screen.findByText(/KES 12.5/)).toBeTruthy();
    expect(screen.getByText(/Source: reviewed-eod-import/)).toBeTruthy();
  });

  it('reports a failed quote lookup without inventing a price', async () => {
    const user = userEvent.setup();
    routes['/market/overview'] = () => overview;
    routes['/health'] = () => health;
    routes['/securities?q=&limit=50'] = () => ({
      items: [
        {
          id: 'sec-2',
          symbol: 'EQTY',
          name: 'Equity Group',
          exchange: 'NSE',
          instrumentType: 'EQUITY',
          listingStatus: 'LISTED',
          sector: 'Banking'
        }
      ]
    });
    routes['/quotes/EQTY'] = () => new Error('boom');

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Stocks explorer/ }));
    await user.click(await screen.findByText('Equity Group'));
    expect(await screen.findByText('Quote API unavailable.')).toBeTruthy();
    expect(screen.getByText('Quote unavailable')).toBeTruthy();
  });

  it('renders the data-sources page with unconfigured provider status', async () => {
    const user = userEvent.setup();
    routes['/market/overview'] = () => overview;
    routes['/health'] = () => health;
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Data sources/ }));
    expect(await screen.findByText(/Market-data integration is not configured/)).toBeTruthy();
    expect(screen.getByText(/NSE Data Services/)).toBeTruthy();
    expect(screen.getByText(/What is required before live use\?/)).toBeTruthy();
  });
});

describe('provider setup page', () => {
  function primeRoutes(configuration = unconfiguredConfiguration()) {
    routes['/providers/configuration'] = () => configuration;
    routes['/data-sources'] = () => dataSources();
    routes['/announcements'] = () => announcements();
  }

  it('renders credential presence, coverage, access level, retrieval and licensing', async () => {
    primeRoutes();
    render(<ProviderSetupPage onOpenSources={() => undefined} />);

    expect(await screen.findByText(/Not configured — NSE authorised feed/)).toBeTruthy();
    expect(screen.getByText('NSE_VENDOR_API_BASE_URL')).toBeTruthy();
    expect(screen.getByText('NSE_VENDOR_API_KEY')).toBeTruthy();
    expect(screen.getAllByText('MISSING').length).toBe(2);
    expect(screen.getByText(/Not declared\. Coverage can only be stated/)).toBeTruthy();
    expect(screen.getByText('No market-data access granted')).toBeTruthy();
    expect(screen.getAllByText('Never recorded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('NOT RUN').length).toBe(2);
    expect(screen.getAllByText(/No outbound network request made/).length).toBe(2);
    expect(screen.getByText('Written market-data entitlement')).toBeTruthy();
    expect(screen.getByText(/Blocks live market data/)).toBeTruthy();
    expect(screen.getByText(/No announcements are being served/)).toBeTruthy();
  });

  it('runs the local tests and shows their blocked result', async () => {
    const user = userEvent.setup();
    primeRoutes();
    routes['POST /providers/test'] = () => ({
      ranAt: '2026-10-25T10:05:00.000Z',
      networkAccessAttempted: false,
      configuration: unconfiguredConfiguration({ tests: { ...blockedTests(), runNote: 'Local checks only.' } })
    });

    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    await screen.findByText(/Not configured — NSE authorised feed/);
    await user.click(screen.getByRole('button', { name: /Run connection/ }));
    expect(await screen.findByText(/Connection test not attempted/)).toBeTruthy();
    expect(screen.getByText('Just now')).toBeTruthy();
    expect(screen.getAllByText('BLOCKED').length).toBeGreaterThan(1);
  });

  it('shows the demo banner and fixture coverage in demo mode', async () => {
    primeRoutes(demoConfiguration());
    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    expect(await screen.findByText(/Synthetic fixture data is being served/)).toBeTruthy();
    expect(screen.getByText(/DEMO MODE/)).toBeTruthy();
    expect(screen.getByText('SCOM')).toBeTruthy();
    expect(screen.getByText(/Fixture values are deliberately unrealistic/)).toBeTruthy();
    expect(screen.getAllByText('Synthetic demo fixtures only').length).toBeGreaterThan(0);
  });

  it('explains why a requested demo mode is inactive', async () => {
    primeRoutes(
      unconfiguredConfiguration({
        environment: {
          nodeEnv: 'production',
          requestedProvider: 'demo',
          demoRequested: true,
          demoDataAllowed: false,
          demoBlockedReason: 'Demo market data cannot be enabled when NODE_ENV=production.',
          liveQuoteAdapterEnabled: false,
          enforcedDefaultProvider: 'none'
        }
      })
    );
    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    expect(await screen.findByText(/Demo mode was requested but is not active/)).toBeTruthy();
    expect(screen.getByText(/cannot be enabled when NODE_ENV=production/)).toBeTruthy();
  });

  it('lists stored announcements with their published freshness label', async () => {
    primeRoutes();
    routes['/announcements'] = () =>
      announcements({
        state: 'OK',
        reason: null,
        permission: { status: 'GRANTED', basis: 'Operator-confirmed permission.' },
        items: [
          {
            id: 'a1',
            symbol: null,
            title: 'Final dividend announcement',
            publisher: 'Example PLC',
            sourceUrl: 'https://example.invalid/announcement.pdf',
            publishedAt: '2026-10-20T09:00:00.000Z',
            sourceType: 'ISSUER_ANNOUNCEMENT',
            verified: true,
            freshness: 'AS_PUBLISHED'
          }
        ]
      });
    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    expect(await screen.findByText('Final dividend announcement')).toBeTruthy();
    expect(screen.getByText('Example PLC')).toBeTruthy();
    expect(screen.getByText(/Permission: GRANTED/)).toBeTruthy();
  });

  it('reports a configuration load failure', async () => {
    routes['/providers/configuration'] = () => new Error('down');
    routes['/data-sources'] = () => new Error('down');
    routes['/announcements'] = () => new Error('down');
    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    expect(await screen.findByText(/could not be loaded from the API/)).toBeTruthy();
  });

  it('reports a failed test run', async () => {
    const user = userEvent.setup();
    primeRoutes();
    routes['POST /providers/test'] = () => new Error('down');
    render(<ProviderSetupPage onOpenSources={() => undefined} />);
    await screen.findByText(/Not configured — NSE authorised feed/);
    await user.click(screen.getByRole('button', { name: /Run connection/ }));
    expect(await screen.findByText(/provider tests could not be completed/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Run connection/ })).toBeTruthy());
  });

  it('invites the operator to the sources page', async () => {
    const user = userEvent.setup();
    const onOpenSources = vi.fn();
    primeRoutes();
    render(<ProviderSetupPage onOpenSources={onOpenSources} />);
    await screen.findByText(/Not configured — NSE authorised feed/);
    await user.click(screen.getByRole('button', { name: /Source details/ }));
    expect(onOpenSources).toHaveBeenCalledOnce();
  });
});
