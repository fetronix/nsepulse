import type { MarketObservation, ProviderCheck, ProviderStatus, ProviderTestResult } from '../../../shared/domain.js';
import { validateObservation } from '../../market/quality.js';
import type {
  HistoricalRequest,
  MarketDataProvider,
  MoversRequest,
  MoversSnapshot,
  ProviderCapabilities,
  ProviderSelfTest,
  QuoteRequest
} from '../types.js';
import { MansaClient, type MansaEnvelope } from './client.js';
import { describeMansaError, isMansaError, MansaError } from './errors.js';
import {
  describeKeys,
  extractRecords,
  MANSA_SOURCE_LABEL,
  normalizeStockRecord,
  toDate,
  toFiniteNumber
} from './normalize.js';
import { TtlCache } from './cache.js';
import { describeMansaStatus, mansaCapabilities } from './descriptor.js';
import { selectKenyaExchange, type ExchangeDiscovery } from './discovery.js';
import { toMoverQuotes } from './movers.js';
import { findSnapshotRecord } from './snapshot.js';

/**
 * Mansa API adapter (https://mansaapi.com/docs).
 *
 * Endpoint paths are taken verbatim from Mansa's published documentation; none is guessed:
 *   GET /api/v1/markets/exchanges                          (exchange discovery)
 *   GET /api/v1/markets/exchanges/{exchange_code}/stocks   (exchange stock list)
 *   GET /api/v1/markets/exchanges/{exchange_code}/stocks/{ticker}
 *   GET /api/v1/markets/exchanges/{exchange_code}/movers?type=&limit=
 *   GET /api/v1/markets/exchanges/{exchange_code}/stocks/{ticker}/history
 *   GET /health                                            (public, no key)
 *
 * Kenya's exchange code is discovered from `/markets/exchanges` at runtime; the documented
 * `NSE` code is used only as a fallback and the evidence for whichever was used is recorded.
 */

export interface MansaProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  dailyRequestBudget?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Documented fallback exchange code; used only when discovery cannot resolve Kenya. */
  fallbackExchangeCode?: string;
}

/** Discriminated union of everything this adapter caches. */
type CachedPayload =
  | { kind: 'quote'; record: unknown; exchange: ExchangeDiscovery }
  | { kind: 'movers'; envelope: MansaEnvelope; exchange: ExchangeDiscovery }
  | { kind: 'snapshot'; records: unknown[] };

export class MansaProvider implements MarketDataProvider {
  readonly id = 'mansa';
  readonly demo = false;
  readonly live = true;

  private readonly client: MansaClient;
  private readonly cache: TtlCache<CachedPayload>;
  private readonly now: () => Date;
  private readonly fallbackExchangeCode: string;
  private lastSuccessAt: Date | null = null;
  private lastFailure: string | null = null;
  private exchange: ExchangeDiscovery | null = null;

  constructor(options: MansaProviderOptions) {
    this.client = new MansaClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      dailyRequestBudget: options.dailyRequestBudget,
      fetchImpl: options.fetchImpl,
      now: options.now ? () => options.now!().getTime() : undefined
    });
    this.now = options.now ?? (() => new Date());
    this.fallbackExchangeCode = (options.fallbackExchangeCode ?? 'NSE').toUpperCase();
    this.cache = new TtlCache<CachedPayload>({
      ttlMs: options.cacheTtlMs ?? 5 * 60_000,
      now: options.now ? () => options.now!().getTime() : undefined
    });
  }

  get configured(): boolean {
    return this.client.configured;
  }

  /** Requests spent today out of the locally enforced budget. */
  usage() {
    return this.client.usage();
  }

  describeLastFailure(): string | null {
    return this.lastFailure;
  }

  capabilities(): ProviderCapabilities {
    return mansaCapabilities();
  }

  async status(): Promise<ProviderStatus> {
    return describeMansaStatus({
      configured: this.configured,
      displayName: mansaCapabilities().displayName,
      lastSuccessAt: this.lastSuccessAt,
      lastFailure: this.lastFailure
    });
  }

  /**
   * Discovery step. Mansa documents an exchange list; Kenya's code is read from it rather
   * than assumed. The response shape is not itemised field-by-field in the published
   * OpenAPI (the schema is a free-form object), so several documented-style keys are
   * tolerated and the chosen record is recorded as evidence.
   */
  async discoverExchange(): Promise<ExchangeDiscovery> {
    if (this.exchange) return this.exchange;
    const envelope = await this.client.get('/api/v1/markets/exchanges');
    this.exchange = selectKenyaExchange(envelope.data, this.fallbackExchangeCode);
    return this.exchange;
  }

  async getLatestQuote(request: QuoteRequest): Promise<MarketObservation | null> {
    const symbol = request.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,24}$/.test(symbol)) return null;
    try {
      const quote = await this.cache.getOrLoad(`quote:${symbol}`, async () => {
        const fromSnapshot = findSnapshotRecord(this.cachedRecords(), symbol);
        if (fromSnapshot) return { kind: 'quote' as const, record: fromSnapshot, exchange: this.exchange! };
        const exchange = await this.discoverExchange();
        const envelope = await this.client.get(
          `/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/stocks/${encodeURIComponent(symbol)}`
        );
        const record =
          Array.isArray(envelope.data) || envelope.data === null
            ? envelope.data
            : ((envelope.data as Record<string, unknown>).stock ??
              (envelope.data as Record<string, unknown>).quote ??
              envelope.data);
        return { kind: 'quote' as const, record, exchange };
      });
      if (quote.kind !== 'quote') return null;
      const result = normalizeStockRecord(quote.record, { requestedSymbol: symbol, now: this.now() });
      if (!result.ok) {
        this.lastFailure = result.reason;
        return null;
      }
      this.lastSuccessAt = this.now();
      this.lastFailure = null;
      return result.quote.observation;
    } catch (error) {
      this.lastFailure = describeMansaError(error);
      return null;
    }
  }

  /**
   * Warm cache with the whole exchange stock list (documented `limit` is capped at 200).
   * The scheduled job calls this once per refresh interval, and per-symbol quotes are then
   * answered from it without spending additional quota. Returns the number of records held.
   */
  async refreshSnapshot(limit = 200): Promise<number> {
    try {
      const exchange = await this.discoverExchange();
      const envelope = await this.client.get(`/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/stocks`, {
        limit
      });
      const records = extractRecords(envelope.data, ['stocks']);
      this.cache.set(`snapshot:${exchange.code}`, { kind: 'snapshot', records });
      this.lastSuccessAt = this.now();
      this.lastFailure = null;
      return records.length;
    } catch (error) {
      this.lastFailure = describeMansaError(error);
      throw error;
    }
  }

  /** Records already warmed for the exchange, without making a request. */
  cachedSnapshotSize(): number {
    return this.cachedRecords().length;
  }

  private cachedRecords(): unknown[] {
    if (!this.exchange) return [];
    const cached = this.cache.get(`snapshot:${this.exchange.code}`);
    return cached?.kind === 'snapshot' ? cached.records : [];
  }

  /** Full normalisation detail for the same request, used by diagnostics and tests. */
  async getQuoteDetail(request: QuoteRequest) {
    const exchange = await this.discoverExchange();
    const envelope = await this.client.get(
      `/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/stocks/${encodeURIComponent(request.symbol.toUpperCase())}`
    );
    const record =
      Array.isArray(envelope.data) || envelope.data === null
        ? envelope.data
        : ((envelope.data as Record<string, unknown>).stock ??
          (envelope.data as Record<string, unknown>).quote ??
          envelope.data);
    return {
      exchange,
      normalization: normalizeStockRecord(record, { requestedSymbol: request.symbol, now: this.now() })
    };
  }

  async getMovers(request: MoversRequest): Promise<MoversSnapshot | null> {
    const limit = Math.min(Math.max(request.limit ?? 5, 1), 20);
    try {
      const snapshot = await this.cache.getOrLoad(`movers:${request.type}:${limit}`, async () => {
        const exchange = await this.discoverExchange();
        const envelope = await this.client.get(
          `/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/movers`,
          { type: request.type, limit }
        );
        return { kind: 'movers' as const, envelope, exchange };
      });
      if (snapshot.kind !== 'movers') return null;
      this.lastSuccessAt = this.now();
      this.lastFailure = null;
      const now = this.now();
      const items = toMoverQuotes(extractRecords(snapshot.envelope.data, [request.type, 'movers']), {
        limit,
        now
      });
      return {
        type: request.type,
        items,
        retrievedAt: now.toISOString(),
        freshnessNote:
          'Movers are snapshots served within the cache window; Mansa documents a 30-minute freshness target during market hours, so they are delayed rather than real-time.'
      };
    } catch (error) {
      this.lastFailure = describeMansaError(error);
      return null;
    }
  }

  /**
   * History is documented as Pro plan and above. The request is attempted and a plan refusal
   * is reported as "unavailable" rather than being hidden or replaced with stored rows.
   */
  async getHistory(request: HistoricalRequest): Promise<Awaited<ReturnType<MarketDataProvider['getHistory']>>> {
    try {
      const exchange = await this.discoverExchange();
      const envelope = await this.client.get(
        `/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/stocks/${encodeURIComponent(
          request.symbol.toUpperCase()
        )}/history`,
        { from: request.from.toISOString().slice(0, 10), to: request.to.toISOString().slice(0, 10) }
      );
      const points = extractRecords((envelope.data as Record<string, unknown> | null)?.points ?? envelope.data, [
        'points'
      ]);
      const now = this.now();
      const rows: MarketObservation[] = [];
      for (const point of points) {
        const item = (point ?? {}) as Record<string, unknown>;
        const close = toFiniteNumber(item.close);
        const date = toDate(item.date);
        if (close === null || close <= 0 || !date) continue;
        const candidate = {
          securityId: `provider:mansa:nse:${request.symbol.toUpperCase()}`,
          symbol: request.symbol.toUpperCase(),
          price: close,
          currency: 'KES' as const,
          source: MANSA_SOURCE_LABEL,
          marketEventAt: date.toISOString(),
          publishedAt: null,
          ingestedAt: now.toISOString(),
          dataMode: 'END_OF_DAY' as const,
          volume: toFiniteNumber(item.volume),
          open: toFiniteNumber(item.open),
          high: toFiniteNumber(item.high),
          low: toFiniteNumber(item.low)
        };
        const quality = validateObservation(candidate, now);
        if (quality.accepted && quality.observation) rows.push(quality.observation);
      }
      this.lastSuccessAt = now;
      this.lastFailure = null;
      return rows;
    } catch (error) {
      this.lastFailure = describeMansaError(error);
      return [];
    }
  }

  /**
   * Explicit operator-triggered verification. This one *does* make outbound calls: a public
   * /health probe (no key, no quota) plus one authenticated exchange discovery + one stock
   * read. It never fabricates a pass — each check reports what actually happened.
   */
  async selfTest(now = this.now()): Promise<ProviderSelfTest> {
    const ranAt = now.toISOString();
    const connectionChecks: ProviderCheck[] = [];

    if (!this.configured) {
      const blocked: ProviderTestResult = {
        kind: 'CONNECTION',
        status: 'BLOCKED',
        summary: 'Connection test not attempted: MANSA_API_KEY is not configured.',
        ranAt,
        networkCallMade: false,
        checks: [
          { name: 'API key present', status: 'BLOCKED', detail: 'MANSA_API_KEY is empty, so no request is sent.' },
          { name: 'Base URL', status: 'BLOCKED', detail: 'Configuration is read from MANSA_API_BASE_URL.' }
        ]
      };
      return {
        connection: blocked,
        dataValidation: {
          kind: 'DATA_VALIDATION',
          status: 'BLOCKED',
          summary: 'Validation not attempted: no credential and no payload.',
          ranAt,
          networkCallMade: false,
          checks: [{ name: 'Provider payload', status: 'BLOCKED', detail: 'No request was made.' }]
        }
      };
    }

    let networkCallMade = false;
    try {
      const healthStart = Date.now();
      networkCallMade = true;
      const healthResponse = await this.client.fetchPublicHealth();
      connectionChecks.push({
        name: 'Platform health endpoint',
        status: healthResponse.ok ? 'PASSED' : 'FAILED',
        detail: `GET /health returned HTTP ${healthResponse.status} in ${Date.now() - healthStart} ms.`
      });
    } catch (error) {
      connectionChecks.push({
        name: 'Platform health endpoint',
        status: 'FAILED',
        detail: describeMansaError(error)
      });
    }

    let exchange: ExchangeDiscovery | null = null;
    try {
      this.exchange = null;
      exchange = await this.discoverExchange();
      connectionChecks.push({
        name: 'Authenticated exchange discovery',
        status: 'PASSED',
        detail: `Resolved Kenya exchange "${exchange.code}" (${exchange.source}).`
      });
    } catch (error) {
      connectionChecks.push({
        name: 'Authenticated exchange discovery',
        status: 'FAILED',
        detail: describeMansaError(error)
      });
    }

    const validationChecks: ProviderCheck[] = [];
    let dataValidationStatus: ProviderTestResult['status'] = 'BLOCKED';
    let dataValidationSummary = 'No instrument was read because discovery did not succeed.';
    if (exchange) {
      try {
        networkCallMade = true;
        const listEnvelope = await this.client.get(
          `/api/v1/markets/exchanges/${encodeURIComponent(exchange.code)}/stocks`,
          { limit: 1 }
        );
        const records = extractRecords(listEnvelope.data, ['stocks']);
        dataValidationStatus = records.length ? 'PASSED' : 'FAILED';
        dataValidationSummary = records.length
          ? `Read ${records.length} stock record(s) for ${exchange.code}; the payload keys were inspected, not inferred.`
          : `The ${exchange.code} stock list returned no records.`;
        validationChecks.push({
          name: 'Stock list payload',
          status: records.length ? 'PASSED' : 'FAILED',
          detail: records.length
            ? `Record keys observed: ${describeKeys(records[0]).join(', ') || 'none'}.`
            : 'The response contained no records.'
        });
        const first = records[0];
        if (first) {
          const candidateSymbol = [first as Record<string, unknown>]
            .flatMap((record) => [record.symbol, record.ticker, record.canonical_symbol])
            .find((value): value is string => typeof value === 'string' && value.length > 0);
          if (candidateSymbol) {
            const detail = await this.getQuoteDetail({ symbol: candidateSymbol });
            const normalization = detail.normalization;
            validationChecks.push({
              name: 'Quote normalisation',
              status: normalization.ok ? 'PASSED' : 'FAILED',
              detail: normalization.ok
                ? `Normalised ${candidateSymbol}: ${normalization.quote.observation.dataMode}, freshness ${normalization.quote.freshness.note}`
                : normalization.reason
            });
            if (!normalization.ok) dataValidationStatus = 'FAILED';
          } else {
            validationChecks.push({
              name: 'Quote normalisation',
              status: 'FAILED',
              detail: 'The stock list record exposed no ticker-bearing field this adapter recognises.'
            });
            dataValidationStatus = 'FAILED';
          }
        }
      } catch (error) {
        dataValidationStatus = 'FAILED';
        dataValidationSummary = `The stock list request failed: ${describeMansaError(error)}`;
        validationChecks.push({ name: 'Stock list payload', status: 'FAILED', detail: describeMansaError(error) });
      }
    }

    const connectionStatus: ProviderTestResult['status'] = connectionChecks.every((check) => check.status === 'PASSED')
      ? 'PASSED'
      : connectionChecks.some((check) => check.status === 'PASSED')
        ? 'FAILED'
        : 'FAILED';

    if (connectionStatus === 'PASSED') {
      this.lastSuccessAt = now;
      this.lastFailure = null;
    }

    return {
      connection: {
        kind: 'CONNECTION',
        status: connectionStatus,
        summary:
          connectionStatus === 'PASSED'
            ? `Authenticated Mansa requests succeeded; Kenya exchange code "${exchange?.code ?? 'unknown'}".`
            : 'At least one connection check failed; see the individual checks.',
        ranAt,
        networkCallMade,
        checks: connectionChecks
      },
      dataValidation: {
        kind: 'DATA_VALIDATION',
        status: dataValidationStatus,
        summary: dataValidationSummary,
        ranAt,
        networkCallMade,
        checks: validationChecks
      }
    };
  }
}

/** Re-exported so callers do not need to import from two modules. */
export { MansaError, isMansaError };
