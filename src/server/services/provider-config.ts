import type {
  CredentialView,
  DataMode,
  EntitlementKind,
  LicensingRequirement,
  ProviderConfigurationView,
  ProviderState
} from '../../shared/domain.js';
import { dataSnapshot } from '../db/repository.js';
import type { ProviderSelection } from '../providers/factory.js';
import type { ProviderRuntime } from '../providers/runtime.js';
import type { ProviderSettings } from '../providers/settings.js';

const STATUS_LABELS: Record<ProviderState, string> = {
  UNCONFIGURED: 'Not configured',
  DEMO: 'Demo mode only',
  READY: 'Ready',
  DEGRADED: 'Degraded',
  ERROR: 'Error'
};

const ACCESS_LABELS: Record<DataMode, string> = {
  REAL_TIME: 'Real-time (contracted entitlement)',
  DELAYED: 'Delayed (contracted entitlement)',
  END_OF_DAY: 'End-of-day (contracted entitlement)',
  UNKNOWN: 'No market-data access granted'
};

const ENTITLEMENT_LABELS: Record<EntitlementKind, string> = {
  NONE: 'None',
  DEMO_FIXTURE: 'Synthetic demo fixtures only',
  CONTRACTED: 'Contracted provider entitlement'
};

function accessDisclosure(demo: boolean, entitlement: EntitlementKind, level: DataMode): string {
  if (demo) return 'Demo mode grants no market-data access. Fixture values are synthetic, carry dataMode UNKNOWN and are never labelled real-time, delayed or end-of-day.';
  if (entitlement === 'CONTRACTED' && level !== 'UNKNOWN') return 'The displayed access level must come from the signed provider agreement and the provider API specification.';
  return 'No real-time, delayed or end-of-day access has been granted. The application shows no market prices and infers no data mode from credentials.';
}

function credentials(settings: ProviderSettings, demo: boolean): CredentialView[] {
  const demoNote = demo ? 'Demo mode does not use this credential. ' : '';
  return [
    {
      key: 'NSE_VENDOR_API_BASE_URL',
      label: 'Vendor API base URL',
      required: true,
      secret: false,
      state: settings.vendorBaseUrlConfigured ? 'CONFIGURED' : 'MISSING',
      blockingForActiveAdapter: !settings.vendorBaseUrlConfigured && !demo,
      note: settings.vendorBaseUrlConfigured
        ? `${demoNote}A server-side value is present. It is not displayed, and no request is made.`
        : `${demoNote}No endpoint is assumed or invented; supply only the URL documented in a signed provider specification.`
    },
    {
      key: 'NSE_VENDOR_API_KEY',
      label: 'Vendor API key',
      required: true,
      secret: true,
      state: settings.vendorApiKeyConfigured ? 'CONFIGURED' : 'MISSING',
      blockingForActiveAdapter: !settings.vendorApiKeyConfigured && !demo,
      note: settings.vendorApiKeyConfigured
        ? `${demoNote}A server-side key is present. Its value is never returned by the API or rendered in the UI.`
        : `${demoNote}No key is stored. Secrets belong in the server environment or a secret manager, never in this page.`
    }
  ];
}

function licensingRequirements(settings: ProviderSettings, demo: boolean, contractDeclared: boolean): LicensingRequirement[] {
  const marketDataStatus = demo ? 'NOT_APPLICABLE' : 'OUTSTANDING';
  return [
    {
      id: 'data-rights',
      requirement: 'Written market-data entitlement for the intended use (display, derived analytics, redistribution)',
      status: contractDeclared ? 'SATISFIED' : marketDataStatus,
      blocking: !demo && !contractDeclared,
      detail: demo
        ? 'Demo fixtures require no market-data licence, but must not be deployed to users or production.'
        : 'Contact NSE Data Services or a currently listed licensed vendor for the applicable product and distribution model.'
    },
    {
      id: 'api-specification',
      requirement: 'Official API specification: authentication, field semantics, timestamps, revisions, rate limits and error codes',
      status: demo ? 'NOT_APPLICABLE' : contractDeclared ? 'SATISFIED' : 'OUTSTANDING',
      blocking: !demo && !contractDeclared,
      detail: demo ? 'Demo fixtures use a local, synthetic contract only.' : 'No specification is assumed. An adapter must not be written against a guessed contract.'
    },
    {
      id: 'credentials',
      requirement: 'Credential issuance, server-side storage and rotation procedure',
      status: demo ? 'NOT_APPLICABLE' : contractDeclared ? 'SATISFIED' : settings.vendorApiKeyConfigured ? 'IN_PROGRESS' : 'OUTSTANDING',
      blocking: !demo && !contractDeclared,
      detail: demo
        ? 'Demo mode accepts no credentials.'
        : settings.vendorApiKeyConfigured
          ? 'A key is present, but credential issuance is not evidence of a contract or a working adapter.'
          : 'No credentials are configured. Store secrets server-side and rotate them.'
    },
    {
      id: 'attribution',
      requirement: 'Approved attribution wording and notice obligations',
      status: demo ? 'NOT_APPLICABLE' : contractDeclared ? 'SATISFIED' : 'OUTSTANDING',
      blocking: !demo && !contractDeclared,
      detail: demo ? 'Demo fixtures must remain unmistakably labelled as synthetic.' : 'Attribution wording must be approved in writing before publication.'
    },
    {
      id: 'historical-rights',
      requirement: 'Display, retention, caching and derived-analytics rights for stored historical data',
      status: settings.historicalPermissionConfirmed ? 'SATISFIED' : 'OUTSTANDING',
      blocking: false,
      detail: settings.historicalPermissionConfirmed
        ? 'An operator has confirmed stored historical data may be displayed and derived. Keep the written record with the contract file.'
        : 'Stored historical series are served independently of the live adapter only after permission is confirmed. Set HISTORICAL_DATA_PERMISSION_CONFIRMED=true once written permission is on file.'
    },
    {
      id: 'announcements-rights',
      requirement: 'Separate permission to store and republish official company announcements',
      status: settings.announcementsPermissionConfirmed ? 'SATISFIED' : 'OUTSTANDING',
      blocking: false,
      detail: settings.announcementsPermissionConfirmed
        ? 'An operator has confirmed announcement storage/republication permission. Only sources enabled in the announcement source registry are exposed.'
        : 'Announcements require their own permission and an operator-registered, enabled source. No source is scraped or assumed.'
    },
    {
      id: 'demo-guard',
      requirement: 'Demo fixture adapter disabled before any user-facing or production deployment',
      status: demo ? 'OUTSTANDING' : 'NOT_APPLICABLE',
      blocking: demo,
      detail: demo
        ? 'Demo mode is active in this environment. Set MARKET_DATA_PROVIDER=none and ALLOW_DEMO_MARKET_DATA=false for deployments.'
        : 'Demo mode is not active.'
    }
  ];
}

export class ProviderConfigurationService {
  constructor(
    private readonly selection: ProviderSelection,
    private readonly runtime: ProviderRuntime
  ) {}

  /** Run local adapter checks. Never performs an outbound request for the current adapters. */
  async runTests(now = new Date()): Promise<ProviderConfigurationView> {
    const results = await this.selection.provider.selfTest(now);
    this.runtime.recordSelfTest(this.selection.provider.id, results);
    return this.view(now);
  }

  async view(now = new Date()): Promise<ProviderConfigurationView> {
    const { selection, runtime } = this;
    const provider = selection.provider;
    const capabilities = provider.capabilities();
    const status = await provider.status();
    const snapshot = runtime.snapshot(provider.id);
    const persisted = await dataSnapshot();
    const demo = provider.demo;
    const contractDeclared = capabilities.entitlement === 'CONTRACTED';
    const liveQuoteAdapterEnabled = status.state === 'READY' && status.configured && !demo;

    return {
      provider: {
        id: provider.id,
        displayName: capabilities.displayName,
        adapterVersion: capabilities.adapterVersion,
        demo,
        integrationStatus: status.state,
        statusLabel: STATUS_LABELS[status.state],
        statusMessage: status.message,
        sourceDocumentationUrl: capabilities.documentationUrl
      },
      environment: {
        nodeEnv: selection.settings.nodeEnv,
        requestedProvider: selection.requestedProvider,
        demoRequested: selection.demoRequested,
        demoDataAllowed: selection.demoDataAllowed,
        demoBlockedReason: selection.demoBlockedReason,
        liveQuoteAdapterEnabled,
        enforcedDefaultProvider: 'none'
      },
      credentials: credentials(selection.settings, demo),
      coverage: capabilities.coverage,
      access: {
        level: capabilities.accessLevel,
        levelLabel: ACCESS_LABELS[capabilities.accessLevel],
        entitlement: capabilities.entitlement,
        entitlementLabel: ENTITLEMENT_LABELS[capabilities.entitlement],
        disclosure: accessDisclosure(demo, capabilities.entitlement, capabilities.accessLevel)
      },
      retrieval: {
        lastSuccessfulRetrievalAt: snapshot.lastSuccessAt,
        lastAttemptAt: snapshot.lastAttemptAt,
        lastFailureAt: snapshot.lastFailureAt,
        failureSummary: snapshot.failureSummary,
        persistedLatestObservationAt: persisted.latestObservationEventAt,
        persistedLatestIngestionAt: persisted.latestObservationIngestedAt,
        persistedHistoricalThrough: persisted.latestHistoricalSessionDate,
        trackingNote: 'Adapter attempts and test results are held in memory and reset when the API process restarts. Persisted timestamps come from the application database.'
      },
      tests: {
        connection: snapshot.connection,
        dataValidation: snapshot.dataValidation,
        runNote: 'Running tests performs local checks only. No outbound request is made unless a contracted adapter has been implemented and explicitly enabled.'
      },
      licensing: licensingRequirements(selection.settings, demo, contractDeclared),
      warnings: selection.warnings,
      generatedAt: now.toISOString()
    };
  }
}
