import type { ProviderRegistry } from '../providers/types.js';
import { findSecurityBySymbol, latestObservation, historicalObservations, searchSecurities, counts } from '../db/repository.js';
import { isStale } from '../market/quality.js';
import { atr, ema, historicalVolatility, macd, rsi, sma } from '../market/indicators.js';

export class MarketService {
  constructor(private readonly providers: ProviderRegistry) {}
  async overview() {
    const stats = await counts();
    return { exchange: 'NSE', currency: 'KES', timezone: 'Africa/Nairobi', sessionStatus: 'UNKNOWN', sessionNote: 'Market calendar is not yet configured.', indices: [], breadth: null, mostActive: [], upcomingEvents: [], dataFreshness: { latestObservationAt: null, status: 'NO_DATA' }, counts: stats, providerStatuses: await this.providers.statuses(), disclaimer: 'Research and educational information only; not a personalized investment recommendation.' };
  }
  async securities(query: string, limit: number, offset: number) { return searchSecurities(query, limit, offset); }
  async quote(symbol: string) {
    const security = await findSecurityBySymbol(symbol);
    if (!security) return { security: null, observation: null, reason: 'Security not found in the configured security master.' };
    const row = await latestObservation(security.id);
    if (!row) return { security, observation: null, reason: 'No verified market observations are available.' };
    const eventAt = row.marketEventAt?.toISOString() ?? null;
    return { security, observation: { ...row, price: Number(row.price), volume: row.volume, open: row.open ? Number(row.open) : null, high: row.high ? Number(row.high) : null, low: row.low ? Number(row.low) : null, previousClose: row.previousClose ? Number(row.previousClose) : null, turnover: row.turnover ? Number(row.turnover) : null, stale: isStale(eventAt), marketEventAt: eventAt }, reason: null };
  }
  async technicals(symbol: string) {
    const security = await findSecurityBySymbol(symbol);
    if (!security) return { security: null, items: [], reason: 'Security not found in the configured security master.' };
    const to = new Date(); const from = new Date(to.getTime() - 4 * 366 * 24 * 60 * 60 * 1000);
    const rows = await historicalObservations(security.id, from, to, 1200);
    const candles = rows.map(r => ({ close: Number(r.close), high: r.high == null ? undefined : Number(r.high), low: r.low == null ? undefined : Number(r.low), volume: r.volume ?? undefined, timestamp: r.sessionDate.toISOString() }));
    const closes = candles.map(c => c.close);
    const usable = candles.filter(c => Number.isFinite(c.close) && c.close > 0);
    const latest = rows.at(-1);
    if (!usable.length) return { security: { id: security.id, symbol: security.symbol, name: security.name }, items: [], reason: 'No historical observations are available.' };
    return { security: { id: security.id, symbol: security.symbol, name: security.name }, inputThrough: latest?.sessionDate.toISOString() ?? null, observationCount: rows.length, items: [
      { name: 'SMA', period: 20, ...sma(closes, 20), definition: 'Arithmetic mean of the last 20 available observations.' },
      { name: 'SMA', period: 50, ...sma(closes, 50), definition: 'Arithmetic mean of the last 50 available observations.' },
      { name: 'SMA', period: 200, ...sma(closes, 200), definition: 'Arithmetic mean of the last 200 available observations.' },
      { name: 'EMA', period: 20, ...ema(closes, 20), definition: 'Exponentially weighted mean, SMA-seeded.' },
      { name: 'RSI', period: 14, ...rsi(closes, 14), definition: 'Wilder-smoothed relative strength index.' },
      { name: 'MACD', period: 12, ...macd(closes), definition: 'EMA(12) minus EMA(26), signal EMA(9).' },
      { name: 'ATR', period: 14, ...atr(candles, 14), definition: 'Wilder-smoothed true range; requires high/low/close.' },
      { name: 'HISTORICAL_VOLATILITY', period: closes.length - 1, ...historicalVolatility(closes), definition: 'Annualized sample standard deviation of log returns, 252 sessions/year.' }
    ], warnings: ['Indicators use observations in database order; this endpoint does not adjust prices for corporate actions unless the upstream historical series is marked accordingly.', 'Indicators describe history and are not guaranteed predictions.'] };
  }
  async history(symbol: string, from: Date, to: Date) {
    const security = await findSecurityBySymbol(symbol);
    if (!security) return { security: null, items: [], reason: 'Security not found in the configured security master.' };
    const rows = await historicalObservations(security.id, from, to);
    return { security: { id: security.id, symbol: security.symbol, name: security.name }, items: rows.map(r => ({ ...r, open: r.open ? Number(r.open) : null, high: r.high ? Number(r.high) : null, low: r.low ? Number(r.low) : null, close: Number(r.close), volume: r.volume })), reason: rows.length ? null : 'No historical observations are available.' };
  }
}
