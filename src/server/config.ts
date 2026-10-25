import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional().or(z.literal('')),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  MARKET_DATA_PROVIDER: z.string().default('none'),
  NSE_VENDOR_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  NSE_VENDOR_API_KEY: z.string().optional().or(z.literal('')),
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
export const isNseAdapterConfigured = config.MARKET_DATA_PROVIDER === 'nse-vendor' && Boolean(config.NSE_VENDOR_API_BASE_URL && config.NSE_VENDOR_API_KEY);
