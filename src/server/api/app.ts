import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { databaseHealth } from '../db/client.js';
import { createProviderSelection } from '../providers/factory.js';
import { ProviderRuntime } from '../providers/runtime.js';
import { providerSettingsFromEnv } from '../providers/settings.js';
import { MarketService } from '../services/market.js';
import { ProviderConfigurationService } from '../services/provider-config.js';
import { DataSourceService } from '../services/data-sources.js';
import { openApi } from './openapi.js';

export interface AppOptions {
  /** Override provider selection (tests). Defaults to the environment-derived selection. */
  selection?: ReturnType<typeof createProviderSelection>;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const selection = options.selection ?? createProviderSelection(providerSettingsFromEnv());
  const runtime = new ProviderRuntime();
  const market = new MarketService(selection.registry, {
    runtime,
    historicalPermissionConfirmed: selection.settings.historicalPermissionConfirmed
  });
  const providerConfiguration = new ProviderConfigurationService(selection, runtime);
  const dataSources = new DataSourceService(selection.settings, selection);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.APP_ORIGIN, credentials: false, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  const testLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

  app.get('/api/v1/health', async (_req, res) => {
    const db = await databaseHealth();
    const providerStatuses = await selection.registry.statuses();
    const status = db.configured && !db.reachable ? 'degraded' : 'ok';
    res.status(200).json({
      status,
      version: '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      timezone: 'Africa/Nairobi',
      database: db,
      providers: providerStatuses,
      demoMode: selection.provider.demo,
      liveQuoteAdapterEnabled: providerStatuses.some(
        (providerStatus) => providerStatus.state === 'READY' && providerStatus.configured
      ),
      note: 'Provider status reports application wiring only; it is not evidence of market-data entitlement or availability.'
    });
  });
  app.get('/api/v1/docs', (_req, res) => res.json(openApi));

  app.get('/api/v1/providers', async (_req, res) => res.json({ items: await selection.registry.statuses() }));

  /** Full commissioning view: credentials (presence only), coverage, access level, tests, licensing. */
  app.get('/api/v1/providers/configuration', async (_req, res, next) => {
    try {
      res.json(await providerConfiguration.view());
    } catch (error) {
      next(error);
    }
  });

  /** Local adapter checks only. No outbound request is made for the bundled adapters. */
  app.post('/api/v1/providers/test', testLimiter, async (_req, res, next) => {
    try {
      const configurationView = await providerConfiguration.runTests();
      res.json({
        ranAt: configurationView.generatedAt,
        networkAccessAttempted: false,
        configuration: configurationView
      });
    } catch (error) {
      next(error);
    }
  });

  /** Every source carries its own permission and freshness label. */
  app.get('/api/v1/data-sources', async (_req, res, next) => {
    try {
      res.json(await dataSources.list());
    } catch (error) {
      next(error);
    }
  });

  /** Official announcements from an enabled, permitted source; never scraped. */
  app.get('/api/v1/announcements', async (req, res, next) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(50).default(25) }).safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    try {
      res.json(await dataSources.announcements(parsed.data.limit));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/market/overview', async (_req, res, next) => {
    try {
      res.json(await market.overview());
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/v1/securities', async (req, res, next) => {
    const parsed = z
      .object({
        q: z.string().max(100).optional().default(''),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(100_000).default(0)
      })
      .safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    try {
      res.json(await market.securities(parsed.data.q, parsed.data.limit, parsed.data.offset));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/v1/quotes/:symbol', async (req, res, next) => {
    const symbol = z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,24}$/)
      .safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: 'Invalid symbol format' });
    try {
      const result = await market.quote(symbol.data.toUpperCase());
      res.status(result.security ? 200 : 404).json(result);
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/v1/technicals/:symbol', async (req, res, next) => {
    const symbol = z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,24}$/)
      .safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: 'Invalid symbol format' });
    try {
      const result = await market.technicals(symbol.data.toUpperCase());
      res.status(result.security ? 200 : 404).json(result);
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/v1/history/:symbol', async (req, res, next) => {
    const parsed = z
      .object({
        symbol: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9.-]{1,24}$/),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional()
      })
      .safeParse({ ...req.query, symbol: req.params.symbol });
    if (!parsed.success) return res.status(400).json({ error: 'Invalid symbol or date range' });
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    if (from > to) return res.status(400).json({ error: '`from` must be on or before `to`' });
    try {
      res.json(await market.history(parsed.data.symbol.toUpperCase(), from, to));
    } catch (error) {
      next(error);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  const errorHandler: ErrorRequestHandler = (_err, _req, res, _next) =>
    res.status(500).json({ error: 'Internal server error' });
  app.use(errorHandler);
  return app;
}
