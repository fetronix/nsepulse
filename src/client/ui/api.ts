/**
 * The browser's view of the API.
 *
 * Kept apart from the components so the error shape and the shared types have one home. The
 * client never reads a credential: everything it can reach comes from `/api/v1`, which the
 * server populates from its own environment.
 */

export type ProviderEntry = {
  provider: string;
  configured: boolean;
  state: string;
  message: string;
  dataMode: string;
};

export type Health = {
  status: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  database: { configured: boolean; reachable: boolean; message: string };
  providers: ProviderEntry[];
};

export type Security = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  listingStatus: string;
  sector: string | null;
};

export type Overview = {
  sessionStatus: string;
  sessionNote: string;
  currency: string;
  timezone: string;
  indices: { code: string; value: number }[];
  dataFreshness: { latestObservationAt: string | null; status: string };
  counts: { securities: number | null; observations: number | null };
  providerStatuses: { provider: string; state: string; message: string }[];
};

export type Quote = {
  observation: Record<string, unknown> | null;
  reason: string | null;
};

/** An HTTP failure the server explained itself, so the operator can act on it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly serverDetail: string | null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    // The API explains storage failures in `error`/`hint` (for example an unmigrated
    // database). Surfacing that beats a generic "API returned 503".
    const body = (await response.json().catch(() => null)) as { error?: string; hint?: string } | null;
    const detail = body?.error ? `${body.error}${body.hint ? ` — ${body.hint}` : ''}` : null;
    throw new ApiError(`API returned ${response.status}`, detail);
  }
  return response.json() as Promise<T>;
}

export function formatTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(
        date
      ) + ' EAT'
    : 'Not available';
}
