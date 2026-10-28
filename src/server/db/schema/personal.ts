/**
 * Per-user objects: watchlists, alerts, notification deliveries and paper portfolios.
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
  integer,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { securities } from './market.js';
import { createdAt, updatedAt } from './common.js';

export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: createdAt()
  },
  (t) => [index('watchlists_user_idx').on(t.userId)]
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('watchlist_security_uq').on(t.watchlistId, t.securityId)]
);

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id').references(() => securities.id),
    ruleType: varchar('rule_type', { length: 48 }).notNull(),
    configuration: jsonb('configuration').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('alert_rules_user_enabled_idx').on(t.userId, t.enabled)]
);

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    observedValue: jsonb('observed_value').notNull(),
    reason: text('reason').notNull(),
    source: text('source'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('alert_event_dedupe_uq').on(t.ruleId, t.dedupeKey),
    index('alert_events_created_idx').on(t.createdAt)
  ]
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertEventId: uuid('alert_event_id').references(() => alertEvents.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    error: text('error'),
    createdAt: createdAt()
  },
  (t) => [index('notification_delivery_queue_idx').on(t.status, t.nextAttemptAt)]
);

export const paperPortfolios = pgTable(
  'paper_portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('KES'),
    costAssumptions: jsonb('cost_assumptions'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('paper_portfolio_user_idx').on(t.userId)]
);

export const paperHoldings = pgTable(
  'paper_holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    quantity: numeric('quantity', { precision: 22, scale: 6 }).notNull(),
    averageCost: numeric('average_cost', { precision: 20, scale: 6 }),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex('paper_holding_portfolio_security_uq').on(t.portfolioId, t.securityId)]
);

export const paperTransactions = pgTable(
  'paper_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    side: varchar('side', { length: 8 }).notNull(),
    quantity: numeric('quantity', { precision: 22, scale: 6 }).notNull(),
    price: numeric('price', { precision: 20, scale: 6 }).notNull(),
    fees: numeric('fees', { precision: 20, scale: 6 }).notNull().default('0'),
    tradedAt: timestamp('traded_at', { withTimezone: true }).notNull(),
    createdAt: createdAt()
  },
  (t) => [index('paper_tx_portfolio_time_idx').on(t.portfolioId, t.tradedAt)]
);
