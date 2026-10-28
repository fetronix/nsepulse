/**
 * Resolving Kenya's exchange code from Mansa's own exchange list.
 *
 * Mansa's OpenAPI describes the exchange record as a free-form object, so no field name is
 * assumed: several documented-style keys are tolerated, the country evidence is checked,
 * and whichever key produced the match is recorded as evidence. When nothing matches, the
 * documented `NSE` code is used and that fact is recorded too — a fallback is never
 * presented as a discovery.
 */
import type { MansaEnvelope } from './client.js';
import { describeKeys, extractRecords } from './normalize.js';

export interface ExchangeDiscovery {
  code: string;
  source: 'DISCOVERY' | 'DOCUMENTED_FALLBACK';
  evidence: string;
}

export const KENYA_MATCH_TERMS = ['kenya', 'nairobi', 'nse'];

/**
 * Pick the Kenya entry out of an exchange payload, or fall back to the documented code.
 * Pure and synchronous: the caller owns caching and the request itself.
 */
export function selectKenyaExchange(data: MansaEnvelope['data'], fallbackExchangeCode: string): ExchangeDiscovery {
  const records = extractRecords(data, ['exchanges']);
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const item = record as Record<string, unknown>;
    const code = [item.code, item.exchange, item.exchange_code, item.symbol].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    if (!code) continue;
    const haystack = [item.country, item.country_name, item.country_code, item.name, item.currency, code]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    const isKenya = haystack.includes('kenya') || haystack.includes('kes') || haystack.includes('nairobi');
    if (isKenya && KENYA_MATCH_TERMS.some((term) => haystack.includes(term))) {
      return {
        code: code.trim().toUpperCase(),
        source: 'DISCOVERY',
        evidence: `Matched from /api/v1/markets/exchanges using keys: ${describeKeys(item).join(', ')}`
      };
    }
  }

  return {
    code: fallbackExchangeCode.toUpperCase(),
    source: 'DOCUMENTED_FALLBACK',
    evidence:
      'The exchange list did not contain a Kenya entry this adapter could identify, so the documented exchange code was used.'
  };
}
