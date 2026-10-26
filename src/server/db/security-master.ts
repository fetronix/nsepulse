/**
 * Security-master import helpers.
 *
 * Pure parsing and validation logic lives here so it can be unit tested without a
 * database or network access. `import-securities.ts` is the thin CLI wrapper.
 */

export interface ParsedSecurityRow {
  rowNo: number;
  symbol: string;
  name: string;
  type: string;
  status: string;
  sector: string | null;
}

export const REQUIRED_COLUMNS = ['symbol', 'name', 'instrumenttype', 'listingstatus'] as const;

/** Hosts whose published lists may be imported. Anything else is rejected outright. */
export const ALLOWED_SOURCE_HOSTS = ['nse.co.ke', 'www.nse.co.ke', 'cdsckenya.com', 'www.cdsckenya.com'];

/** Minimal RFC 4180-style CSV parser: quoted cells, escaped quotes, CRLF and BOM. */
export function parseCsv(text: string): string[][] {
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

export interface ColumnIndexes {
  symbol: number;
  name: number;
  instrumenttype: number;
  listingstatus: number;
  sector?: number;
}

export class SecurityMasterFormatError extends Error {}

/** Map a header row to column indexes, throwing when required columns are absent. */
export function resolveColumns(header: string[] | undefined): ColumnIndexes {
  const normalised = header?.map((value) => value.toLowerCase().replace(/\s+/g, '')) ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !normalised.includes(column));
  if (missing.length) {
    throw new SecurityMasterFormatError(`CSV must include columns: ${REQUIRED_COLUMNS.join(', ')}`);
  }
  const indexes = Object.fromEntries(normalised.map((column, index) => [column, index])) as Record<string, number>;
  return {
    symbol: indexes.symbol!,
    name: indexes.name!,
    instrumenttype: indexes.instrumenttype!,
    listingstatus: indexes.listingstatus!,
    sector: indexes.sector
  };
}

/**
 * Validate and normalise security rows. Symbols are upper-cased, required fields must
 * be present and duplicate symbols within one file are rejected rather than guessed.
 */
export function validateSecurityRows(rows: string[][], columns: ColumnIndexes): ParsedSecurityRow[] {
  const parsed = rows.map((row, index) => ({
    rowNo: index + 2,
    symbol: (row[columns.symbol] ?? '').trim(),
    name: (row[columns.name] ?? '').trim(),
    type: (row[columns.instrumenttype] ?? '').trim(),
    status: (row[columns.listingstatus] ?? '').trim(),
    sector: columns.sector === undefined ? null : row[columns.sector]?.trim() || null
  }));
  const seen = new Set<string>();
  for (const item of parsed) {
    const symbol = item.symbol.toUpperCase();
    if (!/^[A-Z0-9.-]{1,32}$/.test(symbol) || !item.name || !item.type || !item.status) {
      throw new SecurityMasterFormatError(`Invalid required fields at CSV row ${item.rowNo}`);
    }
    if (seen.has(symbol)) {
      throw new SecurityMasterFormatError(`Duplicate symbol ${symbol} in input; resolve ambiguity before importing.`);
    }
    seen.add(symbol);
    item.symbol = symbol;
  }
  return parsed;
}

/** Reject non-HTTPS and non-official hosts before any import is attempted. */
export function validateSourceUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SecurityMasterFormatError('Source must be a valid HTTPS NSE or CDSC URL.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_SOURCE_HOSTS.includes(url.hostname)) {
    throw new SecurityMasterFormatError(
      'Source must be an HTTPS NSE or CDSC URL. Review data permissions and source terms before importing.'
    );
  }
  return url;
}

export function validateVerifiedAt(raw: string): Date {
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new SecurityMasterFormatError('SECURITY_MASTER_VERIFIED_AT must be an ISO timestamp.');
  }
  return date;
}

/** Parse a complete CSV document into validated rows. */
export function parseSecurityMasterCsv(text: string): ParsedSecurityRow[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  return validateSecurityRows(rows, resolveColumns(header));
}
