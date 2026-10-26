import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from '../config.js';
import { moduleLogger } from '../logging/logger.js';
import {
  SecurityMasterFormatError,
  parseSecurityMasterCsv,
  validateSourceUrl,
  validateVerifiedAt,
  type ParsedSecurityRow
} from './security-master.js';

const log = moduleLogger('db.import_securities');

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
    log.error(
      {
        job: 'import_securities',
        outcome: 'refused',
        missing: [
          config.DATABASE_URL ? null : 'database connection (DATABASE_URL or SQL_HOST/SQL_DB_NAME/SQL_ADMIN_USER)',
          path ? null : 'CSV path argument',
          sourceUrl ? null : 'SECURITY_MASTER_SOURCE_URL',
          verifiedAtRaw ? null : 'SECURITY_MASTER_VERIFIED_AT'
        ].filter(Boolean)
      },
      'Usage: SECURITY_MASTER_SOURCE_URL=https://official-source/... SECURITY_MASTER_VERIFIED_AT=ISO-8601 npm run db:import-securities -- securities.csv ' +
        '(the database comes from DATABASE_URL or the SQL_* variables)'
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
    log.error(
      {
        job: 'import_securities',
        outcome: 'invalid_input',
        errorClass: error instanceof SecurityMasterFormatError ? 'SecurityMasterFormatError' : 'ReadError',
        errorMessage: error instanceof Error ? error.message : 'Unable to read or parse the CSV file.'
      },
      error instanceof SecurityMasterFormatError ? error.message : 'Unable to read or parse the CSV file.'
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  try {
    const imported = await importSecurities(rows, sourceUrl, verifiedDate, pool);
    log.info(
      { job: 'import_securities', outcome: 'success', imported, sourceHost: source.host },
      `Imported ${imported} securities from ${source.href}. All records are flagged for administrator review; this does not verify the source's data-use rights.`
    );
  } catch (error) {
    log.error(
      {
        job: 'import_securities',
        outcome: 'failure',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : 'unknown error'
      },
      'Security master import failed and was rolled back.'
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
