export type AutomaticReviewStatus = {
  failureCategory?: 'model_unavailable' | 'provider_schema_invalid' | 'transport_failure' | 'response_contract_invalid' | 'provider_unavailable' | null;
  reason?: string | null;
  recoveryState?: 'automatic_ready' | 'automatic_unavailable' | 'manual_recovery';
  automaticRetryExhausted?: boolean;
} | null | undefined;

export function automaticReviewRetryLimitConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: unknown;
    details?: { code?: unknown };
  };
  return candidate.status === 409 && candidate.details?.code === 'automatic_retry_limit_reached';
}

export function automaticReviewRetryIsExhausted(status: AutomaticReviewStatus): boolean {
  return status?.automaticRetryExhausted === true;
}

export function automaticReviewCanRetry(status: AutomaticReviewStatus): boolean {
  return !automaticReviewRetryIsExhausted(status);
}

export function automaticReviewShouldClearAnalysis(status: AutomaticReviewStatus): boolean {
  // The parser review remains safe and usable when the optional semantic
  // enhancement is unavailable. Never discard a reviewer’s local mapping.
  return false;
}

export function automaticReviewAllowsManualMapping(status: AutomaticReviewStatus): boolean {
  return status?.recoveryState === 'automatic_ready'
    || status?.recoveryState === 'manual_recovery'
    || status?.recoveryState === 'automatic_unavailable';
}

export function automaticReviewUnavailableReason(status: AutomaticReviewStatus): string {
  if (automaticReviewRetryIsExhausted(status)) return 'Automatic review has reached its safe retry limit for this unchanged workbook.';
  if (status?.failureCategory === 'model_unavailable') return 'The automatic review model is unavailable right now.';
  if (status?.failureCategory === 'provider_schema_invalid') return 'The automatic review service could not accept the protected review format.';
  if (status?.failureCategory === 'response_contract_invalid') return 'Automatic suggestions are unavailable right now.';
  if (status?.failureCategory === 'transport_failure' && /timed out/i.test(status.reason ?? '')) {
    return 'Automatic review timed out waiting for a response. No records were imported.';
  }
  if (status?.failureCategory === 'transport_failure') return 'The automatic review service could not be reached.';
  return 'We could not automatically review this workbook.';
}