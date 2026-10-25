import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional().or(z.literal('')),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  /**
   * `none` keeps the live quote adapter disabled. `mansa` selects the Mansa API adapter
   * (https://mansaapi.com/docs) and additionally requires MANSA_API_KEY. `demo` is a local
   * fixture adapter for development only and requires ALLOW_DEMO_MARKET_DATA=true.
   * `nse-vendor` selects a placeholder adapter that performs no request until a real
   * implementation exists.
   */
  MARKET_DATA_PROVIDER: z.string().default('none'),
  ALLOW_DEMO_MARKET_DATA: z.enum(['true', 'false']).default('false'),
  NSE_VENDOR_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  NSE_VENDOR_API_KEY: z.string().optional().or(z.literal('')),
  /**
   * Mansa market-data adapter. The key is read here and passed straight to the adapter; it
   * is never stored on provider settings, never logged and never returned by any route.
   * The base URL must be HTTPS: the adapter refuses to send a bearer token to anything else.
   */
  MANSA_API_BASE_URL: z.string().url().default('https://mansaapi.com'),
  MANSA_API_KEY: z.string().optional().or(z.literal('')),
  MANSA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  /** Free tier is documented as 100 requests/day; the adapter refuses to exceed this. */
  MANSA_DAILY_REQUEST_BUDGET: z.coerce.number().int().positive().max(10_000).default(100),
  /** Snapshot cache lifetime. Docs state markets endpoints target 30-minute freshness. */
  MANSA_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().max(3600).default(300),
  /** Operator confirmation that retained stored historical data may be displayed/derived. */
  HISTORICAL_DATA_PERMISSION_CONFIRMED: z.enum(['true', 'false']).default('false'),
  /** Operator confirmation that issuer announcements may be stored and republished. */
  ANNOUNCEMENTS_PERMISSION_CONFIRMED: z.enum(['true', 'false']).default('false'),
  TELEGRAM_BOT_TOKEN: z.string().optional().or(z.literal('')),
  SESSION_SECRET: z.string().optional().or(z.literal('')),
  /** Pino levels. `silent` disables output entirely; `fatal` is the quietest active level. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_SCHEDULER: z.enum(['true', 'false']).default('false')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;
export const isDatabaseConfigured = Boolean(config.DATABASE_URL);

/**
 * Demo fixtures are only reachable with an explicit opt-in, and never in production.
 * Credential presence alone never enables a live adapter.
 */
export const isDemoMarketDataActive =
  config.MARKET_DATA_PROVIDER.trim().toLowerCase() === 'demo' &&
  config.ALLOW_DEMO_MARKET_DATA === 'true' &&
  config.NODE_ENV !== 'production';

/** A configured base URL/key is not a working integration; an adapter must still be implemented. */
export const isNseAdapterConfigured = false;

/** Whether a Mansa key is present. Presence is not proof of a working integration. */
export const isMansaKeyConfigured = Boolean(config.MANSA_API_KEY);
