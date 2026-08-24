export type AutomaticReviewStatus = {
  failureCategory?: 'model_unavailable' | 'provider_schema_invalid' | 'transport_failure' | 'response_contract_invalid' | 'semantic_validation' | 'provider_unavailable' | null;
  diagnostic?: { category?: string; safeStatus?: string; httpStatus?: number | null } | null;
  reason?: string | null;
  recoveryState?: 'automatic_ready' | 'automatic_unavailable' | 'manual_recovery';
} | null | undefined;

export function automaticReviewShouldClearAnalysis(status: AutomaticReviewStatus): boolean {
  return status?.recoveryState === 'automatic_unavailable';
}

export function automaticReviewUnavailableReason(status: AutomaticReviewStatus): string {
  if (status?.diagnostic?.category === 'timeout' || status?.diagnostic?.safeStatus === 'timeout') return 'Automatic review timed out waiting for a response. No records were imported.';
  if (status?.failureCategory === 'model_unavailable') return 'The automatic review model is unavailable right now.';
  if (status?.failureCategory === 'provider_schema_invalid') return 'The automatic review service could not accept the protected review format.';
  if (status?.failureCategory === 'response_contract_invalid') return 'The automatic review response did not pass the protected spreadsheet checks.';
  if (status?.failureCategory === 'semantic_validation') return 'The automatic review plan did not pass spreadsheet semantic checks.';
  if (status?.failureCategory === 'transport_failure' && /timed out/i.test(status.reason ?? '')) {
    return 'Automatic review timed out waiting for a response. No records were imported.';
  }
  if (status?.failureCategory === 'transport_failure') return 'The automatic review service could not be reached.';
  return 'We could not automatically review this workbook.';
}
