import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSpreadsheetResumeEvidence,
  isResumableSpreadsheetEvidence,
  readSpreadsheetResumeEvidenceId,
  setSpreadsheetResumeEvidenceId,
  type SpreadsheetResumeEvidence,
} from './spreadsheet-resume.js';

const profileA = 'profile-a';
const profileB = 'profile-b';
const evidenceId = 'evidence-1';

function evidence(overrides: Partial<SpreadsheetResumeEvidence> = {}): SpreadsheetResumeEvidence {
  return {
    id: evidenceId,
    profileId: profileA,
    evidenceType: 'ledger',
    documentLifecycle: 'active',
    importStatus: 'mapping',
    ...overrides,
  };
}

test('refresh query rehydrates the matching same-profile active unfinished spreadsheet', () => {
  const item = evidence();
  assert.equal(readSpreadsheetResumeEvidenceId('/ingest?tab=review&resume=evidence-1#top'), evidenceId);
  assert.equal(findSpreadsheetResumeEvidence('/ingest?resume=evidence-1', profileA, [item]), item);
});

test('resume query state can be set and cleared without disturbing other URL state', () => {
  const location = '/ingest?tab=review&resume=old-id#top';
  assert.equal(
    setSpreadsheetResumeEvidenceId(location, evidenceId),
    '/ingest?tab=review&resume=evidence-1#top',
  );
  assert.equal(
    setSpreadsheetResumeEvidenceId(location, null),
    '/ingest?tab=review#top',
  );
});

test('missing, completed, inactive, non-ledger, and other-profile evidence is rejected', () => {
  const cases = [
    { location: '/ingest?resume=missing', items: [evidence()], message: 'missing' },
    { location: '/ingest?resume=evidence-1', items: [evidence({ importStatus: 'done' })], message: 'completed' },
    { location: '/ingest?resume=evidence-1', items: [evidence({ documentLifecycle: 'tombstoned' })], message: 'inactive' },
    { location: '/ingest?resume=evidence-1', items: [evidence({ evidenceType: 'bank_csv' })], message: 'non-ledger' },
    { location: '/ingest?resume=evidence-1', items: [evidence({ profileId: profileB })], message: 'other profile' },
  ];

  for (const testCase of cases) {
    assert.equal(
      findSpreadsheetResumeEvidence(testCase.location, profileA, testCase.items),
      null,
      testCase.message,
    );
  }
  assert.equal(isResumableSpreadsheetEvidence(evidence(), profileA), true);
  assert.equal(isResumableSpreadsheetEvidence(evidence({ profileId: profileB }), profileA), false);
});

test('the profile-and-evidence key makes automatic resume invocation exactly once', () => {
  const item = evidence();
  let attemptedKey = '';
  let invocations = 0;

  const maybeResume = (activeProfileId: string, location: string, items: SpreadsheetResumeEvidence[]) => {
    const requestedId = readSpreadsheetResumeEvidenceId(location);
    const attemptKey = requestedId ? `${activeProfileId}:${requestedId}` : '';
    if (!attemptKey || attemptKey === attemptedKey) return;
    attemptedKey = attemptKey;
    const target = findSpreadsheetResumeEvidence(location, activeProfileId, items);
    if (target) invocations += 1;
  };

  maybeResume(profileA, '/ingest?resume=evidence-1', [item]);
  maybeResume(profileA, '/ingest?resume=evidence-1', [item]);
  assert.equal(invocations, 1);
});