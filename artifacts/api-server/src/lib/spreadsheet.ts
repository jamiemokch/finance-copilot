import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

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

export function looksLikeHeader(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(date|amount|description|reference|debit|credit|balance|category|memo)/.test(text);
}

export function looksLikeBalanceRow(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(opening|closing|running|balance|brought forward|carried forward|total)/.test(text);
}