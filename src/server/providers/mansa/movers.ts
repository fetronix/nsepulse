/**
 * Provider mover records → the shape the API and the bot render.
 *
 * Kept pure so the "absent field stays absent" rule can be tested directly: a missing price
 * becomes null instead of being derived from another field, and a record with no symbol is
 * dropped rather than labelled with a guess.
 */
import type { MoverQuote } from '../types.js';
import { deriveFreshness, toDate, toFiniteNumber } from './normalize.js';

export interface MoverMappingOptions {
  limit: number;
  now: Date;
}

export function toMoverQuotes(records: unknown[], { limit, now }: MoverMappingOptions): MoverQuote[] {
  const items: MoverQuote[] = [];
  for (const record of records.slice(0, limit)) {
    const item = (record ?? {}) as Record<string, unknown>;
    const symbol = [item.symbol, item.ticker, item.canonical_symbol].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    if (!symbol) continue;
    const price = toFiniteNumber(item.close ?? item.price ?? item.last_price);
    const changePercent = toFiniteNumber(item.change_percentage ?? item.change_pct ?? item.changePercentage);
    const observedAt = toDate(item.updated_at ?? item.currentDateTime ?? item.timestamp);
    const freshness = deriveFreshness(observedAt, now);
    items.push({
      symbol: symbol.trim().toUpperCase(),
      price: price !== null && price > 0 ? price : null,
      changePercent,
      currency: 'KES',
      marketEventAt: observedAt ? observedAt.toISOString() : null,
      dataMode: freshness.mode
    });
  }
  return items;
}
