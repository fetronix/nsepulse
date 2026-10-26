import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { config } from '../config.js';
import { databaseHealth } from '../db/client.js';
import { classifyDatabaseError, httpStatusForDatabaseError } from '../db/errors.js';
import { logger } from '../logging/logger.js';
import { livenessReport, readinessReport } from '../services/health.js';
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
  /** Disable request logging (tests). */
  quiet?: boolean;
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
  app.set('trust proxy', 'loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  /**
   * Request correlation and structured access logs.
   *
   * A caller-supplied request id is echoed only when it looks like a UUID; anything else
   * is replaced to keep logs unambiguous. Route templates are logged instead of raw paths
   * so identifiers do not leak into log fields.
   */
  const correlation: RequestHandler = (req, res, next) => {
    const supplied = req.header('x-request-id');
    const requestId = supplied && /^[0-9a-f-]{16,64}$/i.test(supplied) ? supplied : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  };
  app.use(correlation);
  if (!options.quiet) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (_req: IncomingMessage, res: ServerResponse) => String(res.getHeader('x-request-id') ?? 'unknown'),
        autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/v1/health/live' },
        customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
          `${req.method} ${req.url?.split('?')[0] ?? ''} ${res.statusCode}`,
        customErrorMessage: (req: IncomingMessage, res: ServerResponse) =>
          `${req.method} ${req.url?.split('?')[0] ?? ''} ${res.statusCode}`,
        serializers: {
          // Paths are logged without query strings; no headers, cookies or bodies are kept.
          req: (req: IncomingMessage) => ({
            method: req.method,
            path: req.url?.split('?')[0],
            correlationId: (req as IncomingMessage & { id?: string }).id
          }),
          res: (res: ServerResponse) => ({ statusCode: res.statusCode })
        }
      })
    );
  }
  app.use(cors({ origin: config.APP_ORIGIN, credentials: false, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  const testLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

  /** Liveness: process is up. Never depends on the database or a provider. */
  app.get('/api/v1/health/live', (_req, res) => {
    res.status(200).json(livenessReport());
  });

  /** Readiness: can this instance serve honest responses right now? */
  app.get('/api/v1/health/ready', async (_req, res, next) => {
    try {
      const report = await readinessReport(selection.registry);
      res.status(report.status === 'not_ready' ? 503 : 200).json(report);
    } catch (error) {
      next(error);
    }
  });

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
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
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
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
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
    if (!symbol.success) {
      res.status(400).json({ error: 'Invalid symbol format' });
      return;
    }
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
    if (!symbol.success) {
      res.status(400).json({ error: 'Invalid symbol format' });
      return;
    }
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
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid symbol or date range' });
      return;
    }
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    if (from > to) {
      res.status(400).json({ error: '`from` must be on or before `to`' });
      return;
    }
    try {
      res.json(await market.history(parsed.data.symbol.toUpperCase(), from, to));
    } catch (error) {
      next(error);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  /**
   * Central error mapping.
   *
   * A database failure is a storage problem, not an application bug, and the operator can fix
   * it — so it is answered with 503 and a hint (usually "run the migrations") instead of a bare
   * 500. The driver's own message is logged from the `cause` chain, because Drizzle's wrapper
   * says only "Failed query: …" and carries no stack.
   */
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    const databaseError = classifyDatabaseError(error);
    const isDatabaseFailure = databaseError.kind !== 'UNKNOWN';
    const route = req.baseUrl + (req.route?.path ?? '');

    logger.error(
      {
        module: 'api',
        correlationId: res.locals.requestId,
        method: req.method,
        route,
        ...(isDatabaseFailure
          ? {
              databaseError: {
                kind: databaseError.kind,
                code: databaseError.code,
                message: databaseError.message,
                object: databaseError.object
              }
            }
          : {}),
        err: error instanceof Error ? { name: error.name, message: error.message } : { message: 'unknown error' }
      },
      isDatabaseFailure ? 'database_request_failed' : 'unhandled_request_error'
    );

    if (isDatabaseFailure) {
      res.status(httpStatusForDatabaseError(databaseError.kind)).json({
        error:
          databaseError.kind === 'SCHEMA_MISSING'
            ? 'The database schema is not initialised'
            : databaseError.kind === 'AUTH'
              ? 'The database rejected the configured credentials'
              : databaseError.kind === 'PERMISSION'
                ? 'The database user lacks permission for this operation'
                : 'The database is unavailable',
        detail: databaseError.message,
        hint: databaseError.hint,
        correlationId: res.locals.requestId
      });
      return;
    }

    res.status(500).json({ error: 'Internal server error', correlationId: res.locals.requestId });
  };
  app.use(errorHandler);
  return app;
}
