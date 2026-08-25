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

test('deterministic review keeps selected sheets and editable column suggestions when semantic AI is unavailable', () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,Manual review sale,125.00',
    '07/04/2025,Manual review expense,-42.00',
  ].join('\n')), 'text/csv', 'manual-fallback.csv');
  const analysis = analyseSpreadsheet(workbook, {
    semanticMode: 'deterministic',
    decisionSource: 'deterministic',
  });
  const sheet = analysis.sheets[0];
  assert.equal(sheet?.selected, true);
  assert.equal(sheet?.mapping.columns.date, 0);
  assert.equal(sheet?.mapping.columns.description, 1);
  assert.equal(sheet?.mapping.columns.amount, 2);
  assert.deepEqual(analysis.taxYears, ['2025-2026']);

  const manuallyCorrected = analyseSpreadsheet(workbook, {
    selectedSheetIds: ['sheet_1'],
    roleOverrides: { sheet_1: 'transactional' },
    sheetMappings: {
      sheet_1: { headerRow: 0, columns: { date: 0, description: 1, amount: 2 } },
    },
    decisionSource: 'user',
  });
  assert.equal(manuallyCorrected.sheets[0]?.disposition, 'processed');
  assert.equal(manuallyCorrected.sheets[0]?.rows.filter((row) => row.primaryDisposition === 'imported').length, 2);
});

test('deterministic review accepts amount-only, debit-only, credit-only, and paired money mappings', () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount,Debit,Credit',
    '06/04/2025,Movement,125.00,10.00,25.00',
  ].join('\n')), 'text/csv', 'money-mapping-shapes.csv');
  const review = (columns: SpreadsheetMapping['columns']) => analyseSpreadsheet(workbook, {
    selectedSheetIds: ['sheet_1'],
    roleOverrides: { sheet_1: 'transactional' },
    sheetMappings: { sheet_1: { headerRow: 0, columns } },
    decisionSource: 'user',
  }).sheets[0]!;

  for (const columns of [
    { date: 0, description: 1, amount: 2 },
    { date: 0, description: 1, debit: 3 },
    { date: 0, description: 1, credit: 4 },
    { date: 0, description: 1, debit: 3, credit: 4 },
  ]) {
    const sheet = review(columns);
    assert.equal(sheet.disposition, 'processed');
    assert.equal(sheet.rows[1]?.primaryDisposition, 'imported');
  }

  const noMoney = review({ date: 0, description: 1 });
  assert.equal(noMoney.disposition, 'blocked_invalid_mapping');
  assert.equal(noMoney.rows[1]?.primaryDisposition, 'unmapped');
});

test('one-sided debit and credit mappings preserve the existing signed direction semantics', () => {
  const row = ['06/04/2025', 'Movement', '125.00', '10.00', '25.00'];
  assert.equal(mapSpreadsheetRow(row, { columns: { date: 0, description: 1, debit: 3 } }).amount, -10);
  assert.equal(mapSpreadsheetRow(row, { columns: { date: 0, description: 1, credit: 4 } }).amount, 25);
});

test('the three selected bank-sheet mapping shapes are eligible for deterministic projection', () => {
  const workbookSource = XLSX.utils.book_new();
  const addBankSheet = (name: string, descriptionColumn: number, balanceColumn: number, creditColumn: number) => {
    const headers = Array.from({ length: 16 }, (_, index) => `Column ${index + 1}`);
    headers[0] = 'Date';
    headers[descriptionColumn] = 'Description';
    headers[balanceColumn] = 'Balance';
    headers[creditColumn] = 'Credit';
    const movement = Array.from({ length: 16 }, () => '');
    movement[0] = '06/04/2025';
    movement[descriptionColumn] = `${name} movement`;
    movement[balanceColumn] = '100.00';
    movement[creditColumn] = '25.00';
    XLSX.utils.book_append_sheet(workbookSource, XLSX.utils.aoa_to_sheet([headers, movement]), name);
  };
  addBankSheet('Bank C.A.', 5, 7, 14);
  addBankSheet('Bank S.A.', 5, 7, 15);
  addBankSheet("Director's current", 4, 6, 13);
  const workbook = inspectSpreadsheet(
    XLSX.write(workbookSource, { type: 'buffer', bookType: 'xlsx' }),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'bank-shapes.xlsx',
  );
  const mappings = [
    { sheetId: 'sheet_1', columns: { date: 0, credit: 14, balance: 7, description: 5 } },
    { sheetId: 'sheet_2', columns: { date: 0, credit: 15, balance: 7, description: 5 } },
    { sheetId: 'sheet_3', columns: { date: 0, credit: 13, balance: 6, description: 4 } },
  ];
  for (const { sheetId, columns } of mappings) {
    const sheet = analyseSpreadsheet(workbook, {
      selectedSheetIds: ['sheet_1', 'sheet_2', 'sheet_3'],
      roleOverrides: { sheet_1: 'transactional', sheet_2: 'transactional', sheet_3: 'transactional' },
      sheetMappings: { [sheetId]: { headerRow: 0, columns } },
      decisionSource: 'deterministic',
    }).sheets.find((candidate) => candidate.sheetId === sheetId)!;
    assert.equal(sheet.disposition, 'processed');
    assert.equal(sheet.rows[1]?.primaryDisposition, 'imported');
  }
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