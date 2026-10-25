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
   * `none` keeps the live quote adapter disabled. `demo` is a local fixture adapter for
   * development only and requires ALLOW_DEMO_MARKET_DATA=true. `nse-vendor` selects a
   * placeholder adapter that performs no request until a real implementation exists.
   */
  MARKET_DATA_PROVIDER: z.string().default('none'),
  ALLOW_DEMO_MARKET_DATA: z.enum(['true', 'false']).default('false'),
  NSE_VENDOR_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  NSE_VENDOR_API_KEY: z.string().optional().or(z.literal('')),
  /** Operator confirmation that retained stored historical data may be displayed/derived. */
  HISTORICAL_DATA_PERMISSION_CONFIRMED: z.enum(['true', 'false']).default('false'),
  /** Operator confirmation that issuer announcements may be stored and republished. */
  ANNOUNCEMENTS_PERMISSION_CONFIRMED: z.enum(['true', 'false']).default('false'),
  TELEGRAM_BOT_TOKEN: z.string().optional().or(z.literal('')),
  SESSION_SECRET: z.string().optional().or(z.literal('')),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
