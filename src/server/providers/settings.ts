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
    historicalPermissionConfirmed: config.HISTORICAL_DATA_PERMISSION_CONFIRMED === 'true',
    announcementsPermissionConfirmed: config.ANNOUNCEMENTS_PERMISSION_CONFIRMED === 'true'
  };
}
