import React from 'react';
import { Button } from '@/components/ui';

export function AutomaticReviewRecoveryActions({
  retryAvailable,
  saving,
  onRetry,
  onManualRecovery,
}: {
  retryAvailable: boolean;
  saving: boolean;
  onRetry: () => void;
  onManualRecovery: () => void;
}) {
  return <div className="flex flex-wrap gap-2">
    {retryAvailable && <Button data-testid="retry-automatic-spreadsheet-review" size="sm" disabled={saving} onClick={onRetry}>Retry automatic review</Button>}
    <Button data-testid="start-manual-spreadsheet-recovery" size="sm" variant="outline" disabled={saving} onClick={onManualRecovery}>Start manual recovery</Button>
  </div>;
}