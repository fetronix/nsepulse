/**
 * The warmed exchange snapshot.
 *
 * `refreshSnapshot()` fetches the whole stock list once and per-symbol quotes are answered
 * from it, which is what keeps a free tier with a documented 100 requests/day usable. This
 * module only holds the lookup, and it matches on the documented symbol keys without
 * assuming that a record has any one of them.
 */

/** Find the record for `symbol`, or null when the snapshot does not contain it. */
export function findSnapshotRecord(records: readonly unknown[], symbol: string): unknown | null {
  const wanted = symbol.trim().toUpperCase();
  for (const record of records) {
    const item = (record ?? {}) as Record<string, unknown>;
    const ticker = [item.symbol, item.ticker, item.canonical_symbol].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    if (ticker && ticker.trim().toUpperCase() === wanted) return record;
  }
  return null;
}
