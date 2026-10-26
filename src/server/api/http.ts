import type { Server } from 'node:http';

/**
 * Bounded HTTP timeouts.
 *
 * Node's defaults are tuned for general use, not for a small API behind a reverse proxy:
 * `requestTimeout` is 300 s, so a client that opens a request and stalls holds a socket for
 * five minutes, and `headersTimeout` (60 s) lets a slowloris client occupy a connection while
 * sending headers. Both are generous for an API whose slowest legitimate response is a single
 * upstream market-data call bounded by MANSA_REQUEST_TIMEOUT_MS (10 s by default).
 *
 * `keepAliveTimeout` stays modest so idle sockets are released promptly, and shutdown can
 * therefore drain quickly.
 */
export interface HttpTimeouts {
  headersTimeoutMs: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
}

export const HTTP_TIMEOUTS: HttpTimeouts = {
  /** Receiving the complete request line and headers. */
  headersTimeoutMs: 15_000,
  /** Receiving the whole request (including body where present). */
  requestTimeoutMs: 30_000,
  /** Idle keep-alive sockets are closed after this. */
  keepAliveTimeoutMs: 5_000
};

/**
 * Apply the policy to a server instance.
 *
 * Exported and applied to a real `http.Server` in tests, so the values cannot silently drift
 * away from the documented policy.
 */
export function applyHttpTimeouts<T extends Pick<Server, 'headersTimeout' | 'requestTimeout' | 'keepAliveTimeout'>>(
  server: T,
  timeouts: HttpTimeouts = HTTP_TIMEOUTS
): T {
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  return server;
}

/**
 * Stop accepting connections and wait for active requests to finish.
 *
 * Measured on Node 22, plain `server.close()` already drops idle keep-alive sockets, so this
 * is not a fix for a current defect: it names the drain intent, keeps the behaviour covered by
 * a test, and remains correct if the runtime or the connection handling changes. Active
 * requests are still allowed to complete, which is what graceful shutdown promises.
 */
export function drainServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Available since Node 18.2; guarded so an older runtime still shuts down cleanly.
    server.closeIdleConnections?.();
  });
}
