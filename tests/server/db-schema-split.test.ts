import { describe, expect, it } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../src/server/db/schema.js';

/**
 * The schema used to be a single 544-line module and was split into
 * `src/server/db/schema/<domain>.ts` behind a re-exporting barrel. Nothing about the
 * database may change because of how the source is arranged, so these tests pin the
 * contract the rest of the server relies on rather than the file layout.
 */
const byName = (a: string[], b: string[]): number => (a[0] ?? '').localeCompare(b[0] ?? '');

const EXPECTED_TABLES = {
  users: 'users',
  userPreferences: 'user_preferences',
  telegramAccounts: 'telegram_accounts',
  securities: 'securities',
  securityIdentifiers: 'security_identifiers',
  marketObservations: 'market_observations',
  historicalPrices: 'historical_prices',
  marketIndices: 'market_indices',
  companyProfiles: 'company_profiles',
  financialReports: 'financial_reports',
  financialMetrics: 'financial_metrics',
  dividendEvents: 'dividend_events',
  corporateActions: 'corporate_actions',
  newsSources: 'news_sources',
  newsArticles: 'news_articles',
  newsSecurityLinks: 'news_security_links',
  technicalIndicators: 'technical_indicators',
  researchScores: 'research_scores',
  watchlists: 'watchlists',
  watchlistItems: 'watchlist_items',
  alertRules: 'alert_rules',
  alertEvents: 'alert_events',
  notificationDeliveries: 'notification_deliveries',
  paperPortfolios: 'paper_portfolios',
  paperHoldings: 'paper_holdings',
  paperTransactions: 'paper_transactions',
  marketCalendars: 'market_calendars',
  dataProviderConfigs: 'data_provider_configs',
  ingestionJobs: 'ingestion_jobs',
  ingestionErrors: 'ingestion_errors',
  auditLogs: 'audit_logs'
} as const;

describe('database schema surface', () => {
  it('exports every table under the same name and SQL table name', () => {
    const exported = Object.entries(schema)
      .filter(([, value]) => is(value, PgTable))
      .map(([name, value]) => [name, getTableName(value as PgTable)])
      .sort(byName);

    const expected = Object.entries(EXPECTED_TABLES).sort(byName);
    expect(exported).toEqual(expected);
  });

  it('keeps market observations tied to the security master', () => {
    // The integrity rule the rest of the pipeline depends on: a price row without a
    // security is not expressible.
    expect(schema.marketObservations.securityId.notNull).toBe(true);
    expect(schema.marketObservations.securityId.name).toBe('security_id');
  });

  it('keeps the per-exchange symbol uniqueness constraint', () => {
    const { indexes, uniqueConstraints } = getTableConfig(schema.securities);
    const names = [...indexes.map((i) => i.config.name), ...uniqueConstraints.map((c) => c.name)];
    expect(names).toContain('securities_exchange_symbol_uq');
  });

  it('does not re-export anything that is not a table or a column helper', () => {
    const unexpected = Object.keys(schema).filter(
      (name) => !(name in EXPECTED_TABLES) && name !== 'createdAt' && name !== 'updatedAt'
    );
    expect(unexpected).toEqual([]);
  });
});
