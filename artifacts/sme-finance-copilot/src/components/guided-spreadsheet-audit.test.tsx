import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedSpreadsheetAudit } from './guided-spreadsheet-audit.js';
import { GuidedSpreadsheetReview, ImportChecklist, SpreadsheetServerIssues, confirmationBlockersForReview, unresolvedReviewSheets } from './guided-spreadsheet-review.js';
import { AutomaticReviewRecoveryActions } from './automatic-review-recovery.js';

const sheets = [
  { sheetId: 'sheet_1', displayName: 'Bank C.A.', dimensions: { rows: 12, columns: 3 }, disposition: 'processed', role: 'transactional' as const, confidence: 88 },
  { sheetId: 'sheet_2', displayName: 'Master data', dimensions: { rows: 4, columns: 2 }, disposition: 'unselected_sheet', role: 'non_transactional' as const, confidence: 96 },
];

function render(advancedOpen: boolean, aiDetail?: string | null) {
  return renderToStaticMarkup(<GuidedSpreadsheetAudit
    advancedOpen={advancedOpen}
    sheets={sheets}
    aiDetail={aiDetail}
    selectedSheetIds={['sheet_1']}
    sheetRoleOverrides={{}}
    saving={false}
    onToggle={() => undefined}
    onToggleSheet={() => undefined}
    onSetRole={() => undefined}
    onCorrectSheet={() => undefined}
  />);
}

test('advanced worksheet inventory is absent from the default DOM for every AI outcome', () => {
  for (const outcome of ['success', 'malformed response', 'timeout', 'unavailable provider', 'rate limit', 'low confidence']) {
    const html = render(false, outcome);
    assert.match(html, /Advanced audit details/);
    assert.doesNotMatch(html, /worksheet-inventory|Bank C\.A\.|Master data|Correct columns|<select/);
  }
});

test('opening Advanced audit details mounts the auditable worksheet inventory', () => {
  const html = render(true, 'AI analysis timed out.');
  assert.match(html, /worksheet-inventory/);
  assert.match(html, /Bank C\.A\./);
  assert.match(html, /Master data/);
  assert.match(html, /Suggestion detail: AI analysis timed out/);
});

test('reference and reporting tabs never require transaction mappings to save the selected ledger', () => {
  const selectedLedger = {
    sheetId: 'ledger', displayName: '生意記錄', selected: true, role: 'transactional' as const, reviewRequired: false,
    dimensions: { rows: 3, columns: 3 }, mapping: { headerRow: 0, columns: { date: 0, description: 1, amount: 2 } }, previewRows: [], rows: [],
  };
  const excludedReferenceTabs = ['Master data', 'Query', 'FS '].map((displayName, index) => ({
    sheetId: `reference_${index}`, displayName, selected: false, role: 'non_transactional' as const, reviewRequired: false,
    dimensions: { rows: 2, columns: 2 }, mapping: { headerRow: 0, columns: {} }, previewRows: [], rows: [],
  }));
  assert.deepEqual(unresolvedReviewSheets([selectedLedger, ...excludedReferenceTabs], {}), []);
  assert.deepEqual(confirmationBlockersForReview({
    unresolvedSheetNames: [], selectedSheetCount: 1, taxYearCount: 1, incompleteRowCount: 0, incompleteRowsAcknowledged: false,
  }), []);
});

const yatsonReviewSheets = [
  {
    sheetId: 'sheet_staff', displayName: 'Staff cost v2', selected: false, role: 'transactional' as const, reviewRequired: true,
    dimensions: { rows: 4, columns: 3 }, mapping: { headerRow: 0, columns: { date: 0, description: 1 } },
    previewRows: [{ rowNumber: 1, values: ['Date', 'Staff member', 'Value'] }, { rowNumber: 2, values: ['06/04/2025', 'Ada', '350'] }], rows: [],
  },
  {
    sheetId: 'sheet_revenue', displayName: 'Revenue', selected: false, role: 'transactional' as const, reviewRequired: true,
    dimensions: { rows: 4, columns: 3 }, mapping: { headerRow: 0, columns: { date: 0, amount: 2 } },
    previewRows: [{ rowNumber: 1, values: ['Date', 'Customer', 'Amount'] }, { rowNumber: 2, values: ['06/04/2025', 'Client A', '500'] }], rows: [],
  },
  {
    sheetId: 'sheet_receivables', displayName: 'Trade receivables', selected: false, role: 'unknown' as const, reviewRequired: true,
    dimensions: { rows: 3, columns: 2 }, mapping: { headerRow: 0, columns: {} },
    previewRows: [{ rowNumber: 1, values: ['Customer', 'Balance'] }, { rowNumber: 2, values: ['Client A', '900'] }], rows: [],
  },
  {
    sheetId: 'sheet_director', displayName: "Director's current", selected: true, role: 'transactional' as const, reviewRequired: false,
    dimensions: { rows: 3, columns: 3 }, mapping: { headerRow: 0, columns: { date: 0, description: 1, amount: 2 } },
    previewRows: [{ rowNumber: 1, values: ['Date', 'Details', 'Amount'] }, { rowNumber: 2, values: ['06/04/2025', 'Drawings', '-300'] }], rows: [],
  },
];

test('Yatson uncertainty cards explain the precise gap and offer layman choices', () => {
  const html = renderToStaticMarkup(<GuidedSpreadsheetReview
    sheets={yatsonReviewSheets}
    selectedSheetIds={['sheet_director']}
    resolutions={{}}
    saving={false}
    checkingSheetId=""
    onCheckingSheet={() => undefined}
    onResolve={() => undefined}
    onCorrect={() => undefined}
  />);
  assert.match(html, /Staff cost v2/);
  assert.match(html, /cannot tell which column contains the money amount/);
  assert.match(html, /Revenue/);
  assert.match(html, /cannot tell what each entry is for/);
  assert.match(html, /Trade receivables/);
  assert.match(html, /whether it is a list of individual payments or a summary/);
  assert.match(html, /Include as income records/);
  assert.match(html, /This duplicates another sheet/);
  assert.match(html, /Use another named column/);
});

test('automatic-review failure can suppress all worksheet question cards until manual recovery is selected', () => {
  const html = renderToStaticMarkup(<GuidedSpreadsheetReview
    enabled={false}
    sheets={yatsonReviewSheets}
    selectedSheetIds={[]}
    resolutions={{}}
    saving={false}
    checkingSheetId=""
    onCheckingSheet={() => undefined}
    onResolve={() => undefined}
    onCorrect={() => undefined}
  />);
  assert.equal(html, '');
});

test('an exhausted automatic review shows manual recovery without a stale retry action', () => {
  const html = renderToStaticMarkup(<AutomaticReviewRecoveryActions
    retryAvailable={false}
    saving={false}
    onRetry={() => undefined}
    onManualRecovery={() => undefined}
  />);
  assert.doesNotMatch(html, /retry-automatic-spreadsheet-review|Retry automatic review/);
  assert.match(html, /start-manual-spreadsheet-recovery|Start manual recovery/);
});

test('ready sheets explain detected fields and unresolved review blocks confirmation locally', () => {
  const readyHtml = renderToStaticMarkup(<GuidedSpreadsheetReview
    sheets={yatsonReviewSheets}
    selectedSheetIds={['sheet_director']}
    resolutions={{}}
    saving={false}
    checkingSheetId="sheet_director"
    onCheckingSheet={() => undefined}
    onResolve={() => undefined}
    onCorrect={() => undefined}
  />);
  assert.match(readyHtml, /Check what we found/);
  assert.match(readyHtml, /using “Date”/);
  assert.match(readyHtml, /using “Details”/);
  assert.doesNotMatch(readyHtml, /Correct this/);
  assert.deepEqual(
    confirmationBlockersForReview({
      unresolvedSheetNames: ['Staff cost v2'],
      selectedSheetCount: 1,
      taxYearCount: 1,
      incompleteRowCount: 0,
      incompleteRowsAcknowledged: false,
    }),
    ['Answer the question about “Staff cost v2”.'],
  );
  const checklist = renderToStaticMarkup(<ImportChecklist selectedSheets={[yatsonReviewSheets[3]]} leftOutCount={3} taxYears={['2025-2026']} unresolved={['Answer the question about “Staff cost v2”.']} />);
  assert.match(checklist, /Still needed before import/);
});

test('a saved Staff cost v2 money-column correction clears the local blocker immediately', () => {
  const unresolved = yatsonReviewSheets.find((sheet) => sheet.sheetId === 'sheet_staff')!;
  const resolution = { sheet_staff: 'include_expense' as const };
  assert.deepEqual(
    unresolvedReviewSheets([unresolved], resolution).map((sheet) => sheet.displayName),
    ['Staff cost v2'],
    'the sheet remains blocked until a money column is saved',
  );

  const corrected = {
    ...unresolved,
    mapping: { ...unresolved.mapping, columns: { ...unresolved.mapping.columns, amount: 2 } },
  };
  assert.deepEqual(unresolvedReviewSheets([corrected], resolution), []);
  assert.deepEqual(
    confirmationBlockersForReview({
      unresolvedSheetNames: unresolvedReviewSheets([corrected], resolution).map((sheet) => sheet.displayName),
      selectedSheetCount: 1,
      taxYearCount: 1,
      incompleteRowCount: 0,
      incompleteRowsAcknowledged: false,
    }),
    [],
    'a durable effective mapping leaves no stale Staff cost blocker',
  );
});

test('an incomplete correction stays blocked and a failed save keeps plain-language guidance visible', () => {
  const unresolved = yatsonReviewSheets.find((sheet) => sheet.sheetId === 'sheet_staff')!;
  const resolution = { sheet_staff: 'include_expense' as const };
  const incomplete = {
    ...unresolved,
    mapping: { ...unresolved.mapping, columns: { date: 0, description: 1 } },
  };
  assert.deepEqual(
    unresolvedReviewSheets([incomplete], resolution).map((sheet) => sheet.displayName),
    ['Staff cost v2'],
  );
  const failureHtml = renderToStaticMarkup(<SpreadsheetServerIssues
    issues={[{
      sheetId: 'sheet_staff',
      worksheet: 'Staff cost v2',
      field: 'selection',
      message: 'Check the named columns for this sheet and choose them again.',
    }]}
    onShowSheet={() => undefined}
  />);
  assert.match(failureHtml, /Check the named columns for this sheet and choose them again/);
  assert.match(failureHtml, /Show this sheet/);
});

test('a server rejection becomes a specific, sheet-linked next step instead of a generic error', () => {
  const html = renderToStaticMarkup(<SpreadsheetServerIssues
    issues={[{
      sheetId: 'sheet_staff',
      worksheet: 'Staff cost v2',
      rowNumber: 7,
      field: 'amount',
      message: 'In “Staff cost v2”, row 7 is missing a usable money amount. Choose another named column, or leave this sheet out for now.',
    }]}
    onShowSheet={() => undefined}
  />);
  assert.match(html, /Staff cost v2/);
  assert.match(html, /missing a usable money amount/);
  assert.match(html, /Show this sheet/);
  assert.doesNotMatch(html, /selected sheets, mappings, and filing scope/i);
});