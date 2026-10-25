import type { DataMode, MarketObservation, SecuritySummary } from '../../shared/domain.js';
import type { ProviderRegistry } from '../providers/types.js';
import {
  findSecurityBySymbol,
  latestObservation,
  historicalObservations,
  searchSecurities,
  counts
} from '../db/repository.js';
import { isStale } from '../market/quality.js';
import { atr, ema, historicalVolatility, macd, rsi, sma } from '../market/indicators.js';
import { DEMO_SOURCE_LABEL, demoFixtures, findDemoFixture } from '../providers/demo-fixtures.js';
import { ProviderRuntime } from '../providers/runtime.js';
import { providerSettingsFromEnv } from '../providers/settings.js';

export const DEMO_NOTICE = 'Demo fixture data — synthetic values, not NSE market data.';

export interface MarketServiceOptions {
  runtime?: ProviderRuntime;
  /** Operator attestation that written historical display permission is on file. */
  historicalPermissionConfirmed?: boolean;
}

function historicalPermission(confirmed: boolean) {
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

const DEMO_PERMISSION = {
  status: 'NOT_APPLICABLE' as const,
  basis: 'Demo fixtures are synthetic and are not sourced market data.'
};

type Provenance = {
  kind: 'DEMO_FIXTURE' | 'STORED_OBSERVATION' | 'UNAVAILABLE';
  label: string;
  liveQuoteAdapterEnabled: boolean;
  dataMode: DataMode;
  source: string | null;
  freshnessNote: string;
};

function demoProvenance(): Provenance {
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

function storedProvenance(source: string, dataMode: string, stale: boolean): Provenance {
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

function demoSecurity(symbol: string) {
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

interface TechnicalSeriesRow {
  sessionAt: Date;
  close: number;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export class MarketService {
  private readonly runtime: ProviderRuntime;
  private readonly historicalPermissionConfirmed: boolean;

  constructor(
    private readonly providers: ProviderRegistry,
    options: MarketServiceOptions = {}
  ) {
    this.runtime = options.runtime ?? new ProviderRuntime();
    this.historicalPermissionConfirmed =
      options.historicalPermissionConfirmed ?? providerSettingsFromEnv().historicalPermissionConfirmed;
  }

  private get demoActive(): boolean {
    return this.providers.primary.demo;
  }

  async overview() {
    const stats = await counts();
    const statuses = await this.providers.statuses();
    const liveQuoteAdapterEnabled = statuses.some((status) => status.state === 'READY' && status.configured);
    return {
      exchange: 'NSE',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
      sessionStatus: 'UNKNOWN',
      sessionNote: 'Market calendar is not yet configured.',
      indices: [],
      breadth: null,
      mostActive: [],
      upcomingEvents: [],
      dataFreshness: { latestObservationAt: null, status: 'NO_DATA' },
      counts: stats,
      providerStatuses: statuses,
      dataPolicy: {
        liveQuoteAdapterEnabled,
        demoMode: this.demoActive,
        demoNotice: this.demoActive ? DEMO_NOTICE : null,
        sourceLabels: {
          quotes: this.demoActive ? 'DEMO FIXTURE — synthetic values' : 'Stored observations only; no live feed',
          historical: 'Stored end-of-day records (source recorded per row)',
          announcements: 'Official announcements only when an enabled permitted source exists'
        },
        note: 'No price, index or market-depth value is simulated outside the explicitly labelled demo mode.'
      },
      disclaimer: 'Research and educational information only; not a personalized investment recommendation.'
    };
  }

  async securities(query: string, limit: number, offset: number) {
    if (this.demoActive) {
      const needle = query.trim().toUpperCase();
      const matches = demoFixtures.filter(
        (fixture) => !needle || fixture.symbol.includes(needle) || fixture.name.toUpperCase().includes(needle)
      );
      const items = matches.slice(offset, offset + limit).map((fixture) => ({
        id: `demo:${fixture.symbol}`,
        symbol: fixture.symbol,
        name: `${fixture.name} (demo)`,
        exchange: 'DEMO',
        instrumentType: 'DEMO_FIXTURE',
        listingStatus: 'DEMO_ONLY',
        sector: 'DEMO FIXTURE',
        demo: true
      }));
      return {
        items,
        total: matches.length,
        demo: true,
        note: 'Demo fixtures only — synthetic records, not a security master.'
      };
    }
    return searchSecurities(query, limit, offset);
  }

  async quote(symbol: string) {
    const provider = this.providers.primary;
    if (provider.demo) {
      const observation = await provider.getLatestQuote({ symbol });
      if (!observation) {
        this.runtime.recordRetrievalFailure(provider.id, `Demo fixture missing for ${symbol}`);
        return {
          security: null,
          observation: null,
          reason:
            'This symbol is not one of the demo fixtures. Demo mode never returns real securities, quotes or prices.',
          provenance: demoProvenance(),
          warnings: [DEMO_NOTICE]
        };
      }
      this.runtime.recordRetrievalSuccess(provider.id);
      return {
        security: demoSecurity(symbol),
        observation: { ...observation, stale: false },
        reason: null,
        provenance: demoProvenance(),
        warnings: [DEMO_NOTICE]
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

  async technicals(symbol: string) {
    if (this.demoActive) {
      const demoRows = await this.providers.primary.getHistory({
        symbol,
        from: new Date(0),
        to: new Date(),
        interval: '1d'
      });
      if (!demoRows.length) {
        return {
          security: null,
          items: [],
          reason: 'This symbol is not one of the demo fixtures, so no demo series exists.',
          provenance: demoProvenance(),
          warnings: [DEMO_NOTICE]
        };
      }
      const series = demoRows.map((row) => ({
        sessionAt: new Date(row.marketEventAt ?? row.ingestedAt),
        close: row.price,
        high: row.high ?? null,
        low: row.low ?? null,
        volume: row.volume ?? null
      }));
      return {
        ...this.technicalsFromSeries(demoSecurity(symbol), series, demoProvenance(), [
          DEMO_NOTICE,
          'Demo series are synthetic and too short for most indicator periods; blank indicator values are expected.'
        ]),
        permission: DEMO_PERMISSION
      };
    }

    const security = await findSecurityBySymbol(symbol);
    if (!security)
      return { security: null, items: [], reason: 'Security not found in the configured security master.' };
    const permission = historicalPermission(this.historicalPermissionConfirmed);
    if (!this.historicalPermissionConfirmed) {
      return {
        security: { id: security.id, symbol: security.symbol, name: security.name },
        inputThrough: null,
        observationCount: 0,
        items: [],
        reason:
          'Stored historical data is withheld: display permission is not recorded. Confirm written permission and set HISTORICAL_DATA_PERMISSION_CONFIRMED=true.',
        permission,
        provenance: null,
        warnings: []
      };
    }
    const to = new Date();
    const from = new Date(to.getTime() - 4 * 366 * 24 * 60 * 60 * 1000);
    const rows = await historicalObservations(security.id, from, to, 1200);
    const series: TechnicalSeriesRow[] = rows.map((row) => ({
      sessionAt: row.sessionDate,
      close: Number(row.close),
      high: row.high == null ? null : Number(row.high),
      low: row.low == null ? null : Number(row.low),
      volume: row.volume ?? null
    }));
    const latest = rows.at(-1);
    const warnings = [
      'Indicators use observations in database order; this endpoint does not adjust prices for corporate actions unless the upstream historical series is marked accordingly.',
      'Indicators describe history and are not guaranteed predictions.'
    ];
    const provenance: Provenance = {
      kind: 'STORED_OBSERVATION',
      label: 'Calculated from stored historical sessions (not a live feed)',
      liveQuoteAdapterEnabled: false,
      dataMode: (latest?.dataMode as DataMode) ?? 'END_OF_DAY',
      source: latest?.source ?? null,
      freshnessNote: 'Indicator inputs end at the latest stored session date shown below; nothing is projected forward.'
    };
    const result = this.technicalsFromSeries(
      { id: security.id, symbol: security.symbol, name: security.name },
      series,
      provenance,
      warnings
    );
    return {
      ...result,
      inputThrough: latest?.sessionDate.toISOString() ?? null,
      observationCount: rows.length,
      permission
    };
  }

  private technicalsFromSeries(
    security: Pick<SecuritySummary, 'id' | 'symbol' | 'name'>,
    series: TechnicalSeriesRow[],
    provenance: Provenance,
    warnings: string[]
  ) {
    const candles = series.map((row) => ({
      close: row.close,
      high: row.high ?? undefined,
      low: row.low ?? undefined,
      volume: row.volume ?? undefined,
      timestamp: row.sessionAt.toISOString()
    }));
    const closes = candles.map((candle) => candle.close);
    const usable = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
    if (!usable.length) {
      return {
        security: { id: security.id, symbol: security.symbol, name: security.name },
        inputThrough: series.at(-1)?.sessionAt.toISOString() ?? null,
        observationCount: series.length,
        items: [],
        reason: 'No historical observations are available.',
        provenance,
        warnings
      };
    }
    return {
      security: { id: security.id, symbol: security.symbol, name: security.name },
      inputThrough: series.at(-1)?.sessionAt.toISOString() ?? null,
      observationCount: series.length,
      items: [
        {
          name: 'SMA',
          period: 20,
          ...sma(closes, 20),
          definition: 'Arithmetic mean of the last 20 available observations.'
        },
        {
          name: 'SMA',
          period: 50,
          ...sma(closes, 50),
          definition: 'Arithmetic mean of the last 50 available observations.'
        },
        {
          name: 'SMA',
          period: 200,
          ...sma(closes, 200),
          definition: 'Arithmetic mean of the last 200 available observations.'
        },
        { name: 'EMA', period: 20, ...ema(closes, 20), definition: 'Exponentially weighted mean, SMA-seeded.' },
        { name: 'RSI', period: 14, ...rsi(closes, 14), definition: 'Wilder-smoothed relative strength index.' },
        { name: 'MACD', period: 12, ...macd(closes), definition: 'EMA(12) minus EMA(26), signal EMA(9).' },
        {
          name: 'ATR',
          period: 14,
          ...atr(candles, 14),
          definition: 'Wilder-smoothed true range; requires high/low/close.'
        },
        {
          name: 'HISTORICAL_VOLATILITY',
          period: closes.length - 1,
          ...historicalVolatility(closes),
          definition: 'Annualized sample standard deviation of log returns, 252 sessions/year.'
        }
      ],
      reason: null,
      provenance,
      warnings
    };
  }

  async history(symbol: string, from: Date, to: Date) {
    if (this.demoActive) {
      const rows = await this.providers.primary.getHistory({ symbol, from, to, interval: '1d' });
      if (!rows.length) {
        return {
          security: null,
          items: [],
          reason: 'This symbol is not one of the demo fixtures, or the requested window has no synthetic sessions.',
          provenance: demoProvenance(),
          warnings: [DEMO_NOTICE]
        };
      }
      return {
        security: demoSecurity(symbol),
        items: rows.map((row: MarketObservation) => ({
          id: `demo:${symbol}:${row.marketEventAt}`,
          sessionDate: row.marketEventAt,
          open: null,
          high: null,
          low: null,
          close: row.price,
          volume: row.volume ?? null,
          source: row.source,
          dataMode: row.dataMode,
          demo: true
        })),
        reason: null,
        permission: DEMO_PERMISSION,
        provenance: demoProvenance(),
        warnings: [DEMO_NOTICE]
      };
    }

    const security = await findSecurityBySymbol(symbol);
    if (!security)
      return { security: null, items: [], reason: 'Security not found in the configured security master.' };
    const permission = historicalPermission(this.historicalPermissionConfirmed);
    if (!this.historicalPermissionConfirmed) {
      return {
        security: { id: security.id, symbol: security.symbol, name: security.name },
        items: [],
        reason:
          'Stored historical data is withheld: display permission is not recorded. Confirm written permission and set HISTORICAL_DATA_PERMISSION_CONFIRMED=true.',
        permission,
        provenance: null,
        warnings: []
      };
    }
    const rows = await historicalObservations(security.id, from, to);
    const latest = rows.at(-1);
    return {
      security: { id: security.id, symbol: security.symbol, name: security.name },
      items: rows.map((row) => ({
        ...row,
        open: row.open ? Number(row.open) : null,
        high: row.high ? Number(row.high) : null,
        low: row.low ? Number(row.low) : null,
        close: Number(row.close),
        volume: row.volume
      })),
      reason: rows.length ? null : 'No historical observations are available.',
      permission,
      provenance: rows.length
        ? {
            kind: 'STORED_OBSERVATION' as const,
            label: 'Stored historical sessions (not a live feed)',
            liveQuoteAdapterEnabled: false,
            dataMode: (latest?.dataMode as DataMode) ?? 'END_OF_DAY',
            source: latest?.source ?? null,
            freshnessNote: `Series ends at ${latest?.sessionDate.toISOString() ?? 'an unknown date'}; adjusted for corporate actions: ${latest?.adjustedForCorporateActions ? 'yes' : 'no (as stored)'}.`
          }
        : null,
      warnings: [
        'Historical records are served independently of the live quote adapter and may be unavailable or unlicensed for redistribution.'
      ]
    };
  }
}
