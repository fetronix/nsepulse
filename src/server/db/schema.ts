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

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash'),
    role: varchar('role', { length: 24 }).notNull().default('USER'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)]
);
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  timezone: varchar('timezone', { length: 80 }).notNull().default('Africa/Nairobi'),
  currency: varchar('currency', { length: 3 }).notNull().default('KES'),
  quietHours: jsonb('quiet_hours'),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  updatedAt: updatedAt()
});
export const telegramAccounts = pgTable(
  'telegram_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramUserId: varchar('telegram_user_id', { length: 32 }).notNull(),
    chatId: varchar('chat_id', { length: 32 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('telegram_accounts_user_uq').on(t.userId),
    uniqueIndex('telegram_accounts_tg_uq').on(t.telegramUserId)
  ]
);
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
