import { config } from '../config.js';

/**
 * Non-secret provider settings.
 *
 * Only booleans describing whether a credential is present ever leave this module.
 * Secret values are never copied into settings, logs or API responses.
 */
export interface ProviderSettings {
  provider: string;
  nodeEnv: 'development' | 'test' | 'production';
  allowDemoData: boolean;
  vendorBaseUrlConfigured: boolean;
  vendorApiKeyConfigured: boolean;
  /** Presence only. The Mansa key value never enters settings, logs or API responses. */
  mansaApiKeyConfigured: boolean;
  mansaBaseUrl: string;
  /** Locally enforced request budget for the Mansa adapter (free tier documented as 100/day). */
  mansaDailyRequestBudget: number;
  mansaCacheTtlMs: number;
  historicalPermissionConfirmed: boolean;
  announcementsPermissionConfirmed: boolean;
}

/** Explicitly unconfigured defaults, used by tests and when no environment is supplied. */
export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'none',
  nodeEnv: 'development',
  allowDemoData: false,
  vendorBaseUrlConfigured: false,
  vendorApiKeyConfigured: false,
  mansaApiKeyConfigured: false,
  mansaBaseUrl: 'https://mansaapi.com',
  mansaDailyRequestBudget: 100,
  mansaCacheTtlMs: 5 * 60_000,
  historicalPermissionConfirmed: false,
  announcementsPermissionConfirmed: false
};

export function providerSettingsFromEnv(): ProviderSettings {
  return {
    provider: config.MARKET_DATA_PROVIDER,
    nodeEnv: config.NODE_ENV,
    allowDemoData: config.ALLOW_DEMO_MARKET_DATA === 'true',
    vendorBaseUrlConfigured: Boolean(config.NSE_VENDOR_API_BASE_URL),
    vendorApiKeyConfigured: Boolean(config.NSE_VENDOR_API_KEY),
    mansaApiKeyConfigured: Boolean(config.MANSA_API_KEY),
    mansaBaseUrl: config.MANSA_API_BASE_URL,
    mansaDailyRequestBudget: config.MANSA_DAILY_REQUEST_BUDGET,
    mansaCacheTtlMs: config.MANSA_CACHE_TTL_SECONDS * 1000,
    historicalPermissionConfirmed: config.HISTORICAL_DATA_PERMISSION_CONFIRMED === 'true',
    announcementsPermissionConfirmed: config.ANNOUNCEMENTS_PERMISSION_CONFIRMED === 'true'
  };
}

/** The Mansa secret, kept out of ProviderSettings so it cannot be serialised by accident. */
export function mansaCredentialsFromEnv(): { baseUrl: string; apiKey: string } {
  return { baseUrl: config.MANSA_API_BASE_URL, apiKey: config.MANSA_API_KEY ?? '' };
}
