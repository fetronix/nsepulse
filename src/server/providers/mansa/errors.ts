/**
 * Mansa adapter failure classification.
 *
 * Error messages are written for logs and operator-facing text only. They must never
 * contain the API key, the Authorization header or a full request URL with credentials
 * attached — the client builds messages from status codes and its own fixed strings.
 */
export type MansaErrorKind =
  'CONFIGURATION' | 'AUTH' | 'RATE_LIMIT' | 'QUOTA' | 'HTTP' | 'TIMEOUT' | 'NETWORK' | 'MALFORMED' | 'UNSUPPORTED_PLAN';

export class MansaError extends Error {
  readonly kind: MansaErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: MansaErrorKind, message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'MansaError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  /** Whether an identical request could reasonably succeed later without operator action. */
  get retryable(): boolean {
    return this.kind === 'RATE_LIMIT' || this.kind === 'TIMEOUT' || this.kind === 'NETWORK';
  }
}

export function isMansaError(error: unknown): error is MansaError {
  return error instanceof MansaError;
}

/** One-line, secret-free summary suitable for logs and API error details. */
export function describeMansaError(error: unknown): string {
  if (isMansaError(error)) {
    return error.status === null
      ? `${error.kind}: ${error.message}`
      : `${error.kind} (HTTP ${error.status}): ${error.message}`;
  }
  return 'UnknownError: the provider request failed for an unclassified reason.';
}
