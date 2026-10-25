export type DataMode = 'REAL_TIME' | 'DELAYED' | 'END_OF_DAY' | 'UNKNOWN';
export type ValidationStatus = 'VALID' | 'WARNING' | 'REJECTED' | 'UNVERIFIED';
export interface ProviderStatus {
  provider: string;
  configured: boolean;
  state: 'UNCONFIGURED' | 'READY' | 'DEGRADED' | 'ERROR';
  message: string;
  lastSuccessAt: string | null;
  dataMode: DataMode;
  sourceUrl?: string;
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
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
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
