/**
 * How a value is labelled, and how old it is.
 *
 * Every response the API returns carries provenance, because the difference between a
 * synthetic fixture, a stored observation and a provider snapshot is the thing most likely
 * to be misread as "live price". Keeping the wording in one module means the demo notice,
 * the provider notice and the stale wording cannot drift apart.
 */
import type { DataMode } from '../../shared/domain.js';
import { DEMO_SOURCE_LABEL, findDemoFixture } from '../providers/demo-fixtures.js';

export const DEMO_NOTICE = 'Demo fixture data — synthetic values, not NSE market data.';

export function historicalPermission(confirmed: boolean) {
  return confirmed
    ? {
        status: 'GRANTED' as const,
        basis: 'Operator-confirmed written permission for stored historical display and derived analytics.'
      }
    : {
        status: 'UNCONFIRMED' as const,
        basis: 'No written historical display/retention permission is recorded in the application.'
      };
}

export const DEMO_PERMISSION = {
  status: 'NOT_APPLICABLE' as const,
  basis: 'Demo fixtures are synthetic and are not sourced market data.'
};

export type Provenance = {
  kind: 'DEMO_FIXTURE' | 'STORED_OBSERVATION' | 'PROVIDER_QUOTE' | 'UNAVAILABLE';
  label: string;
  liveQuoteAdapterEnabled: boolean;
  dataMode: DataMode;
  source: string | null;
  freshnessNote: string;
};

export function demoProvenance(): Provenance {
  return {
    kind: 'DEMO_FIXTURE',
    label: 'Demo fixture — synthetic values, not NSE market data',
    liveQuoteAdapterEnabled: false,
    dataMode: 'UNKNOWN',
    source: DEMO_SOURCE_LABEL,
    freshnessNote:
      'Fixture values carry no market event timestamp and must never be described as live, delayed or end-of-day.'
  };
}

export const PROVIDER_QUOTE_NOTICE =
  'Provider snapshot — delayed market data, not real-time. Mansa documents a 30-minute freshness target during market hours.';

export function providerProvenance(
  source: string,
  dataMode: DataMode,
  stale: boolean,
  marketEventAt: string | null
): Provenance {
  return {
    kind: 'PROVIDER_QUOTE',
    label: 'Live adapter response from the configured market-data provider',
    liveQuoteAdapterEnabled: true,
    dataMode,
    source,
    freshnessNote: marketEventAt
      ? `Provider observation time ${marketEventAt}. Data mode ${dataMode} is derived from provider metadata, never assumed to be real-time${stale ? '; the snapshot is stale' : ''}.`
      : 'The provider supplied no observation timestamp, so freshness cannot be asserted.'
  };
}

export function storedProvenance(source: string, dataMode: string, stale: boolean): Provenance {
  return {
    kind: 'STORED_OBSERVATION',
    label: 'Stored observation from the application database (not a live feed)',
    liveQuoteAdapterEnabled: false,
    dataMode: (dataMode as DataMode) ?? 'UNKNOWN',
    source,
    freshnessNote: stale
      ? 'The stored observation is older than 24 hours or has no market event timestamp; treat it as historical.'
      : 'Freshness is judged from the recorded market event time; the source and data mode are shown exactly as stored.'
  };
}

export function demoSecurity(symbol: string) {
  const fixture = findDemoFixture(symbol);
  return {
    id: `demo:${symbol}`,
    symbol,
    name: fixture ? `${fixture.name} (demo)` : `${symbol} (demo fixture)`,
    exchange: 'DEMO',
    instrumentType: 'DEMO_FIXTURE',
    listingStatus: 'DEMO_ONLY',
    sector: 'DEMO FIXTURE',
    demo: true
  };
}
