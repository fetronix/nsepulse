import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from '../config.js';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"' && quoted && input[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const path = process.argv[2];
const sourceUrl = process.env.SECURITY_MASTER_SOURCE_URL;
const verifiedAt = process.env.SECURITY_MASTER_VERIFIED_AT;
if (!config.DATABASE_URL || !path || !sourceUrl || !verifiedAt) {
  console.error(
    'Usage: SECURITY_MASTER_SOURCE_URL=https://official-source/... SECURITY_MASTER_VERIFIED_AT=ISO-8601 DATABASE_URL=... npx tsx src/server/db/import-securities.ts securities.csv'
  );
  process.exit(1);
}
const source = new URL(sourceUrl);
if (
  source.protocol !== 'https:' ||
  !['nse.co.ke', 'www.nse.co.ke', 'cdsckenya.com', 'www.cdsckenya.com'].includes(source.hostname)
) {
  console.error('Source must be an HTTPS NSE or CDSC URL. Review data permissions and source terms before importing.');
  process.exit(1);
}
const verifiedDate = new Date(verifiedAt);
if (!Number.isFinite(verifiedDate.getTime())) {
  console.error('SECURITY_MASTER_VERIFIED_AT must be an ISO timestamp.');
  process.exit(1);
}
const rows = parseCsv(await readFile(path, 'utf8'));
const header = rows.shift()?.map((x) => x.toLowerCase());
const required = ['symbol', 'name', 'instrumenttype', 'listingstatus'];
if (!header || required.some((name) => !header.includes(name))) {
  console.error(`CSV must include columns: ${required.join(', ')}`);
  process.exit(1);
}
const indexes = Object.fromEntries(header.map((h, i) => [h, i]));
const parsed = rows.map((row, index) => ({
  rowNo: index + 2,
  symbol: row[indexes.symbol!] ?? '',
  name: row[indexes.name!] ?? '',
  type: row[indexes.instrumenttype!] ?? '',
  status: row[indexes.listingstatus!] ?? '',
  sector: indexes.sector === undefined ? null : row[indexes.sector] || null
}));
const seen = new Set<string>();
for (const item of parsed) {
  const symbol = item.symbol.toUpperCase();
  if (!/^[A-Z0-9.-]{1,32}$/.test(symbol) || !item.name || !item.type || !item.status)
    throw new Error(`Invalid required fields at CSV row ${item.rowNo}`);
  if (seen.has(symbol)) throw new Error(`Duplicate symbol ${symbol} in input; resolve ambiguity before importing.`);
  seen.add(symbol);
  item.symbol = symbol;
}
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});
try {
  await pool.query('BEGIN');
  for (const item of parsed) {
    await pool.query(
      `INSERT INTO securities (symbol,name,exchange,instrument_type,listing_status,sector,currency,source,source_verified_at,review_required,updated_at)
      VALUES ($1,$2,'NSE',$3,$4,$5,'KES',$6,$7,true,now())
      ON CONFLICT (exchange,symbol) DO UPDATE SET name=EXCLUDED.name,instrument_type=EXCLUDED.instrument_type,listing_status=EXCLUDED.listing_status,sector=EXCLUDED.sector,source=EXCLUDED.source,source_verified_at=EXCLUDED.source_verified_at,review_required=true,updated_at=now()`,
      [item.symbol, item.name, item.type, item.status, item.sector, sourceUrl, verifiedDate]
    );
  }
  await pool.query('COMMIT');
  console.log(
    `Imported ${parsed.length} securities from ${sourceUrl}. All records are flagged for administrator review; this does not verify the source's data-use rights.`
  );
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
