/**
 * The security master and its time-stamped observations: the core of the data model.
 *
 * Split out of the single schema module so each domain can be read on its own.
 * `src/server/db/schema.ts` re-exports everything, so existing imports keep working and
 * drizzle-kit still sees one schema file.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  numeric,
  bigint,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './common.js';

export const securities = pgTable(
  'securities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    name: text('name').notNull(),
    exchange: varchar('exchange', { length: 16 }).notNull().default('NSE'),
    listingStatus: varchar('listing_status', { length: 24 }).notNull().default('UNKNOWN'),
    instrumentType: varchar('instrument_type', { length: 32 }).notNull().default('UNKNOWN'),
    sector: text('sector'),
    industry: text('industry'),
    currency: varchar('currency', { length: 3 }).notNull().default('KES'),
    listedAt: timestamp('listed_at', { withTimezone: true }),
    delistedAt: timestamp('delisted_at', { withTimezone: true }),
    source: text('source'),
    sourceVerifiedAt: timestamp('source_verified_at', { withTimezone: true }),
    reviewRequired: boolean('review_required').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex('securities_exchange_symbol_uq').on(t.exchange, t.symbol),
    index('securities_status_idx').on(t.listingStatus)
  ]
);

export const securityIdentifiers = pgTable(
  'security_identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id, { onDelete: 'cascade' }),
    scheme: varchar('scheme', { length: 40 }).notNull(),
    value: varchar('value', { length: 128 }).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    source: text('source'),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('security_identifiers_scheme_value_uq').on(t.scheme, t.value),
    index('security_identifiers_security_idx').on(t.securityId)
  ]
);

export const marketObservations = pgTable(
  'market_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    price: numeric('price', { precision: 20, scale: 6 }).notNull(),
    open: numeric('open', { precision: 20, scale: 6 }),
    high: numeric('high', { precision: 20, scale: 6 }),
    low: numeric('low', { precision: 20, scale: 6 }),
    previousClose: numeric('previous_close', { precision: 20, scale: 6 }),
    volume: bigint('volume', { mode: 'number' }),
    turnover: numeric('turnover', { precision: 24, scale: 4 }),
    currency: varchar('currency', { length: 3 }).notNull().default('KES'),
    source: text('source').notNull(),
    marketEventAt: timestamp('market_event_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    dataMode: varchar('data_mode', { length: 16 }).notNull().default('UNKNOWN'),
    validationStatus: varchar('validation_status', { length: 16 }).notNull().default('UNVERIFIED'),
    validationNotes: jsonb('validation_notes'),
    revisionOf: uuid('revision_of'),
    rawPayload: jsonb('raw_payload')
  },
  (t) => [
    index('market_obs_security_event_idx').on(t.securityId, t.marketEventAt),
    index('market_obs_ingested_idx').on(t.ingestedAt),
    uniqueIndex('market_obs_dedupe_uq').on(t.securityId, t.source, t.marketEventAt, t.price)
  ]
);

export const historicalPrices = pgTable(
  'historical_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    sessionDate: timestamp('session_date', { withTimezone: true }).notNull(),
    open: numeric('open', { precision: 20, scale: 6 }),
    high: numeric('high', { precision: 20, scale: 6 }),
    low: numeric('low', { precision: 20, scale: 6 }),
    close: numeric('close', { precision: 20, scale: 6 }).notNull(),
    volume: bigint('volume', { mode: 'number' }),
    source: text('source').notNull(),
    dataMode: varchar('data_mode', { length: 16 }).notNull().default('END_OF_DAY'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    adjustedForCorporateActions: boolean('adjusted_for_corporate_actions').notNull().default(false)
  },
  (t) => [
    uniqueIndex('historical_security_day_source_uq').on(t.securityId, t.sessionDate, t.source),
    index('historical_security_date_idx').on(t.securityId, t.sessionDate)
  ]
);

export const marketIndices = pgTable(
  'market_indices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    value: numeric('value', { precision: 20, scale: 6 }).notNull(),
    change: numeric('change', { precision: 20, scale: 6 }),
    changePercent: numeric('change_percent', { precision: 12, scale: 6 }),
    source: text('source').notNull(),
    marketEventAt: timestamp('market_event_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    dataMode: varchar('data_mode', { length: 16 }).notNull().default('UNKNOWN')
  },
  (t) => [index('market_indices_code_time_idx').on(t.code, t.marketEventAt)]
);
