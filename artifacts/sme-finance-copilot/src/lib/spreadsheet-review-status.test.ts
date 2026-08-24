import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticReviewShouldClearAnalysis,
  automaticReviewUnavailableReason,
} from './spreadsheet-review-status.js';

test('a timed-out automatic review replaces stale analysis with the safe retry state', () => {
  const status = {
    failureCategory: 'transport_failure' as const,
    reason: 'Automatic review timed out waiting for a response. No records were imported.',
    recoveryState: 'automatic_unavailable' as const,
  };

  assert.equal(automaticReviewShouldClearAnalysis(status), true);
  assert.equal(
    automaticReviewUnavailableReason(status),
    'Automatic review timed out waiting for a response. No records were imported.',
  );
});

test('a non-timeout transport failure keeps its distinct explanation', () => {
  assert.equal(
    automaticReviewUnavailableReason({
      failureCategory: 'transport_failure',
      reason: 'Automatic review is temporarily unavailable because the provider could not be reached.',
      recoveryState: 'automatic_unavailable',
    }),
    'The automatic review service could not be reached.',
  );
});