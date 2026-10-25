import { desc, eq, ilike, or, and, gte, lte, count } from 'drizzle-orm';
import { getDatabase } from './client.js';
import { securities, marketObservations, historicalPrices, newsArticles, newsSources } from './schema.js';

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

export interface DataSnapshot {
  storeAvailable: boolean;
  securities: number | null;
  observations: number | null;
  historicalRows: number | null;
  latestObservationEventAt: string | null;
  latestObservationIngestedAt: string | null;
  latestHistoricalSessionDate: string | null;
}

/** Read-only persisted-data facts. Returns null counts when no database is configured. */
export async function dataSnapshot(): Promise<DataSnapshot> {
  const db = getDatabase();
  const empty: DataSnapshot = { storeAvailable: false, securities: null, observations: null, historicalRows: null, latestObservationEventAt: null, latestObservationIngestedAt: null, latestHistoricalSessionDate: null };
  if (!db) return empty;
  try {
    const [[s], [o], [h]] = await Promise.all([
      db.select({ value: count() }).from(securities),
      db.select({ value: count() }).from(marketObservations),
      db.select({ value: count() }).from(historicalPrices)
    ]);
    const [latestObservation] = await db.select({ marketEventAt: marketObservations.marketEventAt, ingestedAt: marketObservations.ingestedAt })
      .from(marketObservations).orderBy(desc(marketObservations.ingestedAt)).limit(1);
    const [latestHistorical] = await db.select({ sessionDate: historicalPrices.sessionDate })
      .from(historicalPrices).orderBy(desc(historicalPrices.sessionDate)).limit(1);
    return {
      storeAvailable: true,
      securities: s?.value ?? 0,
      observations: o?.value ?? 0,
      historicalRows: h?.value ?? 0,
      latestObservationEventAt: latestObservation?.marketEventAt?.toISOString() ?? null,
      latestObservationIngestedAt: latestObservation?.ingestedAt?.toISOString() ?? null,
      latestHistoricalSessionDate: latestHistorical?.sessionDate?.toISOString() ?? null
    };
  } catch {
    return empty;
  }
}

export interface StoredAnnouncement {
  id: string;
  title: string;
  publisher: string;
  originalUrl: string;
  publishedAt: Date | null;
  verified: boolean;
  sourceType: string;
}

/**
 * Issuer announcements already stored from a source an operator marked enabled.
 * Returns null when the database is unavailable, so callers can distinguish
 * "no permitted source" from "no storage".
 */
export async function listIssuerAnnouncements(limit = 25): Promise<StoredAnnouncement[] | null> {
  const db = getDatabase();
  if (!db) return null;
  const rows = await db.select({
    id: newsArticles.id,
    title: newsArticles.title,
    publisher: newsArticles.publisher,
    originalUrl: newsArticles.originalUrl,
    publishedAt: newsArticles.publishedAt,
    verified: newsArticles.verified,
    sourceType: newsSources.sourceType
  }).from(newsArticles)
    .innerJoin(newsSources, eq(newsArticles.sourceId, newsSources.id))
    .where(and(eq(newsSources.sourceType, 'ISSUER_ANNOUNCEMENT'), eq(newsSources.enabled, true)))
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);
  return rows;
}
