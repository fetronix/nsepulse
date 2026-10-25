import type { MarketObservation } from '../../shared/domain.js';

export const DEMO_SOURCE_LABEL = 'DEMO FIXTURE — SYNTHETIC VALUES, NOT AN NSE QUOTE';

export interface DemoFixture {
  symbol: string;
  name: string;
  sector: string;
  /** Deliberately unrealistic value so a screenshot can never be mistaken for a real price. */
  price: number;
  /** Deterministic pseudo-series used for demo history; index 0 is the oldest session. */
  closes: number[];
}

/**
 * Synthetic fixtures for local development only.
 *
 * These are not NSE market data, are not derived from any NSE page, and must never
 * be described as live, delayed or end-of-day market observations.
 */
export const demoFixtures: readonly DemoFixture[] = [
  { symbol: 'SCOM', name: 'Demo fixture — telecommunications listing', sector: 'DEMO FIXTURE', price: 0.01, closes: [0.01, 0.0101, 0.0099, 0.0102, 0.0101, 0.0103, 0.0102, 0.0104] },
  { symbol: 'EQTY', name: 'Demo fixture — banking listing', sector: 'DEMO FIXTURE', price: 0.02, closes: [0.02, 0.0198, 0.0201, 0.0199, 0.0202, 0.0203, 0.0201, 0.0204] },
  { symbol: 'KEGN', name: 'Demo fixture — energy listing', sector: 'DEMO FIXTURE', price: 0.03, closes: [0.03, 0.0302, 0.0298, 0.0301, 0.0303, 0.0301, 0.0304, 0.0302] }
];

export function findDemoFixture(symbol: string): DemoFixture | null {
  const normalised = symbol.trim().toUpperCase();
  return demoFixtures.find((fixture) => fixture.symbol === normalised) ?? null;
}

function demoObservation(fixture: DemoFixture, now: Date): MarketObservation {
  return {
    securityId: `demo:${fixture.symbol}`,
    symbol: fixture.symbol,
    price: fixture.price,
    currency: 'KES',
    source: DEMO_SOURCE_LABEL,
    marketEventAt: null,
    publishedAt: null,
    ingestedAt: now.toISOString(),
    dataMode: 'UNKNOWN',
    validationStatus: 'UNVERIFIED',
    volume: null,
    previousClose: null,
    open: null,
    high: null,
    low: null,
    demo: true
  };
}

export function demoQuote(symbol: string, now = new Date()): MarketObservation | null {
  const fixture = findDemoFixture(symbol);
  return fixture ? demoObservation(fixture, now) : null;
}

export function demoHistory(symbol: string, now = new Date()): MarketObservation[] {
  const fixture = findDemoFixture(symbol);
  if (!fixture) return [];
  const series: MarketObservation[] = fixture.closes.map((close, index) => {
    const session = new Date(now.getTime() - (fixture.closes.length - index) * 24 * 60 * 60 * 1000);
    return {
      securityId: `demo:${fixture.symbol}`,
      symbol: fixture.symbol,
      price: close,
      currency: 'KES',
      source: DEMO_SOURCE_LABEL,
      marketEventAt: session.toISOString(),
      publishedAt: null,
      ingestedAt: now.toISOString(),
      dataMode: 'UNKNOWN',
      validationStatus: 'UNVERIFIED',
      volume: null,
      demo: true
    };
  });
  return series;
}
