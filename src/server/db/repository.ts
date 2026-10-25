import { desc, eq, ilike, or, and, gte, lte, count } from 'drizzle-orm';
import { getDatabase } from './client.js';
import { securities, marketObservations, historicalPrices } from './schema.js';

export async function searchSecurities(query = '', limit = 25, offset = 0) {
  const db = getDatabase(); if (!db) return { items: [], total: null as number | null };
  const q = query.trim();
  const filters = q ? or(ilike(securities.symbol, `%${q}%`), ilike(securities.name, `%${q}%`)) : undefined;
  const rows = await db.select({ id: securities.id, symbol: securities.symbol, name: securities.name, exchange: securities.exchange, instrumentType: securities.instrumentType, listingStatus: securities.listingStatus, sector: securities.sector }).from(securities).where(filters).orderBy(securities.symbol).limit(limit).offset(offset);
  return { items: rows, total: null as number | null };
}
export async function findSecurityBySymbol(symbol: string) {
  const db = getDatabase(); if (!db) return null;
  const rows = await db.select().from(securities).where(eq(securities.symbol, symbol.toUpperCase())).limit(1);
  return rows[0] ?? null;
}
export async function latestObservation(securityId: string) {
  const db = getDatabase(); if (!db) return null;
  const rows = await db.select().from(marketObservations).where(eq(marketObservations.securityId, securityId)).orderBy(desc(marketObservations.marketEventAt), desc(marketObservations.ingestedAt)).limit(1);
  return rows[0] ?? null;
}
export async function historicalObservations(securityId: string, from: Date, to: Date, limit = 500) {
  const db = getDatabase(); if (!db) return [];
  return db.select().from(historicalPrices).where(and(eq(historicalPrices.securityId, securityId), gte(historicalPrices.sessionDate, from), lte(historicalPrices.sessionDate, to))).orderBy(historicalPrices.sessionDate).limit(limit);
}
export async function counts() {
  const db = getDatabase(); if (!db) return { securities: null, observations: null };
  const [s] = await db.select({ value: count() }).from(securities);
  const [o] = await db.select({ value: count() }).from(marketObservations);
  return { securities: s?.value ?? 0, observations: o?.value ?? 0 };
}
