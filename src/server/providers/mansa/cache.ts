/**
 * Small TTL cache with single-flight de-duplication.
 *
 * Purpose: the Mansa free tier allows 100 requests per day, so identical lookups inside a
 * short window must not each spend quota, and two concurrent callers must not both fire the
 * same request. Nothing here is persisted: a restart starts cold, which is honest — the
 * cache never pretends to be a store.
 */
export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  get ttl(): number {
    return this.ttlMs;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.maxEntries > 0 && this.entries.size >= this.maxEntries) this.evictOldest();
    const storedAt = this.now();
    this.entries.set(key, { value, storedAt, expiresAt: storedAt + this.ttlMs });
  }

  /** Return a cached value, or run `loader` once even if called concurrently. */
  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const pending = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }

  /** Invalidate one key; used when a caller explicitly asks for a refresh. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.storedAt < oldestAt) {
        oldestAt = entry.storedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.entries.delete(oldestKey);
  }
}
