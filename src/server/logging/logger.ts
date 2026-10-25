import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '../config.js';

/**
 * Shared structured logger.
 *
 * Logs are newline-delimited JSON on stdout so a log collector can index them. Secrets,
 * credentials and request bodies must never be passed to the logger; the redaction rules
 * below are a safety net for common key names, not a substitute for care at call sites.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'apiKey',
  'api_key',
  'secret',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.authorization'
];

export function loggerOptions(): LoggerOptions {
  // Tests stay quiet unless LOG_LEVEL is set explicitly, so test output shows assertions
  // rather than request logs.
  const level = config.NODE_ENV === 'test' && !process.env.LOG_LEVEL ? 'silent' : config.LOG_LEVEL;
  return {
    level,
    base: { service: 'nse-pulse', env: config.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths, censor: '[redacted]' },
    // Pretty printing is a developer convenience only; production stays JSON.
    ...(config.NODE_ENV === 'development' && process.stdout.isTTY
      ? { transport: { target: 'pino/file', options: { destination: 1 } } }
      : {})
  };
}

export const logger: Logger = pino(loggerOptions());

/** Bind a module name so every line identifies its origin. */
export function moduleLogger(module: string): Logger {
  return logger.child({ module });
}

/** Build a request-scoped logger bound to a correlation id. */
export function withCorrelation(correlationId: string, module?: string): Logger {
  return logger.child({ correlationId, ...(module ? { module } : {}) });
}
