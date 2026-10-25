import type { DataMode, MarketObservation } from '../../../shared/domain.js';
import { validateObservation } from '../../market/quality.js';

/**
 * Normalisation of Mansa stock payloads into the application's domain model.
 *
 * WHAT IS DOCUMENTED AND VERIFIED FROM MANSA'S OWN DOCUMENTATION
 *  - Envelope: `{ success, data, meta, pagination }` (openapi.json, every Markets path).
 *  - Auth: `Authorization: Bearer mansa_live_sk_...`; 401 codes MISSING_API_KEY /
 *    INVALID_API_KEY; 429 for the daily limit; free tier 100 requests/day.
 *  - Kenya's exchange code is `NSE` (documented "Exchange code such as NGX, GSE, NSE, ...").
 *  - Markets endpoints "target 30-minute freshness during market hours", so a successful
 *    response is never treated as real-time.
 *  - Per-stock history is Pro plan and above; `/stocks` and `/stocks/{ticker}` are quoted
 *    on the free tier.
 *
 * WHAT IS NOT DOCUMENTED
 *  The field names *inside* a stock record are not enumerated anywhere in the published
 *  docs: the OpenAPI schema for `data` is a free-form object, and the docs show worked
 *  examples for ETFs, indices, history and insider trades but not for `/stocks`.
 *
 *  Therefore the alias sets below are built from field names Mansa uses for the same
 *  instrument data elsewhere in its own Markets documentation (`symbol`, `name`,
 *  `currency`, `previous_close`, `open`, `high`, `low`, `close`, `change_percentage`,
 *  `volume`, `updated_at` / `currentDateTime`). They are a *tolerance* layer, not a claim
 *  about the contract: which alias actually matched is recorded on every observation as
 *  provenance, and `npm run mansa:probe` prints the real key names seen in a live response
 *  so this table can be replaced with verified fact.
 *
 *  A record that cannot supply a ticker and a positive numeric price is rejected rather
 *  than filled with defaults. No value is ever invented.
 */

const TICKER_KEYS = ['symbol', 'ticker', 'canonical_symbol', 'code'] as const;
const NAME_KEYS = ['name', 'company_name', 'company', 'legal_name', 'long_name'] as const;
const PRICE_KEYS = ['close', 'price', 'last_price', 'last', 'closing_price'] as const;
const CURRENCY_KEYS = ['currency', 'currency_code', 'quote_currency'] as const;
const PREVIOUS_CLOSE_KEYS = ['previous_close', 'prev_close', 'previousClose', 'previous'] as const;
const OPEN_KEYS = ['open', 'open_price'] as const;
const HIGH_KEYS = ['high', 'high_price', 'day_high'] as const;
const LOW_KEYS = ['low', 'low_price', 'day_low'] as const;
const VOLUME_KEYS = ['volume', 'volumes', 'shares_traded'] as const;
const TURNOVER_KEYS = ['value', 'turnover', 'turnover_value'] as const;
const CHANGE_PCT_KEYS = ['change_percentage', 'change_pct', 'changePercentage', 'percent_change'] as const;
const EVENT_AT_KEYS = [
  'updated_at',
  'currentDateTime',
  'as_of',
  'timestamp',
  'last_updated',
  'quote_time',
  'market_time'
] as const;
const PUBLISHED_AT_KEYS = ['published_at', 'publication_time'] as const;

export const MANSA_SOURCE_LABEL = 'Mansa API (mansaapi.com)';

/** Age at which a payload is no longer treated as the provider's current snapshot. */
export const MANSA_FRESHNESS_TARGET_MS = 30 * 60_000;
/** Tolerance for clock skew between this host and the provider before a timestamp is refused. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Age at which a stored/served quote is reported as stale. */
export const MANSA_STALE_AFTER_MS = 24 * 60 * 60_000;

export interface FieldEvidence {
  field: string;
  /** Which alias actually supplied the value, or null when nothing usable was found. */
  matched: string | null;
}

export interface NormalizedQuote {
  observation: MarketObservation;
  freshness: {
    mode: DataMode;
    ageMinutes: number | null;
    stale: boolean;
    note: string;
  };
  /** Field-by-field record of which documented alias matched. Never contains the API key. */
  evidence: FieldEvidence[];
  notes: string[];
}

export type NormalizeResult =
  { ok: true; quote: NormalizedQuote } | { ok: false; reason: string; missing: string[]; notes: string[] };

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pick(record: Record<string, unknown>, keys: readonly string[]): { value: unknown; matched: string | null } {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return { value: record[key], matched: key };
  }
  return { value: undefined, matched: null };
}

/** Parse a finite number from a number or a numeric string. Null otherwise. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim().replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Parse an ISO-8601 string or an epoch number (seconds or milliseconds). */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const fromNumber = new Date(ms);
    return Number.isFinite(fromNumber.getTime()) ? fromNumber : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value.trim());
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

/**
 * Map an observed timestamp to a data mode.
 *
 * Mansa documents a 30-minute freshness target during market hours, so a fresh payload is
 * `DELAYED` — never `REAL_TIME`. Older payloads have no documented per-record timing
 * semantics, so they are reported as `UNKNOWN` (with staleness stated) rather than being
 * promoted to end-of-day or refreshed-looking "live".
 */
export function deriveFreshness(
  observedAt: Date | null,
  now: Date
): { mode: DataMode; ageMinutes: number | null; stale: boolean; note: string } {
  if (!observedAt)
    return {
      mode: 'UNKNOWN',
      ageMinutes: null,
      stale: true,
      note: 'The provider payload carried no usable observation timestamp, so freshness cannot be asserted.'
    };
  const ageMs = now.getTime() - observedAt.getTime();
  const ageMinutes = Math.round(ageMs / 60_000);
  if (ageMs < 0)
    return {
      mode: 'UNKNOWN',
      ageMinutes,
      stale: true,
      note: 'The provider timestamp is in the future, so the record is treated as unusable for freshness claims.'
    };
  if (ageMs <= MANSA_FRESHNESS_TARGET_MS)
    return {
      mode: 'DELAYED',
      ageMinutes,
      stale: false,
      note: 'Within Mansa’s documented 30-minute freshness target during market hours. This is delayed data, not real-time.'
    };
  if (ageMs <= MANSA_STALE_AFTER_MS)
    return {
      mode: 'UNKNOWN',
      ageMinutes,
      stale: false,
      note: 'Older than the documented 30-minute freshness target. Data mode cannot be asserted from the payload.'
    };
  return {
    mode: 'UNKNOWN',
    ageMinutes,
    stale: true,
    note: 'Older than 24 hours; treat as historical rather than a current quote.'
  };
}

export interface NormalizeOptions {
  requestedSymbol: string;
  now?: Date;
  ingestedAt?: Date;
  source?: string;
}

/**
 * Normalise one Mansa stock record.
 *
 * Fails closed: a missing ticker, an unusable price, a non-KES currency or a ticker that
 * does not match the request all produce a rejection with reasons instead of a quote.
 */
export function normalizeStockRecord(input: unknown, options: NormalizeOptions): NormalizeResult {
  const now = options.now ?? new Date();
  const ingestedAt = options.ingestedAt ?? now;
  const notes: string[] = [];
  const evidence: FieldEvidence[] = [];
  const record = recordOf(input);
  if (!record) return { ok: false, reason: 'The stock payload is not an object.', missing: [], notes };

  const ticker = pick(record, TICKER_KEYS);
  const price = pick(record, PRICE_KEYS);
  const currency = pick(record, CURRENCY_KEYS);
  const name = pick(record, NAME_KEYS);
  const previousClose = pick(record, PREVIOUS_CLOSE_KEYS);
  const open = pick(record, OPEN_KEYS);
  const high = pick(record, HIGH_KEYS);
  const low = pick(record, LOW_KEYS);
  const volume = pick(record, VOLUME_KEYS);
  const turnover = pick(record, TURNOVER_KEYS);
  const changePct = pick(record, CHANGE_PCT_KEYS);
  const eventAt = pick(record, EVENT_AT_KEYS);
  const publishedAt = pick(record, PUBLISHED_AT_KEYS);

  for (const [field, selected] of [
    ['symbol', ticker],
    ['price', price],
    ['currency', currency],
    ['name', name],
    ['previousClose', previousClose],
    ['open', open],
    ['high', high],
    ['low', low],
    ['volume', volume],
    ['turnover', turnover],
    ['changePercent', changePct],
    ['marketEventAt', eventAt],
    ['publishedAt', publishedAt]
  ] as const)
    evidence.push({ field, matched: selected.matched });

  const missing: string[] = [];
  const symbol = typeof ticker.value === 'string' ? ticker.value.trim() : '';
  if (!symbol) missing.push('ticker');
  const priceValue = toFiniteNumber(price.value);
  if (priceValue === null) missing.push('price');
  const volumeValue = toFiniteNumber(volume.value);
  if (volumeValue !== null && volumeValue < 0) missing.push('volume');

  if (missing.length)
    return {
      ok: false,
      reason: `The provider record did not contain a usable ${missing.join(' or ')}; no quote was produced.`,
      missing,
      notes
    };

  const requested = options.requestedSymbol.trim().toUpperCase();
  if (symbol.toUpperCase() !== requested)
    return {
      ok: false,
      reason: `The provider returned "${symbol}" when "${requested}" was requested; the record was rejected rather than relabelled.`,
      missing: [],
      notes
    };

  const currencyCode = typeof currency.value === 'string' ? currency.value.trim().toUpperCase() : '';
  if (currencyCode && currencyCode !== 'KES')
    return {
      ok: false,
      reason: `The provider reported currency ${currencyCode}; this deployment only serves KES instruments and will not convert.`,
      missing: [],
      notes
    };
  if (!currencyCode)
    notes.push('The provider record carried no currency; KES was applied from the instrument request.');

  const observedAt = toDate(eventAt.value);
  const published = toDate(publishedAt.value);
  // A provider timestamp ahead of our clock beyond ordinary skew cannot be trusted for any
  // freshness claim, so the record is refused rather than shown with a future timestamp.
  if (observedAt && observedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS)
    return {
      ok: false,
      reason:
        'The provider observation timestamp is in the future beyond acceptable clock skew, so the record was rejected.',
      missing: [],
      notes
    };
  const freshness = deriveFreshness(observedAt, now);

  const numeric = (value: unknown): number | null => {
    const parsed = toFiniteNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  };
  const changePercentValue = toFiniteNumber(changePct.value);
  const derivedChange =
    changePercentValue !== null
      ? changePercentValue
      : numeric(previousClose.value) !== null
        ? Number((((priceValue! - numeric(previousClose.value)!) / numeric(previousClose.value)!) * 100).toFixed(4))
        : null;
  if (changePercentValue === null && derivedChange !== null)
    notes.push(
      'Percentage change was derived from price and previous close because the provider supplied no change field.'
    );

  const candidate = {
    securityId: `provider:mansa:nse:${symbol.toUpperCase()}`,
    symbol: symbol.toUpperCase(),
    // Company name is carried in notes only when the provider supplied one; the domain
    // observation type has no name field and inventing one would be misleading.
    price: priceValue!,
    currency: 'KES' as const,
    source: options.source ?? MANSA_SOURCE_LABEL,
    marketEventAt: observedAt ? observedAt.toISOString() : null,
    publishedAt: published ? published.toISOString() : null,
    ingestedAt: ingestedAt.toISOString(),
    dataMode: freshness.mode,
    volume: volumeValue !== null && volumeValue >= 0 ? volumeValue : null,
    previousClose: numeric(previousClose.value),
    open: numeric(open.value),
    high: numeric(high.value),
    low: numeric(low.value),
    turnover: toFiniteNumber(turnover.value),
    changePercent: derivedChange
  };

  const quality = validateObservation(candidate, now);
  if (!quality.accepted || !quality.observation)
    return {
      ok: false,
      reason: `The provider record failed validation: ${quality.reasons.join('; ')}.`,
      missing: [],
      notes
    };

  if (typeof name.value === 'string' && name.value.trim()) notes.push(`Provider company name: ${name.value.trim()}.`);

  return {
    ok: true,
    quote: {
      observation: quality.observation,
      freshness,
      evidence,
      notes: [
        ...notes,
        `Field aliases used: ${
          evidence
            .filter((item) => item.matched)
            .map((item) => `${item.field}=${item.matched}`)
            .join(', ') || 'none'
        }.`
      ]
    }
  };
}

/** Extract a list of records from `data` when it is either an array or wraps one. */
export function extractRecords(data: unknown, wrapperKeys: readonly string[] = []): unknown[] {
  if (Array.isArray(data)) return data;
  const record = recordOf(data);
  if (!record) return [];
  for (const key of [...wrapperKeys, 'items', 'results', 'stocks', 'data']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/** Report the top-level keys of a record, for the probe script and diagnostics. */
export function describeKeys(value: unknown): string[] {
  const record = recordOf(value);
  return record ? Object.keys(record).sort() : [];
}
