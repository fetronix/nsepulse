import type {
  CoverageView,
  DataMode,
  EntitlementKind,
  MarketObservation,
  ProviderStatus,
  ProviderTestResult
} from '../../shared/domain.js';

export interface QuoteRequest { symbol: string }
export interface HistoricalRequest { symbol: string; from: Date; to: Date; interval: '1d' | '1w' | '1mo' }

export interface ProviderCapabilities {
  displayName: string;
  adapterVersion: string;
  /** Contracted access level. `UNKNOWN` means no market-data entitlement is in place. */
  accessLevel: DataMode;
  entitlement: EntitlementKind;
  coverage: CoverageView;
  /** True only for synthetic development fixtures. */
  demo: boolean;
  documentationUrl: string | null;
}

export interface ProviderSelfTest {
  connection: ProviderTestResult;
  dataValidation: ProviderTestResult;
}

/**
 * Replaceable market-data boundary.
 *
 * Implementations must never scrape display pages, invent endpoints or return
 * unlabelled synthetic data. A provider may only declare a real access level once
 * a contract and API specification exist.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly demo: boolean;
  status(): Promise<ProviderStatus>;
  capabilities(): ProviderCapabilities;
  getLatestQuote(request: QuoteRequest): Promise<MarketObservation | null>;
  getHistory(request: HistoricalRequest): Promise<MarketObservation[]>;
  /** Local checks only. Must not perform an outbound call unless a contracted adapter exists. */
  selfTest(now?: Date): Promise<ProviderSelfTest>;
}

const NOT_DECLARED_COVERAGE: CoverageView = {
  state: 'NOT_DECLARED',
  securitiesScope: 'Not declared. Coverage can only be stated after a signed contract and the provider API specification are available.',
  symbols: null,
  symbolCount: null,
  fields: [],
  intervals: [],
  historyDepth: 'Not declared',
  includesIndices: false,
  notes: [
    'No endpoint, credential or coverage list is guessed by the application.',
    'This adapter performs no outbound request and returns no quote values.'
  ]
};

/** Intentionally does not scrape public pages or fabricate responses. */
export class UnconfiguredProvider implements MarketDataProvider {
  readonly id = 'nse-authorized-feed';
  readonly demo = false;

  capabilities(): ProviderCapabilities {
    return {
      displayName: 'NSE authorised feed (not implemented)',
      adapterVersion: '0.1.0',
      accessLevel: 'UNKNOWN',
      entitlement: 'NONE',
      coverage: NOT_DECLARED_COVERAGE,
      demo: false,
      documentationUrl: 'https://www.nse.co.ke/dataservices/'
    };
  }

  async status(): Promise<ProviderStatus> {
    return {
      provider: this.id,
      configured: false,
      state: 'UNCONFIGURED',
      message: 'Awaiting an authorized NSE or licensed vendor agreement, endpoint, credentials and permitted-use confirmation.',
      lastSuccessAt: null,
      dataMode: 'UNKNOWN',
      sourceUrl: 'https://www.nse.co.ke/dataservices/',
      displayName: this.capabilities().displayName,
      demo: false
    };
  }

  async getLatestQuote(_request: QuoteRequest): Promise<null> { return null; }
  async getHistory(_request: HistoricalRequest): Promise<[]> { return []; }

  async selfTest(now = new Date()): Promise<ProviderSelfTest> {
    const blocked = (kind: ProviderTestResult['kind'], summary: string): ProviderTestResult => ({
      kind,
      status: 'BLOCKED',
      summary,
      ranAt: now.toISOString(),
      networkCallMade: false,
      checks: [
        { name: 'Contracted endpoint', status: 'BLOCKED', detail: 'No endpoint has been supplied or invented.' },
        { name: 'Provider credentials', status: 'BLOCKED', detail: 'No credentials are configured for a contracted adapter.' },
        { name: 'Permitted use', status: 'BLOCKED', detail: 'No licensing or redistribution approval is recorded.' }
      ]
    });
    return {
      connection: blocked('CONNECTION', 'Connection test not attempted: no contracted adapter, endpoint or credentials exist.'),
      dataValidation: blocked('DATA_VALIDATION', 'Validation not attempted: no provider payload exists and none is simulated.')
    };
  }
}

export class ProviderRegistry {
  constructor(private readonly providers: MarketDataProvider[] = [new UnconfiguredProvider()]) {}
  get primary(): MarketDataProvider { return this.providers[0]!; }
  get all(): readonly MarketDataProvider[] { return this.providers; }
  async statuses(): Promise<ProviderStatus[]> { return Promise.all(this.providers.map((provider) => provider.status())); }
}
