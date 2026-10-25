import type {
  AnnouncementsResponse,
  DataSourcesResponse,
  ProviderConfigurationView,
  ProviderTestResult
} from '../../src/shared/domain.js';

/**
 * Typed fixtures for provider configuration responses. They mirror the shape returned
 * by the API so client tests fail to compile if the contract changes.
 */

const notRunTest = (kind: ProviderTestResult['kind']): ProviderTestResult => ({
  kind,
  status: 'NOT_RUN',
  summary: 'Tests have not been run in this process.',
  ranAt: null,
  networkCallMade: false,
  checks: []
});

export function unconfiguredConfiguration(
  overrides: Partial<ProviderConfigurationView> = {}
): ProviderConfigurationView {
  return {
    provider: {
      id: 'nse-authorized-feed',
      displayName: 'NSE authorised feed (not implemented)',
      adapterVersion: '0.1.0',
      demo: false,
      integrationStatus: 'UNCONFIGURED',
      statusLabel: 'Not configured',
      statusMessage:
        'Awaiting an authorized NSE or licensed vendor agreement, endpoint, credentials and permitted-use confirmation.',
      sourceDocumentationUrl: 'https://www.nse.co.ke/dataservices/'
    },
    environment: {
      nodeEnv: 'test',
      requestedProvider: 'none',
      demoRequested: false,
      demoDataAllowed: false,
      demoBlockedReason: null,
      liveQuoteAdapterEnabled: false,
      enforcedDefaultProvider: 'none'
    },
    credentials: [
      {
        key: 'NSE_VENDOR_API_BASE_URL',
        label: 'Vendor API base URL',
        required: true,
        secret: false,
        state: 'MISSING',
        blockingForActiveAdapter: true,
        note: 'No endpoint is assumed or invented.'
      },
      {
        key: 'NSE_VENDOR_API_KEY',
        label: 'Vendor API key',
        required: true,
        secret: true,
        state: 'MISSING',
        blockingForActiveAdapter: true,
        note: 'No key is stored. Its value is never returned by the API.'
      }
    ],
    coverage: {
      state: 'NOT_DECLARED',
      securitiesScope: 'Not declared. Coverage can only be stated after a signed contract.',
      symbols: null,
      symbolCount: null,
      fields: [],
      intervals: [],
      historyDepth: 'Not declared',
      includesIndices: false,
      notes: ['No endpoint, credential or coverage list is guessed by the application.']
    },
    access: {
      level: 'UNKNOWN',
      levelLabel: 'No market-data access granted',
      entitlement: 'NONE',
      entitlementLabel: 'None',
      disclosure: 'No real-time, delayed or end-of-day access has been granted.'
    },
    retrieval: {
      lastSuccessfulRetrievalAt: null,
      lastAttemptAt: null,
      lastFailureAt: null,
      failureSummary: null,
      persistedLatestObservationAt: null,
      persistedLatestIngestionAt: null,
      persistedHistoricalThrough: null,
      trackingNote: 'Adapter attempts are held in memory.'
    },
    tests: {
      connection: notRunTest('CONNECTION'),
      dataValidation: notRunTest('DATA_VALIDATION'),
      runNote: 'Running tests performs local checks only.'
    },
    licensing: [
      {
        id: 'data-rights',
        requirement: 'Written market-data entitlement',
        status: 'OUTSTANDING',
        blocking: true,
        detail: 'Contact NSE Data Services.'
      },
      {
        id: 'demo-guard',
        requirement: 'Demo fixture adapter disabled before deployment',
        status: 'NOT_APPLICABLE',
        blocking: false,
        detail: 'Demo mode is not active.'
      }
    ],
    warnings: [],
    generatedAt: '2026-10-25T10:00:00.000Z',
    ...overrides
  };
}

export function demoConfiguration(): ProviderConfigurationView {
  return unconfiguredConfiguration({
    provider: {
      id: 'demo-fixture',
      displayName: 'Demo fixture adapter (development only)',
      adapterVersion: '0.1.0',
      demo: true,
      integrationStatus: 'DEMO',
      statusLabel: 'Demo mode only',
      statusMessage: 'Demo fixture adapter active. Synthetic development data only.',
      sourceDocumentationUrl: null
    },
    environment: {
      nodeEnv: 'development',
      requestedProvider: 'demo',
      demoRequested: true,
      demoDataAllowed: true,
      demoBlockedReason: null,
      liveQuoteAdapterEnabled: false,
      enforcedDefaultProvider: 'none'
    },
    credentials: unconfiguredConfiguration().credentials.map((credential) => ({
      ...credential,
      blockingForActiveAdapter: false
    })),
    coverage: {
      state: 'FIXTURE_ONLY',
      securitiesScope: 'Three synthetic fixtures only.',
      symbols: ['SCOM', 'EQTY', 'KEGN'],
      symbolCount: 3,
      fields: ['price'],
      intervals: ['1d (synthetic sessions)'],
      historyDepth: '8 synthetic sessions per fixture',
      includesIndices: false,
      notes: ['Fixture values are deliberately unrealistic.']
    },
    access: {
      level: 'UNKNOWN',
      levelLabel: 'No market-data access granted',
      entitlement: 'DEMO_FIXTURE',
      entitlementLabel: 'Synthetic demo fixtures only',
      disclosure: 'Demo mode grants no market-data access.'
    },
    warnings: ['Demo fixture adapter is active. Every value is synthetic.']
  });
}

export function blockedTests(): { connection: ProviderTestResult; dataValidation: ProviderTestResult } {
  return {
    connection: {
      kind: 'CONNECTION',
      status: 'BLOCKED',
      summary: 'Connection test not attempted: no contracted adapter exists.',
      ranAt: '2026-10-25T10:05:00.000Z',
      networkCallMade: false,
      checks: [{ name: 'Contracted endpoint', status: 'BLOCKED', detail: 'No endpoint supplied.' }]
    },
    dataValidation: {
      kind: 'DATA_VALIDATION',
      status: 'BLOCKED',
      summary: 'Validation not attempted: no provider payload exists.',
      ranAt: '2026-10-25T10:05:00.000Z',
      networkCallMade: false,
      checks: [{ name: 'Provider credentials', status: 'BLOCKED', detail: 'No credentials configured.' }]
    }
  };
}

export function dataSources(overrides: Partial<DataSourcesResponse> = {}): DataSourcesResponse {
  return {
    generatedAt: '2026-10-25T10:00:00.000Z',
    items: [
      {
        id: 'live-quotes',
        name: 'Live, delayed or end-of-day quote feed',
        category: 'LIVE_QUOTE',
        provider: 'NSE authorised feed (not implemented)',
        permission: { status: 'NOT_REQUESTED', basis: 'No entitlement recorded.' },
        freshness: { label: 'UNKNOWN', description: 'No access level is in force.' },
        availability: { state: 'NOT_CONFIGURED', message: 'No authorized live quote adapter is configured.' },
        independentOfLiveQuoteAdapter: false,
        lastRetrievedAt: null,
        notes: ['Requires a signed agreement.']
      },
      {
        id: 'historical-eod',
        name: 'Stored historical price series',
        category: 'HISTORICAL',
        provider: 'Application database',
        permission: { status: 'UNCONFIRMED', basis: 'No written historical permission recorded.' },
        freshness: { label: 'END_OF_DAY', description: 'Daily sessions only.' },
        availability: { state: 'PERMISSION_BLOCKED', message: 'Withheld until permission is confirmed.' },
        independentOfLiveQuoteAdapter: true,
        lastRetrievedAt: null,
        notes: ['Served independently of the live adapter.']
      }
    ],
    notes: ['Each source carries its own permission state.'],
    ...overrides
  };
}

export function announcements(overrides: Partial<AnnouncementsResponse> = {}): AnnouncementsResponse {
  return {
    state: 'PERMISSION_UNCONFIRMED',
    reason: 'Announcement storage and republication permission has not been confirmed.',
    permission: { status: 'UNCONFIRMED', basis: 'No permission recorded.' },
    freshness: { label: 'AS_PUBLISHED', description: 'Reproduced as published.' },
    items: [],
    ...overrides
  };
}

export const health = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: '2026-10-25T10:00:00.000Z',
  database: { configured: false, reachable: false, message: 'DATABASE_URL is not configured.' },
  providers: [
    {
      provider: 'nse-authorized-feed',
      configured: false,
      state: 'UNCONFIGURED',
      message: 'Awaiting agreement.',
      dataMode: 'UNKNOWN'
    }
  ],
  demoMode: false,
  liveQuoteAdapterEnabled: false
};

export const overview = {
  sessionStatus: 'UNKNOWN',
  sessionNote: 'Market calendar is not yet configured.',
  currency: 'KES',
  timezone: 'Africa/Nairobi',
  indices: [],
  dataFreshness: { latestObservationAt: null, status: 'NO_DATA' },
  counts: { securities: null, observations: null },
  providerStatuses: []
};
