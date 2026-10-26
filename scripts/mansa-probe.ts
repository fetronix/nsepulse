/**
 * Manual Mansa verification probe.
 *
 * Run only when you have a real key, exported into the environment:
 *   MANSA_API_KEY=... npm run mansa:probe
 *   (or: node --env-file=.env --import tsx scripts/mansa-probe.ts)
 *
 * What it does — in the order Mansa's documentation recommends:
 *   1. GET /health (public, no key)
 *   2. GET /api/v1/markets/exchanges  → find Kenya and print the codes seen
 *   3. GET /api/v1/markets/exchanges/{code}/stocks?limit=5
 *   4. GET /api/v1/markets/exchanges/{code}/stocks/{ticker}
 *   5. Normalise the record with the real adapter and print the result
 *
 * It prints field NAMES and a couple of scalar values so the alias table in
 * `src/server/providers/mansa/normalize.ts` can be confirmed or corrected against a live
 * response. It never prints the API key, the Authorization header, or the full payload.
 *
 * This script is manual only. No automated test depends on Mansa being reachable, and CI
 * never runs it.
 */
import { MansaClient } from '../src/server/providers/mansa/client.js';
import { describeKeys, extractRecords, normalizeStockRecord } from '../src/server/providers/mansa/normalize.js';
import { describeMansaError } from '../src/server/providers/mansa/errors.js';

const baseUrl = process.env.MANSA_API_BASE_URL ?? 'https://mansaapi.com';
const apiKey = process.env.MANSA_API_KEY ?? '';

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function scalarPreview(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  if (Array.isArray(value)) return `[array of ${value.length}]`;
  return `[${typeof value}]`;
}

function printScalarFields(record: unknown): void {
  const keys = describeKeys(record);
  console.log(`  keys (${keys.length}): ${keys.join(', ') || 'none'}`);
  const preview = keys
    .filter((key) => {
      const value = (record as Record<string, unknown>)[key];
      return value === null || ['string', 'number', 'boolean'].includes(typeof value);
    })
    .slice(0, 18)
    .map((key) => `${key}=${scalarPreview((record as Record<string, unknown>)[key])}`);
  console.log(`  scalar values: ${preview.join(', ') || 'none'}`);
}

async function main(): Promise<void> {
  console.log('Mansa verification probe');
  console.log(`base URL: ${baseUrl}`);
  if (!apiKey.trim())
    fail('MANSA_API_KEY is not set. Provide it in the environment (or .env) before probing. No request was sent.');
  console.log('API key: present (value intentionally not printed)');

  const client = new MansaClient({ baseUrl, apiKey });

  try {
    const health = await client.fetchPublicHealth();
    console.log(`\n[1/4] GET /health → HTTP ${health.status} (no key used)`);
  } catch (error) {
    console.log(`\n[1/4] GET /health failed → ${describeMansaError(error)} (continuing)`);
  }

  let exchangeCode = 'NSE';
  let exchanges: unknown;
  try {
    const envelope = await client.get('/api/v1/markets/exchanges');
    exchanges = envelope.data;
    const records = extractRecords(envelope.data, ['exchanges']);
    console.log(`[2/4] GET /api/v1/markets/exchanges → ${records.length} record(s)`);
    const first = records[0];
    if (first) printScalarFields(first);
    const kenya = records.find((record) => {
      const haystack = [
        (record as Record<string, unknown>).country,
        (record as Record<string, unknown>).country_name,
        (record as Record<string, unknown>).country_code,
        (record as Record<string, unknown>).name,
        (record as Record<string, unknown>).currency,
        (record as Record<string, unknown>).code,
        (record as Record<string, unknown>).exchange
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      return haystack.includes('kenya') || haystack.includes('nairobi');
    });
    const kenyaCode = kenya
      ? [((kenya as Record<string, unknown>).code, (kenya as Record<string, unknown>).exchange)].find(
          (value): value is string => typeof value === 'string' && value.length > 0
        )
      : undefined;
    console.log(`  Kenya exchange: ${kenyaCode ?? 'not identified (will use documented NSE fallback)'}`);
    if (!kenya && Array.isArray(exchanges)) {
      console.log('  codes seen:');
      for (const record of exchanges.slice(0, 25)) {
        const item = record as Record<string, unknown>;
        console.log(`    ${scalarPreview(item.code ?? item.exchange)} — ${scalarPreview(item.country ?? item.name)}`);
      }
    }
    exchangeCode = kenyaCode ?? 'NSE';
  } catch (error) {
    fail(`exchange discovery failed → ${describeMansaError(error)}`);
  }

  let ticker: string | null = null;
  try {
    const envelope = await client.get(`/api/v1/markets/exchanges/${encodeURIComponent(exchangeCode)}/stocks`, {
      limit: 5
    });
    const records = extractRecords(envelope.data, ['stocks']);
    console.log(`\n[3/4] GET /api/v1/markets/exchanges/${exchangeCode}/stocks → ${records.length} record(s)`);
    const first = records[0];
    if (first) {
      printScalarFields(first);
      ticker =
        [((first as Record<string, unknown>).symbol, (first as Record<string, unknown>).ticker)].find(
          (value): value is string => typeof value === 'string' && value.length > 0
        ) ?? null;
    }
    console.log(`  sample ticker: ${ticker ?? 'none exposed'}`);
  } catch (error) {
    fail(`stock list failed → ${describeMansaError(error)}`);
  }

  if (!ticker) fail('No ticker-bearing field was found in the stock list, so a quote cannot be checked.');

  try {
    const envelope = await client.get(
      `/api/v1/markets/exchanges/${encodeURIComponent(exchangeCode)}/stocks/${encodeURIComponent(ticker)}`
    );
    console.log(`\n[4/4] GET .../stocks/${ticker} → HTTP ${envelope.status}`);
    printScalarFields(envelope.data);
    const result = normalizeStockRecord(envelope.data, { requestedSymbol: ticker });
    if (result.ok) {
      const observation = result.quote.observation;
      console.log('\n✔ normalised successfully');
      console.log(`  symbol: ${observation.symbol}`);
      console.log(`  price: ${observation.currency} ${observation.price}`);
      console.log(`  change: ${observation.changePercent ?? 'not supplied'}`);
      console.log(`  data mode: ${observation.dataMode}`);
      console.log(`  provider timestamp: ${observation.marketEventAt ?? 'not supplied'}`);
      console.log(`  freshness: ${result.quote.freshness.note}`);
      console.log(`  ${result.quote.notes.join('\n  ')}`);
    } else {
      console.log(`\n✖ normalisation rejected the record: ${result.reason}`);
      console.log('  Update the alias lists in src/server/providers/mansa/normalize.ts using the keys printed above.');
    }
  } catch (error) {
    fail(`single-stock request failed → ${describeMansaError(error)}`);
  }

  console.log(
    `\nRequests used against the local budget: ${client.usage().requestsUsed}/${client.usage().dailyRequestBudget}`
  );
  console.log('Reminder: a Mansa key is not an NSE redistribution licence. Confirm terms before publishing prices.');
}

await main();
