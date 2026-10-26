/**
 * Database error classification.
 *
 * Drizzle wraps driver errors in a plain `Error` whose message is only
 * `Failed query: <sql>` — the Postgres details live on `error.cause`, and the wrapper has no
 * stack. Logging the wrapper alone therefore throws away the only information an operator
 * needs, which is exactly what made a missing migration look like an unexplained 500.
 *
 * Everything here walks the `cause` chain and returns a safe, actionable description. Values
 * from a connection string (user, password, host) are never included.
 */

export type DatabaseErrorKind = 'SCHEMA_MISSING' | 'CONNECTION' | 'AUTH' | 'PERMISSION' | 'UNKNOWN';

export interface DatabaseErrorDescription {
  kind: DatabaseErrorKind;
  /** Postgres SQLSTATE or Node system code, when one is available. */
  code: string | null;
  /** Driver-level message, already known to be free of credentials. */
  message: string;
  /** What the operator should do next. */
  hint: string;
  /** Table or column named by the driver, when present. */
  object: string | null;
}

const SCHEMA_CODES = new Set(['42P01', '3F000', '42703']);
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03'
]);
const AUTH_CODES = new Set(['28P01', '28000']);
const PERMISSION_CODES = new Set(['42501']);

/** The deepest `cause` with a string code/message, which is where the driver error sits. */
export function rootCause(error: unknown): { code: string | null; message: string; name: string } | null {
  let current: unknown = error;
  let best: { code: string | null; message: string; name: string } | null = null;
  for (let depth = 0; current && depth < 6; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown };
    if (typeof candidate.message === 'string') {
      best = {
        code: typeof candidate.code === 'string' ? candidate.code : null,
        message: candidate.message,
        name: typeof candidate.name === 'string' ? candidate.name : 'Error'
      };
    }
    current = candidate.cause;
  }
  return best;
}

/** Extract `relation "x" does not exist` / `column "y"` style object names. */
function objectFromMessage(message: string): string | null {
  const relation = /relation "([^"]+)"/i.exec(message);
  if (relation) return relation[1] ?? null;
  const column = /column "([^"]+)"/i.exec(message);
  if (column) return column[1] ?? null;
  const schema = /schema "([^"]+)"/i.exec(message);
  return schema?.[1] ?? null;
}

export function classifyDatabaseError(error: unknown): DatabaseErrorDescription {
  const root = rootCause(error);
  const code = root?.code ?? null;
  const rawMessage = root?.message ?? (error instanceof Error ? error.message : 'unknown database error');
  // Collapse whitespace and drop anything that looks like a connection URL with credentials.
  const message = rawMessage
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  if (code && SCHEMA_CODES.has(code))
    return {
      kind: 'SCHEMA_MISSING',
      code,
      message,
      hint: 'The database is reachable but the application tables do not exist. Run `npm run db:migrate` against this database (the same DATABASE_URL or SQL_* settings), then retry.',
      object: objectFromMessage(message)
    };

  if (code && AUTH_CODES.has(code))
    return {
      kind: 'AUTH',
      code,
      message,
      hint: 'PostgreSQL rejected the credentials in DATABASE_URL. Check the user, password and database name; the value itself is never logged.',
      object: null
    };

  if (code && PERMISSION_CODES.has(code))
    return {
      kind: 'PERMISSION',
      code,
      message,
      hint: 'The database user lacks privileges on this object. Grant the required rights to the application role.',
      object: objectFromMessage(message)
    };

  if (code === '3D000')
    return {
      kind: 'CONNECTION',
      code,
      message,
      hint: 'The configured connection names a database that does not exist on this server. Create it (or fix SQL_DB_NAME / DATABASE_URL) and run the migrations.',
      object: objectFromMessage(message)
    };

  if (code && CONNECTION_CODES.has(code))
    return {
      kind: 'CONNECTION',
      code,
      message,
      hint: 'PostgreSQL is not accepting connections. Check that the server is running, the host/port in DATABASE_URL are correct, and that pg_hba.conf allows the connection.',
      object: null
    };

  // Driver message without a code, e.g. a pool timeout while acquiring a client.
  if (/timeout exceeded when trying to connect|Connection terminated|getaddrinfo|connect ECONN/i.test(message))
    return {
      kind: 'CONNECTION',
      code,
      message,
      hint: 'PostgreSQL could not be reached in time. Check that the server is running and reachable from this host.',
      object: null
    };

  return {
    kind: 'UNKNOWN',
    code,
    message,
    hint: 'An unexpected database error occurred. The message above comes from the driver.',
    object: null
  };
}

export function isSchemaMissing(error: unknown): boolean {
  return classifyDatabaseError(error).kind === 'SCHEMA_MISSING';
}

/** HTTP status to return for a database failure: the service exists, the storage does not. */
export function httpStatusForDatabaseError(kind: DatabaseErrorKind): number {
  return kind === 'UNKNOWN' ? 500 : 503;
}
