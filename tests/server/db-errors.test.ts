import { describe, expect, it } from 'vitest';
import {
  classifyDatabaseError,
  httpStatusForDatabaseError,
  isSchemaMissing,
  rootCause
} from '../../src/server/db/errors.js';

/**
 * Drizzle wraps driver errors as `Error('Failed query: …')` and puts the Postgres details on
 * `cause`. These tests pin the behaviour that made a missing migration indistinguishable from
 * any other failure in the logs.
 */
function drizzleError(sql: string, cause: Record<string, unknown>): Error {
  const error = new Error(`Failed query: ${sql}\nparams: `) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

describe('rootCause', () => {
  it('descends to the driver error that carries the SQLSTATE', () => {
    const error = drizzleError('select count(*) from "securities"', {
      name: 'error',
      code: '42P01',
      message: 'relation "securities" does not exist'
    });
    expect(rootCause(error)).toEqual({
      code: '42P01',
      message: 'relation "securities" does not exist',
      name: 'error'
    });
  });

  it('stops walking after a bounded depth instead of looping on a cyclic cause', () => {
    const a: Record<string, unknown> = { message: 'outer' };
    const b: Record<string, unknown> = { message: 'inner', code: '42P01', cause: a };
    a.cause = b;
    expect(rootCause(a)?.message).toBe('inner');
  });

  it('returns null for values that are not errors', () => {
    expect(rootCause(undefined)).toBeNull();
    expect(rootCause('boom')).toBeNull();
  });
});

describe('classifyDatabaseError', () => {
  it('identifies a missing table and names the object', () => {
    const described = classifyDatabaseError(
      drizzleError('select count(*) from "securities"', {
        code: '42P01',
        message: 'relation "securities" does not exist'
      })
    );
    expect(described).toEqual({
      kind: 'SCHEMA_MISSING',
      code: '42P01',
      message: 'relation "securities" does not exist',
      hint: 'The database is reachable but the application tables do not exist. Run `npm run db:migrate` against this DATABASE_URL, then retry.',
      object: 'securities'
    });
    expect(isSchemaMissing(drizzleError('q', { code: '42P01', message: 'relation "x" does not exist' }))).toBe(true);
  });

  it('treats a missing column or schema as a migration problem too', () => {
    for (const code of ['42703', '3F000'])
      expect(classifyDatabaseError(Object.assign(new Error('nope'), { code })).kind).toBe('SCHEMA_MISSING');
  });

  it('classifies credential rejection without exposing the credentials', () => {
    const described = classifyDatabaseError(
      drizzleError('select 1', {
        code: '28P01',
        message: 'password authentication failed for user "pulse" at postgres://pulse:hunter2@db:5432/nse'
      })
    );
    expect(described.kind).toBe('AUTH');
    expect(described.message).not.toContain('hunter2');
    expect(described.message).toContain('[connection string redacted]');
  });

  it('classifies an unreachable server and a pool timeout as connection failures', () => {
    expect(classifyDatabaseError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).kind).toBe('CONNECTION');
    expect(classifyDatabaseError(new Error('timeout exceeded when trying to connect')).kind).toBe('CONNECTION');
  });

  it('classifies insufficient privilege separately from a missing object', () => {
    const described = classifyDatabaseError(
      Object.assign(new Error('permission denied for table x'), { code: '42501' })
    );
    expect(described.kind).toBe('PERMISSION');
    expect(described.hint).toMatch(/lacks privileges/);
  });

  it('falls back to UNKNOWN for an error with no recognisable cause', () => {
    const described = classifyDatabaseError(new Error('something else entirely'));
    expect(described.kind).toBe('UNKNOWN');
    expect(described.code).toBeNull();
    expect(described.object).toBeNull();
  });

  it('truncates a very long driver message', () => {
    const described = classifyDatabaseError(Object.assign(new Error('e'.repeat(900)), { code: 'XX000' }));
    expect(described.message.length).toBeLessThanOrEqual(300);
  });
});

describe('httpStatusForDatabaseError', () => {
  it('maps known storage failures to 503 and unknown ones to 500', () => {
    expect(httpStatusForDatabaseError('SCHEMA_MISSING')).toBe(503);
    expect(httpStatusForDatabaseError('CONNECTION')).toBe(503);
    expect(httpStatusForDatabaseError('AUTH')).toBe(503);
    expect(httpStatusForDatabaseError('PERMISSION')).toBe(503);
    expect(httpStatusForDatabaseError('UNKNOWN')).toBe(500);
  });
});
