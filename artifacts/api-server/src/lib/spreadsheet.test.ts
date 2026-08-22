import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  analyseSpreadsheet,
  inspectSpreadsheet,
  mapSpreadsheetRow,
  parseSpreadsheet,
  ukTaxYear,
  type SpreadsheetMapping,
} from './spreadsheet.js';
import { aiSampleForWorkbook } from './spreadsheet-understanding.js';

const debitCreditMapping: SpreadsheetMapping = {
  columns: { date: 0, description: 1, debit: 2, credit: 3 },
};

const expectedRows = [
  { date: '2026-08-21', description: 'Card settlement', amount: -25.25 },
  { date: '2026-08-21', description: 'Card settlement', amount: 25.25 },
];

function mappedDataRows(rows: string[][]) {
  return rows.slice(1).map(row => mapSpreadsheetRow(row, debitCreditMapping));
}

test('CSV mapping keeps same-day debit and credit source rows distinct', () => {
  const csv = [
    'Date,Description,Debit,Credit',
    '21/08/2026,Card settlement,25.25,',
    '21/08/2026,Card settlement,,25.25',
  ].join('\n');

  assert.deepEqual(mappedDataRows(parseSpreadsheet(Buffer.from(csv), 'text/csv', 'bank-export.csv')), expectedRows);
});

test('XLSX mapping keeps the same signed source rows as CSV', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Debit', 'Credit'],
    ['21/08/2026', 'Card settlement', 25.25, ''],
    ['21/08/2026', 'Card settlement', '', 25.25],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  assert.deepEqual(
    mappedDataRows(parseSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'bank-export.xlsx')),
    expectedRows,
  );
});

test('workbook inspection retains every worksheet and keeps UK tax years across 5 April', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Monthly statement'], ['Date', 'Description', 'Amount'],
    ['05/04/2025', 'Prior tax year payment', '-12.50'],
    ['06/04/2025', 'New tax year sale', '125.00'],
  ]), 'Transactions');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Balance sheet'], ['Total', '112.50'],
  ]), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty notes');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const inspected = inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'cross-year.xlsx');
  const analysis = analyseSpreadsheet(inspected);
  assert.equal(inspected.sheets.length, 3);
  assert.deepEqual(inspected.sheets.map((sheet) => sheet.sheetId), ['sheet_1', 'sheet_2', 'sheet_3']);
  assert.deepEqual(analysis.taxYears, ['2024-2025', '2025-2026']);
  assert.equal(analysis.sheets[0]?.role, 'transactional');
  assert.equal(analysis.sheets[2]?.disposition, 'empty_sheet');
});

test('CSV inspection preserves quoted multiline fields as one logical source row', () => {
  const csv = `Date,Description,Amount
06/04/2025,"Client note
continued",-42.00
`;
  const inspected = inspectSpreadsheet(Buffer.from(csv), 'text/csv', 'multiline.csv');
  assert.equal(inspected.sheets[0]?.rows.length, 2);
  assert.equal(inspected.sheets[0]?.rows[1]?.values[1], 'Client note\ncontinued');
  assert.equal(ukTaxYear('2025-04-05'), '2024-2025');
  assert.equal(ukTaxYear('2025-04-06'), '2025-2026');
});

test('AI workbook samples retain structural signals without sending payment narrative or PII', () => {
  const csv = [
    'Date,Description,Amount',
    '06/04/2025,"Jane Example, +44 7700 900123, jane@example.com",-42.00',
  ].join('\n');
  const workbook = inspectSpreadsheet(Buffer.from(csv), 'text/csv', 'private.csv');
  const sample = aiSampleForWorkbook(workbook, analyseSpreadsheet(workbook));
  const encoded = JSON.stringify(sample);
  assert.match(encoded, /\[header:date\]/);
  assert.match(encoded, /\[number:negative\]/);
  assert.doesNotMatch(encoded, /Jane Example|7700|jane@example\.com/);
});