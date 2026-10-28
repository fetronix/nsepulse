/**
 * Quote resolution, in one place, with the honesty rules made explicit.
 *
 * The order is deliberate and must not be reshuffled: a demo provider answers only from
 * labelled fixtures, a live adapter answers first and its answer is never replaced, and
 * stored observations are a fallback that is labelled as stored. Every branch returns
 * provenance, so a caller cannot accidentally present stored data as a live quote.
 */
import type { ProviderRegistry } from '../providers/types.js';
import type { ProviderRuntime } from '../providers/runtime.js';
import { findSecurityBySymbol, latestObservation } from '../db/repository.js';
import { isStale } from './quality.js';
import {
  DEMO_NOTICE,
  PROVIDER_QUOTE_NOTICE,
  demoProvenance,
  demoSecurity,
  providerProvenance,
  storedProvenance
} from './provenance.js';

export interface QuoteDeps {
  providers: ProviderRegistry;
  runtime: ProviderRuntime;
}

export async function resolveQuote({ providers, runtime }: QuoteDeps, symbol: string) {
  const provider = providers.primary;
  if (provider.demo) {
    const observation = await provider.getLatestQuote({ symbol });
    if (!observation) {
      runtime.recordRetrievalFailure(provider.id, `Demo fixture missing for ${symbol}`);
      return {
        security: null,
        observation: null,
        reason:
          'This symbol is not one of the demo fixtures. Demo mode never returns real securities, quotes or prices.',
        provenance: demoProvenance(),
        warnings: [DEMO_NOTICE]
      };
    }
    runtime.recordRetrievalSuccess(provider.id);
    return {
      security: demoSecurity(symbol),
      observation: { ...observation, stale: false },
      reason: null,
      provenance: demoProvenance(),
      warnings: [DEMO_NOTICE]
    };
  }

  // Live adapter first. A provider that is enabled but fails must not be papered over with
  // stored rows: the stored path below is labelled as stored and says so in the warnings.
  if (provider.live) {
    const observation = await provider.getLatestQuote({ symbol });
    if (observation) {
      runtime.recordRetrievalSuccess(provider.id);
      const security = await findSecurityBySymbol(symbol);
      const stale = isStale(observation.marketEventAt);
      return {
        security: security
          ? {
              id: security.id,
              symbol: security.symbol,
              name: security.name,
              exchange: security.exchange,
              instrumentType: security.instrumentType,
              listingStatus: security.listingStatus,
              sector: security.sector
            }
          : {
              id: observation.securityId,
              symbol: observation.symbol,
              name: observation.symbol,
              exchange: 'NSE',
              instrumentType: 'EQUITY',
              listingStatus: 'UNKNOWN',
              sector: null
            },
        observation: { ...observation, stale },
        reason: null,
        provenance: providerProvenance(observation.source, observation.dataMode, stale, observation.marketEventAt),
        warnings: [
          PROVIDER_QUOTE_NOTICE,
          // A snapshot can be stale because it is old *or* because the provider gave no time
          // at all. Saying "older than 24 hours" about an undated value would be a guess.
          ...(stale
            ? [
                observation.marketEventAt
                  ? 'The provider snapshot is older than 24 hours; treat it as historical.'
                  : 'The provider supplied no observation timestamp; freshness cannot be asserted.'
              ]
            : []),
          ...(security
            ? []
            : ['This symbol is not in the configured security master; identity is taken from the provider record.'])
        ]
      };
    }
    const failure = provider.describeLastFailure?.() ?? 'The provider returned no quote for this symbol.';
    runtime.recordRetrievalFailure(provider.id, failure);
    const security = await findSecurityBySymbol(symbol);
    const row = security ? await latestObservation(security.id) : null;
    if (!row)
      return {
        security,
        observation: null,
        reason: `No verified quote is available: the configured provider did not supply one (${failure}).`,
        provenance: null,
        warnings: [PROVIDER_QUOTE_NOTICE]
      };
    const fallbackStale = isStale(row.marketEventAt?.toISOString() ?? null);
    return {
      security,
      observation: {
        ...row,
        price: Number(row.price),
        open: row.open ? Number(row.open) : null,
        high: row.high ? Number(row.high) : null,
        low: row.low ? Number(row.low) : null,
        previousClose: row.previousClose ? Number(row.previousClose) : null,
        turnover: row.turnover ? Number(row.turnover) : null,
        stale: fallbackStale,
        marketEventAt: row.marketEventAt?.toISOString() ?? null
      },
      reason: null,
      provenance: storedProvenance(row.source, row.dataMode, fallbackStale),
      warnings: [
        `The provider did not answer (${failure}). The quote shown is a stored observation, not a current provider quote.`,
        ...(fallbackStale ? ['The stored observation is stale.'] : [])
      ]
    };
  }

  const security = await findSecurityBySymbol(symbol);
  if (!security)
    return {
      security: null,
      observation: null,
      reason: 'Security not found in the configured security master.',
      provenance: null,
      warnings: []
    };
  const row = await latestObservation(security.id);
  if (!row)
    return {
      security,
      observation: null,
      reason: 'No verified market observations are available.',
      provenance: null,
      warnings: []
    };
  const eventAt = row.marketEventAt?.toISOString() ?? null;
  const stale = isStale(eventAt);
  return {
    security,
    observation: {
      ...row,
      price: Number(row.price),
      volume: row.volume,
      open: row.open ? Number(row.open) : null,
      high: row.high ? Number(row.high) : null,
      low: row.low ? Number(row.low) : null,
      previousClose: row.previousClose ? Number(row.previousClose) : null,
      turnover: row.turnover ? Number(row.turnover) : null,
      stale,
      marketEventAt: eventAt
    },
    reason: null,
    provenance: storedProvenance(row.source, row.dataMode, stale),
    warnings: stale ? ['The most recent stored observation is stale; freshness is not guaranteed.'] : []
  };
}
