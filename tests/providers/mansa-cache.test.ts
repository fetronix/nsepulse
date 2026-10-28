import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/server/providers/mansa/cache.js';

/**
 * The cache in front of the Mansa adapter.
 *
 * Mansa's free tier is documented as 100 requests per day, so this class is the thing that
 * keeps the application inside that limit. The two properties worth protecting are that a
 * value really does expire (a stale quote must not be served indefinitely as if it were
 * current) and that concurrent callers share one request instead of each spending quota.
 */
function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describe('expiry', () => {
  it('returns a value inside the window and drops it afterwards', () => {
    const time = clock();
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: time.now });

    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');

    time.advance(999);
    expect(cache.get('k')).toBe('v');

    time.advance(1);
    expect(cache.get('k')).toBeNull();
    // The expired entry is removed, not merely hidden.
    expect(cache.size).toBe(0);
  });

  it('misses on an unknown key', () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: clock().now });
    expect(cache.get('absent')).toBeNull();
  });

  it('exposes the configured TTL so callers can describe freshness', () => {
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: clock().now });
    expect(cache.ttl).toBe(300_000);
  });

  it('reports its size and can be cleared wholesale', () => {
    const cache = new TtlCache<number>({ ttlMs: 1_000, now: clock().now });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  it('invalidates a single key without touching the others', () => {
    const cache = new TtlCache<number>({ ttlMs: 1_000, now: clock().now });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
  });
});

describe('single-flight loading', () => {
  it('loads once and serves the cached value afterwards', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: clock().now });
    const loader = vi.fn(async () => 'value');

    expect(await cache.getOrLoad('k', loader)).toBe('value');
    expect(await cache.getOrLoad('k', loader)).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: clock().now });
    let resolve!: (value: string) => void;
    const loader = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        })
    );

    const first = cache.getOrLoad('quote:SCOM', loader);
    const second = cache.getOrLoad('quote:SCOM', loader);
    const third = cache.getOrLoad('quote:SCOM', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    resolve('12.50');

    await expect(Promise.all([first, second, third])).resolves.toEqual(['12.50', '12.50', '12.50']);
  });

  it('does not cache a failed load, and allows a retry', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: clock().now });
    const loader = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce('recovered');

    await expect(cache.getOrLoad('k', loader)).rejects.toThrow('HTTP 503');
    expect(cache.get('k')).toBeNull();

    expect(await cache.getOrLoad('k', loader)).toBe('recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reloads after the TTL expires rather than serving the old value', async () => {
    const time = clock();
    const cache = new TtlCache<number>({ ttlMs: 1_000, now: time.now });
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrLoad('k', loader)).toBe(1);
    time.advance(1_001);
    expect(await cache.getOrLoad('k', loader)).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('bounded size', () => {
  it('evicts the oldest entry once the limit is reached', () => {
    const time = clock();
    const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 2, now: time.now });

    cache.set('oldest', 'a');
    time.advance(10);
    cache.set('newer', 'b');
    time.advance(10);
    cache.set('newest', 'c');

    expect(cache.size).toBe(2);
    expect(cache.get('oldest')).toBeNull();
    expect(cache.get('newer')).toBe('b');
    expect(cache.get('newest')).toBe('c');
  });

  it('keeps growing when no limit is configured', () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 0, now: clock().now });
    for (let i = 0; i < 50; i++) cache.set(`k${i}`, String(i));
    expect(cache.size).toBe(50);
  });
});
