import { describe, expect, it } from 'vitest';
import {
  SecurityMasterFormatError,
  parseCsv,
  parseSecurityMasterCsv,
  resolveColumns,
  validateSecurityRows,
  validateSourceUrl,
  validateVerifiedAt
} from '../../src/server/db/security-master.js';

describe('CSV parsing', () => {
  it('handles quoted cells, escaped quotes, CRLF newlines and a UTF-8 BOM', () => {
    const rows = parseCsv('\uFEFFsymbol,name\r\nSCOM,"Safaricom, PLC"\r\nEQTY,"He said ""hi"""\r\n');
    expect(rows).toEqual([
      ['symbol', 'name'],
      ['SCOM', 'Safaricom, PLC'],
      ['EQTY', 'He said "hi"']
    ]);
  });

  it('keeps newlines inside quoted cells and skips blank rows', () => {
    const rows = parseCsv('a,b\n"line1\nline2",c\n\n\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'c']
    ]);
  });

  it('parses a trailing row without a newline', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });
});

describe('column resolution', () => {
  it('normalises header casing and whitespace', () => {
    const columns = resolveColumns(['Symbol', ' Name ', 'InstrumentType', 'ListingStatus', 'Sector']);
    expect(columns).toEqual({ symbol: 0, name: 1, instrumenttype: 2, listingstatus: 3, sector: 4 });
  });

  it('rejects headers missing required columns', () => {
    expect(() => resolveColumns(['symbol', 'name'])).toThrow(SecurityMasterFormatError);
    expect(() => resolveColumns(undefined)).toThrow(/must include columns/);
  });
});

describe('row validation', () => {
  const columns = resolveColumns(['symbol', 'name', 'instrumentType', 'listingStatus', 'sector']);

  it('upper-cases symbols and trims values', () => {
    const [row] = validateSecurityRows([[' scom ', ' Safaricom PLC ', 'EQUITY', 'LISTED', ' Telecom ']], columns);
    expect(row).toMatchObject({
      rowNo: 2,
      symbol: 'SCOM',
      name: 'Safaricom PLC',
      type: 'EQUITY',
      status: 'LISTED',
      sector: 'Telecom'
    });
  });

  it('treats an empty optional sector as null', () => {
    const [row] = validateSecurityRows([['EQTY', 'Equity', 'EQUITY', 'LISTED', '']], columns);
    expect(row?.sector).toBeNull();
  });

  it('rejects symbols with unsafe characters and reports the CSV row', () => {
    expect(() => validateSecurityRows([['OK', 'Fine', 'EQUITY', 'LISTED', '']], columns)).not.toThrow();
    expect(() => validateSecurityRows([['<script>', 'Bad', 'EQUITY', 'LISTED', '']], columns)).toThrow(/row 2/);
  });

  it('rejects missing required values', () => {
    expect(() => validateSecurityRows([['SCOM', '', 'EQUITY', 'LISTED', '']], columns)).toThrow(
      /Invalid required fields/
    );
  });

  it('rejects duplicate symbols in one import', () => {
    expect(() =>
      validateSecurityRows(
        [
          ['SCOM', 'One', 'EQUITY', 'LISTED', ''],
          ['scom', 'Two', 'EQUITY', 'LISTED', '']
        ],
        columns
      )
    ).toThrow(/Duplicate symbol SCOM/);
  });
});

describe('source and timestamp validation', () => {
  it('accepts only official HTTPS NSE/CDSC hosts', () => {
    expect(validateSourceUrl('https://www.nse.co.ke/list.csv').hostname).toBe('www.nse.co.ke');
    expect(validateSourceUrl('https://cdsckenya.com/list.csv').protocol).toBe('https:');
    expect(() => validateSourceUrl('http://www.nse.co.ke/list.csv')).toThrow(/HTTPS NSE or CDSC/);
    expect(() => validateSourceUrl('https://example.com/nse.csv')).toThrow(/HTTPS NSE or CDSC/);
    expect(() => validateSourceUrl('not a url')).toThrow(SecurityMasterFormatError);
  });

  it('requires a valid ISO verification timestamp', () => {
    expect(validateVerifiedAt('2026-10-25T09:00:00+03:00').toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(() => validateVerifiedAt('yesterday')).toThrow(/ISO timestamp/);
  });
});

describe('end-to-end CSV parsing', () => {
  it('parses a valid document', () => {
    const rows = parseSecurityMasterCsv(
      'symbol,name,instrumentType,listingStatus\nSCOM,Safaricom PLC,EQUITY,LISTED\nKEGN,KenGen,EQUITY,LISTED\n'
    );
    expect(rows.map((row) => row.symbol)).toEqual(['SCOM', 'KEGN']);
  });

  it('surfaces a format error for an invalid document', () => {
    expect(() => parseSecurityMasterCsv('symbol,name\nSCOM,Safaricom')).toThrow(SecurityMasterFormatError);
  });
});
