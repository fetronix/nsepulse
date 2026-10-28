/**
 * Descriptive and derived research attached to a security (profiles, filings, news, indicators).
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
  integer,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { securities } from './market.js';
import { createdAt } from './common.js';

export const companyProfiles = pgTable(
  'company_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    description: text('description'),
    sharesOutstanding: bigint('shares_outstanding', { mode: 'number' }),
    shareCountAsOf: timestamp('share_count_as_of', { withTimezone: true }),
    source: text('source'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt()
  },
  (t) => [index('company_profiles_security_idx').on(t.securityId)]
);

export const financialReports = pgTable(
  'financial_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reportType: varchar('report_type', { length: 32 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('KES'),
    unit: varchar('unit', { length: 32 }).notNull().default('KES'),
    sourceUrl: text('source_url').notNull(),
    restatesReportId: uuid('restates_report_id'),
    createdAt: createdAt()
  },
  (t) => [index('financial_reports_security_period_idx').on(t.securityId, t.periodEnd)]
);

export const financialMetrics = pgTable(
  'financial_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => financialReports.id, { onDelete: 'cascade' }),
    metric: varchar('metric', { length: 80 }).notNull(),
    value: numeric('value', { precision: 28, scale: 8 }),
    unit: varchar('unit', { length: 32 }).notNull(),
    isCalculated: boolean('is_calculated').notNull().default(false),
    formula: text('formula'),
    source: text('source'),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('financial_metric_report_name_uq').on(t.reportId, t.metric)]
);

export const dividendEvents = pgTable(
  'dividend_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    amountPerShare: numeric('amount_per_share', { precision: 20, scale: 8 }),
    currency: varchar('currency', { length: 3 }).notNull().default('KES'),
    classification: varchar('classification', { length: 24 }).notNull(),
    declarationDate: timestamp('declaration_date', { withTimezone: true }),
    recordDate: timestamp('record_date', { withTimezone: true }),
    exDividendDate: timestamp('ex_dividend_date', { withTimezone: true }),
    paymentDate: timestamp('payment_date', { withTimezone: true }),
    status: varchar('status', { length: 24 }).notNull(),
    sourceUrl: text('source_url').notNull(),
    source: text('source').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [index('dividend_security_payment_idx').on(t.securityId, t.paymentDate)]
);

export const corporateActions = pgTable(
  'corporate_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    actionType: varchar('action_type', { length: 48 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    announcementDate: timestamp('announcement_date', { withTimezone: true }),
    effectiveDate: timestamp('effective_date', { withTimezone: true }),
    sourceUrl: text('source_url').notNull(),
    source: text('source').notNull(),
    details: jsonb('details'),
    createdAt: createdAt()
  },
  (t) => [index('corporate_security_date_idx').on(t.securityId, t.effectiveDate)]
);

export const newsSources = pgTable('news_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  feedUrl: text('feed_url'),
  termsUrl: text('terms_url'),
  enabled: boolean('enabled').notNull().default(false),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: createdAt()
});

export const newsArticles = pgTable(
  'news_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => newsSources.id),
    originalUrl: text('original_url').notNull(),
    title: text('title').notNull(),
    publisher: text('publisher').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    summary: text('summary'),
    classification: varchar('classification', { length: 48 }),
    materiality: varchar('materiality', { length: 24 }),
    sentiment: varchar('sentiment', { length: 16 }),
    summaryModel: text('summary_model'),
    verified: boolean('verified').notNull().default(false),
    duplicateOf: uuid('duplicate_of'),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('news_original_url_uq').on(t.originalUrl), index('news_published_idx').on(t.publishedAt)]
);

export const newsSecurityLinks = pgTable(
  'news_security_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => newsArticles.id, { onDelete: 'cascade' }),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    reviewed: boolean('reviewed').notNull().default(false)
  },
  (t) => [uniqueIndex('news_link_pair_uq').on(t.articleId, t.securityId)]
);

export const technicalIndicators = pgTable(
  'technical_indicators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .notNull()
      .references(() => securities.id),
    name: varchar('name', { length: 32 }).notNull(),
    period: integer('period').notNull(),
    value: numeric('value', { precision: 24, scale: 10 }),
    inputThrough: timestamp('input_through', { withTimezone: true }),
    methodology: text('methodology').notNull(),
    source: text('source').notNull(),
    reliability: varchar('reliability', { length: 16 }).notNull(),
    createdAt: createdAt()
  },
  (t) => [index('technical_security_name_time_idx').on(t.securityId, t.name, t.inputThrough)]
);

export const researchScores = pgTable('research_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  securityId: uuid('security_id')
    .notNull()
    .references(() => securities.id),
  components: jsonb('components').notNull(),
  weights: jsonb('weights').notNull(),
  total: numeric('total', { precision: 7, scale: 3 }),
  methodologyVersion: varchar('methodology_version', { length: 32 }).notNull(),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  dataCompleteness: numeric('data_completeness', { precision: 5, scale: 4 })
});
