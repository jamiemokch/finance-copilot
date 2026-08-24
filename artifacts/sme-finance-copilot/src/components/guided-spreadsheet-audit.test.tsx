import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedSpreadsheetAudit } from './guided-spreadsheet-audit.js';
import { GuidedSpreadsheetReview, ImportChecklist, SpreadsheetServerIssues, confirmationBlockersForReview } from './guided-spreadsheet-review.js';

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