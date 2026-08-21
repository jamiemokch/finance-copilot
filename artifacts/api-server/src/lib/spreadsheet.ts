import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export type SpreadsheetMapping = {
  columns: {
    date?: number;
    amount?: number;
    debit?: number;
    credit?: number;
    description?: number;
    category?: number;
    balance?: number;
  };
};

/**
 * Normalise CSV and Excel uploads into rows of strings. The first row is kept
 * as-is so callers can let the user/AI identify the header row.
 */
export function parseSpreadsheet(buffer: Buffer, mimeType: string, filename = ''): string[][] {
  const isExcel =
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    /\.(xlsx|xls|xlsm)$/i.test(filename);

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      raw: false,
      defval: '',
    }) as string[][];
  }

  return parse(buffer.toString('utf8'), {
    skip_empty_lines: false,
    relax_column_count: true,
    bom: true,
  }).map((row: unknown[]) => row.map((cell) => String(cell ?? '')));
}

export function normaliseCell(value: unknown): string {
  return String(value ?? '').trim();
}

export function parseMoney(value: unknown): number | null {
  const raw = normaliseCell(value).replace(/[£$€,]/g, '').replace(/\s/g, '');
  if (!raw || /^[-–—]$/.test(raw)) return null;
  const negative = /^\(.*\)$/.test(raw);
  const marker = raw.match(/(cr|dr)$/i)?.[1]?.toLowerCase();
  const numberText = raw.replace(/[()]/g, '').replace(/(cr|dr)$/i, '');
  const parsed = Number(numberText);
  if (!Number.isFinite(parsed)) return null;
  // Bank exports use DR for a debit/outgoing payment and CR for a credit/income.
  return negative || marker === 'dr' ? -Math.abs(parsed) : Math.abs(parsed);
}

/**
 * Maps a row using the user's confirmed columns. Debit and credit exports are
 * deliberately kept as separate signed cash facts: a credit wins only when it
 * is actually present, so same-day debit/credit rows never collapse together.
 */
export function mapSpreadsheetRow(row: string[], mapping: SpreadsheetMapping) {
  const col = (name: keyof SpreadsheetMapping['columns']) => {
    const index = mapping.columns[name];
    return index === undefined ? '' : normaliseCell(row[index]);
  };
  const debit = parseMoney(col('debit'));
  const credit = parseMoney(col('credit'));
  const directAmount = parseMoney(col('amount'));
  const amount = directAmount ?? (credit !== null ? Math.abs(credit) : debit !== null ? -Math.abs(debit) : null);

  return {
    date: normaliseImportedDate(col('date')),
    amount,
    description: col('description') || col('category') || 'Imported transaction',
  };
}

export function normaliseImportedDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const uk = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!uk) return trimmed;
  const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
  return `${year}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
}

export function looksLikeHeader(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(date|amount|description|reference|debit|credit|balance|category|memo)/.test(text);
}

export function looksLikeBalanceRow(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(opening|closing|running|balance|brought forward|carried forward|total)/.test(text);
}