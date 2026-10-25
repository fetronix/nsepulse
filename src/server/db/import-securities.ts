import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from '../config.js';
import {
  SecurityMasterFormatError,
  parseSecurityMasterCsv,
  validateSourceUrl,
  validateVerifiedAt,
  type ParsedSecurityRow
} from './security-master.js';

/**
 * CLI importer for a reviewed official NSE/CDSC security master.
 *
 * Parsing and validation live in `security-master.ts` and are unit tested. This file
 * performs the database write inside a single transaction and flags every record for
 * administrator review; it does not verify the source's data-use rights.
 */
export async function importSecurities(
  rows: ParsedSecurityRow[],
  sourceUrl: string,
  verifiedAt: Date,
  pool: Pool
): Promise<number> {
  await pool.query('BEGIN');
  try {
    for (const item of rows) {
      await pool.query(
        `INSERT INTO securities (symbol,name,exchange,instrument_type,listing_status,sector,currency,source,source_verified_at,review_required,updated_at)
         VALUES ($1,$2,'NSE',$3,$4,$5,'KES',$6,$7,true,now())
         ON CONFLICT (exchange,symbol) DO UPDATE SET name=EXCLUDED.name,instrument_type=EXCLUDED.instrument_type,listing_status=EXCLUDED.listing_status,sector=EXCLUDED.sector,source=EXCLUDED.source,source_verified_at=EXCLUDED.source_verified_at,review_required=true,updated_at=now()`,
        [item.symbol, item.name, item.type, item.status, item.sector, sourceUrl, verifiedAt]
      );
    }
    await pool.query('COMMIT');
    return rows.length;
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const sourceUrl = process.env.SECURITY_MASTER_SOURCE_URL;
  const verifiedAtRaw = process.env.SECURITY_MASTER_VERIFIED_AT;
  if (!config.DATABASE_URL || !path || !sourceUrl || !verifiedAtRaw) {
    console.error(
      'Usage: SECURITY_MASTER_SOURCE_URL=https://official-source/... SECURITY_MASTER_VERIFIED_AT=ISO-8601 DATABASE_URL=... npx tsx src/server/db/import-securities.ts securities.csv'
    );
    process.exitCode = 1;
    return;
  }

  let source: URL;
  let verifiedDate: Date;
  let rows: ParsedSecurityRow[];
  try {
    source = validateSourceUrl(sourceUrl);
    verifiedDate = validateVerifiedAt(verifiedAtRaw);
    rows = parseSecurityMasterCsv(await readFile(path, 'utf8'));
  } catch (error) {
    console.error(error instanceof SecurityMasterFormatError ? error.message : 'Unable to read or parse the CSV file.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  try {
    const imported = await importSecurities(rows, sourceUrl, verifiedDate, pool);
    console.log(
      `Imported ${imported} securities from ${source.href}. All records are flagged for administrator review; this does not verify the source's data-use rights.`
    );
  } finally {
    await pool.end();
  }
}

await main();
