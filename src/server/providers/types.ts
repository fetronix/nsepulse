import type { MarketObservation, ProviderStatus } from '../../shared/domain.js';

export interface QuoteRequest { symbol: string }
export interface HistoricalRequest { symbol: string; from: Date; to: Date; interval: '1d' | '1w' | '1mo' }
export interface MarketDataProvider {
  readonly id: string;
  status(): Promise<ProviderStatus>;
  getLatestQuote(request: QuoteRequest): Promise<MarketObservation | null>;
  getHistory(request: HistoricalRequest): Promise<MarketObservation[]>;
}

/** Intentionally does not scrape public pages or fabricate responses. */
export class UnconfiguredProvider implements MarketDataProvider {
  readonly id = 'nse-authorized-feed';
  async status(): Promise<ProviderStatus> {
    return { provider: this.id, configured: false, state: 'UNCONFIGURED', message: 'Awaiting an authorized NSE or licensed vendor agreement, endpoint, credentials and permitted-use confirmation.', lastSuccessAt: null, dataMode: 'UNKNOWN', sourceUrl: 'https://www.nse.co.ke/dataservices/' };
  }
  async getLatestQuote(_request: QuoteRequest): Promise<null> { return null; }
  async getHistory(_request: HistoricalRequest): Promise<[]> { return []; }
}

export class ProviderRegistry {
  constructor(private readonly providers: MarketDataProvider[] = [new UnconfiguredProvider()]) {}
  get primary(): MarketDataProvider { return this.providers[0]!; }
  async statuses(): Promise<ProviderStatus[]> { return Promise.all(this.providers.map((provider) => provider.status())); }
}
