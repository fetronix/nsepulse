import type { MarketDataProvider } from './types.js';
import { ProviderRegistry, UnconfiguredProvider } from './types.js';
import { DemoFixtureProvider } from './demo.js';
import { VendorPendingProvider } from './vendor-pending.js';
import { MansaProvider } from './mansa/provider.js';
import {
  DEFAULT_PROVIDER_SETTINGS,
  mansaCredentialsFromEnv,
  providerSettingsFromEnv,
  type ProviderSettings
} from './settings.js';

export interface ProviderSelection {
  settings: ProviderSettings;
  requestedProvider: string;
  registry: ProviderRegistry;
  provider: MarketDataProvider;
  demoRequested: boolean;
  demoDataAllowed: boolean;
  demoBlockedReason: string | null;
  warnings: string[];
}

/**
 * Build the provider boundary from configuration.
 *
 * MARKET_DATA_PROVIDER defaults to `none`, which keeps the live quote adapter disabled.
 * `mansa` builds the real Mansa adapter, but only when MANSA_API_KEY is present; without a
 * key the disabled adapter is used and the reason is reported, so a missing secret degrades
 * safely instead of crashing unrelated functionality.
 * Demo fixtures additionally require ALLOW_DEMO_MARKET_DATA=true and a non-production
 * environment. No selection path invents an endpoint or enables an unimplemented adapter.
 */
export interface ProviderSelectionOverrides {
  /**
   * Credentials for the Mansa adapter. Defaults to the server environment; tests inject
   * values here so no real secret is ever required to exercise the selection logic.
   */
  mansaCredentials?: { baseUrl: string; apiKey: string };
}

export function createProviderSelection(
  settings: ProviderSettings = DEFAULT_PROVIDER_SETTINGS,
  overrides: ProviderSelectionOverrides = {}
): ProviderSelection {
  const requestedProvider = (settings.provider || 'none').trim().toLowerCase();
  const demoRequested = requestedProvider === 'demo';
  const productionBlocked = settings.nodeEnv === 'production';
  const demoDataAllowed = settings.allowDemoData && !productionBlocked;
  const warnings: string[] = [];
  let demoBlockedReason: string | null = null;

  let provider: MarketDataProvider;
  if (requestedProvider === 'none') {
    provider = new UnconfiguredProvider();
    if (settings.allowDemoData)
      warnings.push('ALLOW_DEMO_MARKET_DATA is set but MARKET_DATA_PROVIDER is none, so no adapter is enabled.');
  } else if (demoRequested) {
    if (productionBlocked) {
      demoBlockedReason = 'Demo market data cannot be enabled when NODE_ENV=production.';
      provider = new UnconfiguredProvider();
    } else if (!settings.allowDemoData) {
      demoBlockedReason = 'Demo market data requires the explicit opt-in ALLOW_DEMO_MARKET_DATA=true.';
      provider = new UnconfiguredProvider();
    } else {
      provider = new DemoFixtureProvider();
      warnings.push(
        'Demo fixture adapter is active. Every value is synthetic, is not NSE market data, and must not be presented as a real price.'
      );
    }
  } else if (requestedProvider === 'mansa') {
    const credentials = overrides.mansaCredentials ?? mansaCredentialsFromEnv();
    if (!credentials.apiKey.trim()) {
      provider = new UnconfiguredProvider();
      warnings.push(
        'MARKET_DATA_PROVIDER=mansa but MANSA_API_KEY is empty. The adapter is disabled and no request will be made.'
      );
    } else {
      try {
        provider = new MansaProvider({
          baseUrl: credentials.baseUrl,
          apiKey: credentials.apiKey,
          dailyRequestBudget: settings.mansaDailyRequestBudget,
          cacheTtlMs: settings.mansaCacheTtlMs
        });
        warnings.push(
          'Mansa adapter active. Data is a delayed snapshot per Mansa’s documented 30-minute freshness target; it is not real-time and a Mansa key is not an NSE redistribution licence.'
        );
      } catch (error) {
        provider = new UnconfiguredProvider();
        warnings.push(
          `Mansa adapter could not be constructed (${error instanceof Error ? error.message : 'unknown error'}). No provider is enabled.`
        );
      }
    }
  } else if (requestedProvider === 'nse-vendor') {
    provider = new VendorPendingProvider({
      baseUrlConfigured: settings.vendorBaseUrlConfigured,
      apiKeyConfigured: settings.vendorApiKeyConfigured
    });
    warnings.push(
      'MARKET_DATA_PROVIDER=nse-vendor, but no contracted adapter implementation exists. No outbound request will be made and no credential presence enables live data.'
    );
  } else {
    provider = new UnconfiguredProvider();
    warnings.push(
      `Unknown MARKET_DATA_PROVIDER value "${settings.provider}". Falling back to the disabled adapter; no provider is enabled.`
    );
  }

  if (demoRequested && demoBlockedReason) warnings.push(demoBlockedReason);

  return {
    settings,
    requestedProvider,
    registry: new ProviderRegistry([provider]),
    provider,
    demoRequested,
    demoDataAllowed,
    demoBlockedReason,
    warnings
  };
}

let cached: ProviderSelection | null = null;
export function defaultProviderSelection(): ProviderSelection {
  if (!cached) cached = createProviderSelection(providerSettingsFromEnv());
  return cached;
}
