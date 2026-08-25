import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticReviewCanRetry,
  automaticReviewAllowsManualMapping,
  automaticReviewRetryLimitConflict,
  automaticReviewRetryIsExhausted,
  automaticReviewShouldClearAnalysis,
  automaticReviewUnavailableReason,
} from './spreadsheet-review-status.js';

test('recognises only the server retry-limit conflict as exhausted automatic review', () => {
  assert.equal(
    automaticReviewRetryLimitConflict({
      status: 409,
      details: { code: 'automatic_retry_limit_reached' },
    }),
    true,
  );
  assert.equal(
    automaticReviewRetryLimitConflict({
      status: 409,
      details: { code: 'spreadsheet_import_conflict' },
    }),
    false,
  );
  assert.equal(
    automaticReviewRetryLimitConflict({
      status: 500,
      details: { code: 'automatic_retry_limit_reached' },
    }),
    false,
  );
  const resumedExhaustedReview = {
    failureCategory: 'transport_failure' as const,
    recoveryState: 'automatic_unavailable' as const,
    automaticRetryExhausted: true,
  };
  assert.equal(automaticReviewRetryIsExhausted(resumedExhaustedReview), true);
  assert.equal(automaticReviewCanRetry(resumedExhaustedReview), false, 'an exhausted resumed review must not render a retry action');
  assert.equal(automaticReviewCanRetry({ recoveryState: 'automatic_unavailable' }), true);
});

test('an unavailable automatic review keeps deterministic mapping available', () => {
  const status = {
    failureCategory: 'transport_failure' as const,
    reason: 'Automatic review timed out waiting for a response. No records were imported.',
    recoveryState: 'automatic_unavailable' as const,
  };

  assert.equal(automaticReviewShouldClearAnalysis(status), false);
  assert.equal(automaticReviewAllowsManualMapping(status), true);
  assert.equal(
    automaticReviewUnavailableReason(status),
    'Automatic review timed out waiting for a response. No records were imported.',
  );
});

test('a contract-invalid automatic suggestion remains an editable manual review', () => {
  const status = {
    failureCategory: 'response_contract_invalid' as const,
    recoveryState: 'automatic_unavailable' as const,
  };
  assert.equal(automaticReviewShouldClearAnalysis(status), false);
  assert.equal(automaticReviewAllowsManualMapping(status), true);
  assert.equal(
    automaticReviewUnavailableReason(status),
    'Automatic suggestions are unavailable right now.',
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