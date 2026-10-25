export type DataMode = 'REAL_TIME' | 'DELAYED' | 'END_OF_DAY' | 'UNKNOWN';
export type ValidationStatus = 'VALID' | 'WARNING' | 'REJECTED' | 'UNVERIFIED';

/** `DEMO` means a fixture adapter is active for development; it grants no market-data access. */
export type ProviderState = 'UNCONFIGURED' | 'DEMO' | 'READY' | 'DEGRADED' | 'ERROR';

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  state: ProviderState;
  message: string;
  lastSuccessAt: string | null;
  dataMode: DataMode;
  sourceUrl?: string;
  displayName?: string;
  demo?: boolean;
}

export interface MarketObservation {
  securityId: string;
  symbol: string;
  price: number;
  currency: 'KES';
  source: string;
  marketEventAt: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  dataMode: DataMode;
  validationStatus: ValidationStatus;
  volume?: number | null;
  /** Percentage change, only when the provider supplied it or it follows from its own fields. */
  changePercent?: number | null;
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  /** True only for synthetic fixture data produced by the demo adapter. */
  demo?: boolean;
}

export interface SecuritySummary {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  listingStatus: string;
  sector: string | null;
}

/* ------------------------------------------------------------------ *
 * Provider configuration and commissioning views
 * ------------------------------------------------------------------ */

/** What the application is currently entitled to use. Never inferred from credentials alone. */
export type EntitlementKind = 'NONE' | 'DEMO_FIXTURE' | 'CONTRACTED';

export type CredentialState = 'CONFIGURED' | 'MISSING' | 'NOT_REQUIRED';

export interface CredentialView {
  /** Environment variable name — the value is never included in any response. */
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  state: CredentialState;
  /** Whether this credential currently blocks the active adapter. */
  blockingForActiveAdapter: boolean;
  note: string;
}

export type CoverageState = 'DECLARED' | 'NOT_DECLARED' | 'FIXTURE_ONLY';

export interface CoverageView {
  state: CoverageState;
  securitiesScope: string;
  symbols: string[] | null;
  symbolCount: number | null;
  fields: string[];
  intervals: string[];
  historyDepth: string;
  includesIndices: boolean;
  notes: string[];
}

export type TestStatus = 'NOT_RUN' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'NOT_APPLICABLE';

export interface ProviderCheck {
  name: string;
  status: TestStatus;
  detail: string;
}

export interface ProviderTestResult {
  kind: 'CONNECTION' | 'DATA_VALIDATION';
  status: TestStatus;
  summary: string;
  ranAt: string | null;
  /** Explicit: whether the check performed any outbound network request. */
  networkCallMade: boolean;
  checks: ProviderCheck[];
}

export type LicensingStatus = 'OUTSTANDING' | 'IN_PROGRESS' | 'SATISFIED' | 'NOT_APPLICABLE';

export interface LicensingRequirement {
  id: string;
  requirement: string;
  status: LicensingStatus;
  blocking: boolean;
  detail: string;
}

export interface ProviderConfigurationView {
  provider: {
    id: string;
    displayName: string;
    adapterVersion: string;
    demo: boolean;
    integrationStatus: ProviderState;
    statusLabel: string;
    statusMessage: string;
    sourceDocumentationUrl: string | null;
  };
  environment: {
    nodeEnv: string;
    requestedProvider: string;
    demoRequested: boolean;
    demoDataAllowed: boolean;
    demoBlockedReason: string | null;
    liveQuoteAdapterEnabled: boolean;
    enforcedDefaultProvider: 'none';
  };
  credentials: CredentialView[];
  coverage: CoverageView;
  access: {
    level: DataMode;
    levelLabel: string;
    entitlement: EntitlementKind;
    entitlementLabel: string;
    disclosure: string;
  };
  retrieval: {
    lastSuccessfulRetrievalAt: string | null;
    lastAttemptAt: string | null;
    lastFailureAt: string | null;
    failureSummary: string | null;
    persistedLatestObservationAt: string | null;
    persistedLatestIngestionAt: string | null;
    persistedHistoricalThrough: string | null;
    trackingNote: string;
  };
  tests: {
    connection: ProviderTestResult;
    dataValidation: ProviderTestResult;
    runNote: string;
  };
  licensing: LicensingRequirement[];
  warnings: string[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Independent data sources (usable without a live quote adapter)
 * ------------------------------------------------------------------ */

export type PermissionStatus = 'GRANTED' | 'UNCONFIRMED' | 'NOT_REQUESTED' | 'NOT_APPLICABLE';

export interface DataSourcePermission {
  status: PermissionStatus;
  basis: string;
}

export type SourceFreshness = 'REAL_TIME' | 'DELAYED' | 'END_OF_DAY' | 'AS_PUBLISHED' | 'REFERENCE' | 'UNKNOWN';

export type SourceAvailability =
  'AVAILABLE' | 'EMPTY' | 'NOT_CONFIGURED' | 'DISABLED' | 'PERMISSION_BLOCKED' | 'STORE_UNAVAILABLE';

export interface DataSourceView {
  id: string;
  name: string;
  category: 'REFERENCE' | 'LIVE_QUOTE' | 'HISTORICAL' | 'ANNOUNCEMENTS';
  provider: string;
  permission: DataSourcePermission;
  freshness: { label: SourceFreshness; description: string };
  availability: { state: SourceAvailability; message: string };
  independentOfLiveQuoteAdapter: boolean;
  lastRetrievedAt: string | null;
  notes: string[];
}

export interface DataSourcesResponse {
  generatedAt: string;
  items: DataSourceView[];
  notes: string[];
}

export interface AnnouncementView {
  id: string;
  symbol: string | null;
  title: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: string | null;
  sourceType: string;
  verified: boolean;
  freshness: 'AS_PUBLISHED';
}

export interface AnnouncementsResponse {
  state: 'OK' | 'EMPTY' | 'PERMISSION_UNCONFIRMED' | 'STORE_UNAVAILABLE';
  reason: string | null;
  permission: DataSourcePermission;
  freshness: { label: 'AS_PUBLISHED'; description: string };
  items: AnnouncementView[];
}
