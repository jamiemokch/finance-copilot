import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  mapSpreadsheetRow,
  parseSpreadsheet,
  type SpreadsheetMapping,
} from './spreadsheet.js';

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