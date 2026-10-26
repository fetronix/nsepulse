import { afterAll, describe, expect, it, vi } from 'vitest';

afterAll(() => {
  delete process.env.LOG_LEVEL;
});

/**
 * Structured logging behaviour: level configuration, module binding and redaction of
 * secret-looking fields. A destination stream captures what would be written.
 */
async function loadLoggerWithStream(level = 'info') {
  vi.resetModules();
  process.env.LOG_LEVEL = level;
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
      return true;
    }
  };
  const pino = (await import('pino')).default;
  const { loggerOptions } = await import('../../src/server/logging/logger.js');
  return { logger: pino(loggerOptions(), stream), lines };
}

describe('logger configuration', () => {
  it('uses the configured level and base fields', async () => {
    const { logger, lines } = await loadLoggerWithStream();
    logger.info({ module: 'test' }, 'hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'hello', service: 'nse-pulse', module: 'test', level: 30 });
    expect(lines[0]).toHaveProperty('time');
  });

  it('redacts common secret fields at any depth', async () => {
    const { logger, lines } = await loadLoggerWithStream();
    logger.warn(
      {
        password: 'hunter2',
        apiKey: 'abc123',
        nested: { token: 'tok-1', api_key: 'key-1', secret: 's-1', authorization: 'Bearer x' },
        req: { headers: { authorization: 'Bearer y', cookie: 'session=1' } }
      },
      'redaction'
    );
    const serialised = JSON.stringify(lines[0]);
    for (const secret of ['hunter2', 'abc123', 'tok-1', 'key-1', 's-1', 'Bearer x', 'Bearer y', 'session=1']) {
      expect(serialised).not.toContain(secret);
    }
    expect(serialised).toContain('[redacted]');
  });

  it('respects LOG_LEVEL for filtering', async () => {
    const { logger, lines } = await loadLoggerWithStream('warn');
    logger.info('dropped');
    logger.warn('kept');
    expect(lines.map((line) => line.msg)).toEqual(['kept']);
  });
});
