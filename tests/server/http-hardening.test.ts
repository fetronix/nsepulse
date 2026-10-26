import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_TIMEOUTS, applyHttpTimeouts, drainServer } from '../../src/server/api/http.js';

/**
 * The timeout policy is applied to a real `http.Server`, not a stub, so these assertions
 * describe the object the process actually listens on. Node's defaults (300 s request
 * timeout, 60 s headers timeout) are far longer than any legitimate response here.
 */

let server: Server | null = null;

afterEach(async () => {
  if (server?.listening) await drainServer(server);
  server = null;
});

function silentServer(): Server {
  return createServer((_req, res) => res.end('ok'));
}

describe('HTTP timeout policy', () => {
  it('replaces the Node defaults with bounded values', () => {
    server = applyHttpTimeouts(silentServer());
    expect(server.headersTimeout).toBe(15_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(5_000);

    // The policy must remain stricter than the defaults on a fresh server, otherwise this
    // change would be cosmetic.
    const defaults = silentServer();
    expect(server.requestTimeout).toBeLessThan(defaults.requestTimeout);
    expect(server.headersTimeout).toBeLessThan(defaults.headersTimeout);
    defaults.close();
  });

  it('keeps headers timeout below the request timeout, or Node refuses the configuration', () => {
    // Node throws if headersTimeout > requestTimeout; make the invariant explicit.
    expect(HTTP_TIMEOUTS.headersTimeoutMs).toBeLessThanOrEqual(HTTP_TIMEOUTS.requestTimeoutMs);
    expect(HTTP_TIMEOUTS.keepAliveTimeoutMs).toBeLessThan(HTTP_TIMEOUTS.headersTimeoutMs);
  });

  it('accepts an explicit override without hard-coding policy in the caller', () => {
    server = applyHttpTimeouts(silentServer(), {
      headersTimeoutMs: 1_000,
      requestTimeoutMs: 2_000,
      keepAliveTimeoutMs: 500
    });
    expect([server.headersTimeout, server.requestTimeout, server.keepAliveTimeout]).toEqual([1_000, 2_000, 500]);
  });
});

describe('drainServer', () => {
  it('resolves once the listening server is closed', async () => {
    server = applyHttpTimeouts(silentServer());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    expect(server.listening).toBe(true);

    await drainServer(server);
    expect(server.listening).toBe(false);
  });

  it('closes idle keep-alive connections instead of blocking the drain', async () => {
    server = applyHttpTimeouts(silentServer());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    // Open a keep-alive connection and leave it idle, which is what a browser or proxy does.
    const { request } = await import('node:http');
    const keepAlive = request({
      host: '127.0.0.1',
      port,
      path: '/',
      agent: false,
      headers: { connection: 'keep-alive' }
    });
    await new Promise<void>((resolve, reject) => {
      keepAlive.on('response', (response) => {
        response.resume();
        response.on('end', () => resolve());
      });
      keepAlive.on('error', reject);
      keepAlive.end();
    });

    const startedAt = Date.now();
    await drainServer(server);
    // Must not block for the 5 s keep-alive timeout. On Node >= 19 plain close() behaves the
    // same way; this asserts the property holds for the code the process actually runs.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(server.listening).toBe(false);
  });
});
