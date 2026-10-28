/**
 * What this adapter claims about itself, and how it describes its own state.
 *
 * Both are pure: given the last success/failure timestamps they return the same answer, so
 * the "do not call unverified data live" rules can be tested without a network or a client.
 * The capability wording is deliberately conservative — Mansa documents a 30-minute
 * freshness target, so DELAYED is the strongest claim made here.
 */
import type { ProviderStatus } from '../../../shared/domain.js';
import type { ProviderCapabilities } from '../types.js';

export function mansaCapabilities(): ProviderCapabilities {
  return {
    displayName: 'Mansa API (mansaapi.com)',
    adapterVersion: '0.1.0',
    // Mansa documents a 30-minute freshness target during market hours, so DELAYED is the
    // strongest claim the documentation supports. It is never promoted to REAL_TIME.
    accessLevel: 'DELAYED',
    entitlement: 'CONTRACTED',
    coverage: {
      state: 'DECLARED',
      securitiesScope:
        'Kenyan equities listed on the Nairobi Securities Exchange, as returned by Mansa for the exchange code discovered at runtime (documented example code: NSE).',
      symbols: null,
      symbolCount: null,
      fields: [
        'price',
        'currency',
        'previous close',
        'open',
        'high',
        'low',
        'volume',
        'turnover',
        'percentage change (when supplied)',
        'provider observation time'
      ],
      intervals: ['intraday snapshot (30-minute documented target)', '1d (history, Pro plan)'],
      historyDepth: 'Per-stock history requires the Pro plan; not available on the free tier.',
      includesIndices: true,
      notes: [
        'Coverage and field names are asserted from Mansa’s published documentation, not from a successful authenticated response in this environment.',
        'The free tier is documented as 100 requests per day, which this adapter enforces locally.',
        'Fields absent from a payload stay absent; nothing is interpolated or carried forward silently.',
        'A Mansa API key is not an NSE redistribution licence; confirm terms before publishing prices.'
      ]
    },
    demo: false,
    documentationUrl: 'https://mansaapi.com/docs'
  };
}

export const MANSA_PROVIDER_ID = 'mansa';

export interface MansaStatusInput {
  configured: boolean;
  displayName: string;
  lastSuccessAt: Date | null;
  lastFailure: string | null;
}

export function describeMansaStatus({
  configured,
  displayName,
  lastSuccessAt,
  lastFailure
}: MansaStatusInput): ProviderStatus {
  const base = {
    provider: MANSA_PROVIDER_ID,
    dataMode: 'DELAYED' as const,
    sourceUrl: 'https://mansaapi.com/docs',
    displayName,
    demo: false,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null
  };

  if (!configured)
    return {
      ...base,
      configured: false,
      state: 'UNCONFIGURED',
      message:
        'MARKET_DATA_PROVIDER=mansa but MANSA_API_KEY is empty. No request is made; no quote is available until a key is supplied.',
      dataMode: 'UNKNOWN'
    };

  if (lastFailure && !lastSuccessAt)
    return {
      ...base,
      configured: true,
      state: 'ERROR',
      dataMode: 'UNKNOWN',
      message: `The Mansa adapter is configured but the last attempt failed: ${lastFailure}`
    };

  if (!lastSuccessAt)
    return {
      ...base,
      configured: true,
      state: 'DEGRADED',
      message:
        'Credentials are present but no authenticated Mansa response has been verified in this process yet. Run the provider connection test before claiming any data is live.',
      dataMode: 'UNKNOWN'
    };

  return {
    ...base,
    configured: true,
    state: 'READY',
    message:
      'Authenticated Mansa responses have been received in this process. Prices are delayed snapshots per Mansa’s documented 30-minute freshness target, not real-time.'
  };
}
