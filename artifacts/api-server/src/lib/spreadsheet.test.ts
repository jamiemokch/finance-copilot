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

test('workbook understanding keeps reference tabs out of the default import and recognises Chinese ledger headings', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['交易日期', '內容', '金額'],
    ['06/04/2025', 'Sale', '125.00'],
  ]), '生意記錄');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Account', 'Balance'],
    ['Cash', '125.00'],
  ]), 'TB');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['A few notes with no transaction columns'],
  ]), 'Sheet1');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const analysis = analyseSpreadsheet(inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'yatson.xlsx'));

  assert.equal(analysis.sheets[0]?.role, 'transactional');
  assert.equal(analysis.sheets[0]?.selected, true);
  assert.equal(analysis.sheets[1]?.role, 'non_transactional');
  assert.equal(analysis.sheets[1]?.selected, false);
  assert.equal(analysis.sheets[1]?.auditVisibility, 'advanced');
  assert.equal(analysis.sheets[2]?.role, 'unknown');
  assert.equal(analysis.sheets[2]?.reviewRequired, true);
});

test('the exact 17-sheet Yatson workbook keeps references hidden and proposes only structured money sheets', () => {
  const workbook = XLSX.utils.book_new();
  for (const name of ['Master data', 'Query', 'FS', 'TB', 'Queries']) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Label', 'Value'], ['Reference', '1']]), name);
  }
  for (const name of ['Bank C.A.', 'Bank S.A.', 'Staff cost v2', "Director's current", 'Revenue', 'Trade receivables', 'os inv', 'Staff cost', 'COS']) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      ['06/04/2025', `${name} movement`, '125.00'],
    ]), name);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['交易日期', '內容', '金額'],
    ['07/04/2025', 'Sale', '75.00'],
  ]), '生意記錄');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Unclear notes only']]), 'Sheet1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Unclear notes only']]), 'Sheet1 (2)');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const analysis = analyseSpreadsheet(inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'yatson-17.xlsx'));

  assert.equal(analysis.sheets.length, 17);
  const byName = new Map(analysis.sheets.map((sheet) => [sheet.displayName, sheet]));
  for (const name of ['Master data', 'Query', 'FS', 'TB', 'Queries']) {
    assert.equal(byName.get(name)?.role, 'non_transactional', `${name} is reference-only`);
    assert.equal(byName.get(name)?.selected, false, `${name} is hidden from the default review`);
    assert.equal(byName.get(name)?.auditVisibility, 'advanced', `${name} remains auditable`);
  }
  const expectedTransactional = ['Bank C.A.', 'Bank S.A.', 'Staff cost v2', "Director's current", 'Revenue', 'Trade receivables', 'os inv', 'Staff cost', 'COS', '生意記錄'];
  assert.deepEqual(
    analysis.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.displayName),
    expectedTransactional,
    'only dated, described monetary schedules are proposed by default',
  );
  for (const name of ['Sheet1', 'Sheet1 (2)']) {
    assert.equal(byName.get(name)?.role, 'unknown', `${name} stays ambiguous`);
    assert.equal(byName.get(name)?.reviewRequired, true, `${name} needs a targeted decision`);
    assert.equal(byName.get(name)?.selected, false, `${name} cannot be silently imported`);
  }
  assert.equal(byName.get('生意記錄')?.role, 'transactional', 'Chinese sheet names are judged by their structure, not rejected by name');
});

test('coverage is calculated only from valid parsed dates, never a sheet name or arbitrary text', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['1-Apr-22', '生意記錄', '125.00'],
  ]), 'Revenue');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const analysis = analyseSpreadsheet(inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'coverage-check.xlsx'));

  assert.equal(analysis.coverage.startDate, null);
  assert.equal(analysis.coverage.endDate, null);
  assert.equal(analysis.coverage.status, 'partial');
  assert.deepEqual(analysis.taxYears, []);
  assert.equal(analysis.sheets[0]?.rows[1]?.normalizedValueReference.date, null);
});

test('CSV inspection preserves quoted multiline fields as one logical source row', () => {
  const csv = `Date,Description,Amount
06/04/2025,"Client note
continued",-42.00
`;
  const inspected = inspectSpreadsheet(Buffer.from(csv), 'text/csv', 'multiline.csv');
  assert.equal(inspected.sheets[0]?.rows.length, 2);
  assert.equal(inspected.sheets[0]?.rows[1]?.values[1], 'Client note\ncontinued');
  assert.deepEqual(
    inspected.sheets[0]?.rows.map((row) => [row.physicalLineStart, row.physicalLineEnd]),
    [[1, 1], [2, 3]],
    'logical CSV rows retain their physical source-line span',
  );
  assert.equal(ukTaxYear('2025-04-05'), '2024-2025');
  assert.equal(ukTaxYear('2025-04-06'), '2025-2026');
});

test('a merged category label spanning multiple rows fills down to every covered row', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Category', 'Amount'],
    ['01/05/2025', 'Office supplies', -20],
    ['02/05/2025', '', -15],
    ['03/05/2025', '', -30],
  ]);
  worksheet['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 3, c: 1 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const inspected = inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'merged-category.xlsx');
  const analysis = analyseSpreadsheet(inspected, {
    selectedSheetIds: ['sheet_1'],
    sheetMappings: { sheet_1: { columns: { date: 0, category: 1, amount: 2 } } },
  });

  const rows = analysis.sheets[0]!.rows.filter((row) => row.sourceRow >= 2 && row.sourceRow <= 4);
  assert.deepEqual(rows.map((row) => row.primaryDisposition), ['imported', 'imported', 'imported']);
  assert.deepEqual(rows.map((row) => row.normalizedValueReference.description), ['Office supplies', 'Office supplies', 'Office supplies']);
  const filledCell = inspected.sheets[0]!.rows.find((row) => row.rowNumber === 3)!.cells[1]!;
  assert.equal(filledCell.value, 'Office supplies');
  assert.equal(filledCell.merged, true);
  assert.deepEqual(filledCell.mergeTopLeft, { rowNumber: 2, columnId: 'col_B' });
});

test('a merged date spanning multiple transaction rows fills down instead of leaving later rows unresolved', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['01/05/2025', 'Coffee', -3.5],
    ['', 'Lunch', -8.2],
    ['02/05/2025', 'Taxi', -12],
  ]);
  worksheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const inspected = inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'merged-date.xlsx');
  const analysis = analyseSpreadsheet(inspected, {
    selectedSheetIds: ['sheet_1'],
    sheetMappings: { sheet_1: { columns: { date: 0, description: 1, amount: 2 } } },
  });

  const lunchRow = analysis.sheets[0]!.rows.find((row) => row.normalizedValueReference.description === 'Lunch');
  assert.equal(lunchRow?.primaryDisposition, 'imported');
  assert.equal(lunchRow?.normalizedValueReference.date, '2025-05-01');
});

test('a running-balance column is never treated as the transaction amount', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount', 'Balance'],
    ['02/05/2025', 'Coffee', '3.50 DR', '996.50'],
    ['03/05/2025', 'Salary', '2000.00', '2996.50'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement');
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const analysis = analyseSpreadsheet(inspectSpreadsheet(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'running-balance.xlsx'));

  const sheet = analysis.sheets[0]!;
  assert.equal(sheet.mapping.columns.amount, 2);
  assert.equal(sheet.mapping.columns.balance, 3);
  const byDescription = new Map(sheet.rows.map((row) => [row.normalizedValueReference.description, row.normalizedValueReference.amount]));
  assert.equal(byDescription.get('Coffee'), -3.5);
  assert.equal(byDescription.get('Salary'), 2000);
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