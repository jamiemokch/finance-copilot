import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedSpreadsheetAudit } from './guided-spreadsheet-audit.js';

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