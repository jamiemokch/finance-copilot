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

test('safe diagnostic categories map without inspecting raw provider errors', () => {
  assert.equal(automaticReviewUnavailableReason({
    failureCategory: 'provider_schema_invalid',
    diagnostic: { category: 'provider_schema_invalid', safeStatus: 'provider_schema_invalid', httpStatus: 400 },
  }), 'The automatic review service could not accept the protected review format.');
  assert.equal(automaticReviewUnavailableReason({
    failureCategory: 'semantic_validation',
    diagnostic: { category: 'semantic_validation', safeStatus: 'semantic_validation', httpStatus: null },
  }), 'The automatic review plan did not pass spreadsheet semantic checks.');
});
