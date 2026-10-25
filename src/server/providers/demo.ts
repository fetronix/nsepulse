import type { MarketObservation, ProviderStatus, ProviderTestResult } from '../../shared/domain.js';
import { validateObservation } from '../market/quality.js';
import { DEMO_SOURCE_LABEL, demoFixtures, demoHistory, demoQuote, findDemoFixture } from './demo-fixtures.js';
import type { HistoricalRequest, MarketDataProvider, ProviderCapabilities, ProviderSelfTest, QuoteRequest } from './types.js';

/**
 * Development-only fixture adapter.
 *
 * Every observation is labelled `demo: true`, carries an unmistakable source string
 * and uses `dataMode: UNKNOWN`, so it can never be confused with licensed market data.
 * The factory only constructs this adapter when MARKET_DATA_PROVIDER=demo,
 * ALLOW_DEMO_MARKET_DATA=true and NODE_ENV is not production.
 */
export class DemoFixtureProvider implements MarketDataProvider {
  readonly id = 'demo-fixture';
  readonly demo = true;

  capabilities(): ProviderCapabilities {
    return {
      displayName: 'Demo fixture adapter (development only)',
      adapterVersion: '0.1.0',
      accessLevel: 'UNKNOWN',
      entitlement: 'DEMO_FIXTURE',
      coverage: {
        state: 'FIXTURE_ONLY',
        securitiesScope: 'Three synthetic fixtures only. This is not a statement about NSE coverage.',
        symbols: demoFixtures.map((fixture) => fixture.symbol),
        symbolCount: demoFixtures.length,
        fields: ['price'],
        intervals: ['1d (synthetic sessions)'],
        historyDepth: '8 synthetic sessions per fixture',
        includesIndices: false,
        notes: [
          'Fixture values are deliberately unrealistic and must never be shown as real prices.',
          'No NSE endpoint is contacted and no NSE page is scraped.',
          'Demo mode cannot be enabled in a production environment.'
        ]
      },
      demo: true,
      documentationUrl: null
    };
  }

  async status(): Promise<ProviderStatus> {
    return {
      provider: this.id,
      configured: false,
      state: 'DEMO',
      message: 'Demo fixture adapter active. Synthetic development data only — no NSE market-data access, entitlement or licensing exists.',
      lastSuccessAt: null,
      dataMode: 'UNKNOWN',
      displayName: this.capabilities().displayName,
      demo: true
    };
  }

  async getLatestQuote(request: QuoteRequest): Promise<MarketObservation | null> {
    return demoQuote(request.symbol);
  }

  async getHistory(request: HistoricalRequest): Promise<MarketObservation[]> {
    return demoHistory(request.symbol).filter((observation) => {
      const at = observation.marketEventAt ? new Date(observation.marketEventAt).getTime() : Number.NaN;
      return Number.isFinite(at) && at >= request.from.getTime() && at <= request.to.getTime();
    });
  }

  async selfTest(now = new Date()): Promise<ProviderSelfTest> {
    const checks = demoFixtures.map((fixture) => {
      const observation = demoQuote(fixture.symbol, now);
      const result = observation ? validateObservation(observation, now) : { accepted: false, reasons: ['Fixture missing'] };
      return {
        name: `Fixture ${fixture.symbol}`,
        status: result.accepted ? 'PASSED' as const : 'FAILED' as const,
        detail: result.accepted
          ? 'Synthetic fixture passes local validation. It is not market data.'
          : `Fixture rejected: ${result.reasons.join('; ')}`
      };
    });
    const allPassed = checks.every((check) => check.status === 'PASSED');
    const connection: ProviderTestResult = {
      kind: 'CONNECTION',
      status: 'NOT_APPLICABLE',
      summary: 'Demo mode has no provider endpoint. No connection test was attempted and no network request was made.',
      ranAt: now.toISOString(),
      networkCallMade: false,
      checks: [
        { name: 'Provider endpoint', status: 'NOT_APPLICABLE', detail: 'No endpoint exists in demo mode.' },
        { name: 'Credentials', status: 'NOT_APPLICABLE', detail: 'Demo fixtures never use real credentials.' }
      ]
    };
    const dataValidation: ProviderTestResult = {
      kind: 'DATA_VALIDATION',
      status: allPassed ? 'PASSED' : 'FAILED',
      summary: allPassed
        ? `All ${checks.length} synthetic fixtures pass local validation. This validates fixture shape only; it says nothing about a real provider.`
        : 'One or more synthetic fixtures failed local validation.',
      ranAt: now.toISOString(),
      networkCallMade: false,
      checks: [
        ...checks,
        { name: 'Demo labelling', status: 'PASSED', detail: `Every observation carries source "${DEMO_SOURCE_LABEL}", dataMode UNKNOWN and demo=true.` },
        { name: 'Guaranteed non-live mode', status: 'PASSED', detail: 'Fixture quotes are never labelled real-time, delayed or end-of-day.' }
      ]
    };
    return { connection, dataValidation };
  }
}

export { findDemoFixture };
