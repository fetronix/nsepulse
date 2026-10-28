/**
 * Platform bookkeeping: calendars, provider configuration, ingestion runs and audit trail.
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
  integer,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { createdAt, updatedAt } from './common.js';

export const marketCalendars = pgTable(
  'market_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exchange: varchar('exchange', { length: 16 }).notNull().default('NSE'),
    sessionDate: timestamp('session_date', { withTimezone: true }).notNull(),
    isTradingDay: boolean('is_trading_day').notNull(),
    openAt: timestamp('open_at', { withTimezone: true }),
    closeAt: timestamp('close_at', { withTimezone: true }),
    source: text('source').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('market_calendar_exchange_day_uq').on(t.exchange, t.sessionDate)]
);

export const dataProviderConfigs = pgTable(
  'data_provider_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    publicConfig: jsonb('public_config'),
    secretRef: text('secret_ref'),
    lastStatus: varchar('last_status', { length: 24 }).notNull().default('UNCONFIGURED'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex('provider_config_provider_uq').on(t.provider)]
);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobType: varchar('job_type', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 64 }),
    status: varchar('status', { length: 24 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    attempt: integer('attempt').notNull().default(0),
    metadata: jsonb('metadata'),
    createdAt: createdAt()
  },
  (t) => [index('ingestion_jobs_status_created_idx').on(t.status, t.createdAt)]
);

export const ingestionErrors = pgTable(
  'ingestion_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => ingestionJobs.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 64 }),
    code: varchar('code', { length: 80 }),
    message: text('message').notNull(),
    context: jsonb('context'),
    retryable: boolean('retryable').notNull().default(false),
    createdAt: createdAt()
  },
  (t) => [index('ingestion_errors_created_idx').on(t.createdAt)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: text('target_id'),
    requestId: text('request_id'),
    details: jsonb('details'),
    createdAt: createdAt()
  },
  (t) => [index('audit_actor_time_idx').on(t.actorUserId, t.createdAt)]
);
