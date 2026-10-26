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
   * Component form of the same connection, for environments that keep credentials in
   * separate variables instead of one URL. DATABASE_URL takes precedence when both are set.
   * The composed URL is kept in memory only and is never logged.
   */
  SQL_HOST: z.string().optional().or(z.literal('')),
  SQL_PORT: z.coerce.number().int().positive().max(65_535).optional(),
  SQL_DB_NAME: z.string().optional().or(z.literal('')),
  SQL_ADMIN_USER: z.string().optional().or(z.literal('')),
  SQL_ADMIN_PASSWORD: z.string().optional().or(z.literal('')),
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

/** Where the effective connection string came from. Reported as a boolean/name only. */
export type DatabaseConfigSource = 'DATABASE_URL' | 'SQL_*' | 'none';

const SQL_COMPONENT_KEYS = ['SQL_HOST', 'SQL_DB_NAME', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD'] as const;

/**
 * Build a connection URL from the component variables, or explain which ones are missing.
 *
 * Values are URI-encoded, so a password containing `@`, `:` or `/` (common in generated
 * credentials) does not corrupt the URL. Neither the password nor the composed URL is ever
 * printed: the error names missing *keys* only.
 */
function composeDatabaseUrl(data: {
  SQL_HOST?: string;
  SQL_PORT?: number;
  SQL_DB_NAME?: string;
  SQL_ADMIN_USER?: string;
  SQL_ADMIN_PASSWORD?: string;
}): { url: string | null; missing: string[] } {
  const host = data.SQL_HOST?.trim();
  const database = data.SQL_DB_NAME?.trim();
  const user = data.SQL_ADMIN_USER?.trim();
  const password = data.SQL_ADMIN_PASSWORD ?? '';
  const missing: string[] = [];
  if (!host) missing.push('SQL_HOST');
  if (!database) missing.push('SQL_DB_NAME');
  if (!user) missing.push('SQL_ADMIN_USER');
  if (!host || !database || !user) return { url: null, missing };

  const port = data.SQL_PORT ?? 5432;
  const credentials = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return { url: `postgres://${credentials}@${host}:${port}/${encodeURIComponent(database)}`, missing };
}

const explicitDatabaseUrl = parsed.data.DATABASE_URL?.trim() || '';
const sqlComponentsProvided = SQL_COMPONENT_KEYS.some((key) => Boolean(parsed.data[key]?.toString().trim()));

let databaseConfigSource: DatabaseConfigSource = 'none';
let effectiveDatabaseUrl = explicitDatabaseUrl;
let databaseConfigWarning: string | null = null;

if (!explicitDatabaseUrl && sqlComponentsProvided) {
  const composed = composeDatabaseUrl(parsed.data);
  if (composed.url) {
    effectiveDatabaseUrl = composed.url;
    databaseConfigSource = 'SQL_*';
  } else {
    // Half a connection is a configuration mistake, not "no database": failing loudly here
    // beats a silent degraded start where every data route serves empty states.
    console.error(
      `Incomplete database configuration: ${composed.missing.join(', ')} must be set when using the SQL_* variables, ` +
        'or set DATABASE_URL instead. No secret values are shown.'
    );
    process.exit(1);
  }
} else if (explicitDatabaseUrl) {
  databaseConfigSource = 'DATABASE_URL';
  if (sqlComponentsProvided)
    databaseConfigWarning =
      'Both DATABASE_URL and the SQL_* variables are set; DATABASE_URL takes precedence and the SQL_* values are ignored.';
}

export const config = { ...parsed.data, DATABASE_URL: effectiveDatabaseUrl } as typeof parsed.data;
export const isDatabaseConfigured = Boolean(config.DATABASE_URL);

/** Non-secret description of the connection for startup logs and `/data-sources`. */
export const databaseConfig: {
  source: DatabaseConfigSource;
  host: string | null;
  port: number | null;
  database: string | null;
  warning: string | null;
} = (() => {
  if (!effectiveDatabaseUrl) return { source: 'none', host: null, port: null, database: null, warning: null };
  try {
    const url = new URL(effectiveDatabaseUrl);
    return {
      source: databaseConfigSource,
      host: url.hostname || null,
      port: url.port ? Number(url.port) : 5432,
      database: url.pathname.replace(/^\//, '') || null,
      warning: databaseConfigWarning
    };
  } catch {
    // `z.string().url()` already rejected malformed values; this is defensive only.
    return { source: databaseConfigSource, host: null, port: null, database: null, warning: databaseConfigWarning };
  }
})();

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
