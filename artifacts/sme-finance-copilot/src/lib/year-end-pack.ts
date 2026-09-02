// Pure composition/guard logic for the Year-End Pack section of YearEndTab
// (pages/tasks.tsx, Timeline tab). Kept separate from the component so the
// readiness and staleness guards can be unit-tested without mounting the
// store/React context.

export interface YearEndChecklistCounts {
  total: number;
  done: number;
}

export function yearEndReadinessPercent(counts: YearEndChecklistCounts): number {
  return counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
}

export function canBuildYearEndPack(counts: YearEndChecklistCounts, pendingInboxCount: number): boolean {
  return pendingInboxCount === 0 && counts.done >= counts.total - 1;
}

// A pack generated earlier must stop presenting as ready the moment new
// pending Inbox items or reopened checklist tasks break the same conditions
// that were required to build it — otherwise a stale "generated" pack could
// keep showing confirmed-looking totals while unresolved items exist.
export function shouldShowGeneratedYearEndPack(
  packGenerated: boolean,
  counts: YearEndChecklistCounts,
  pendingInboxCount: number,
): boolean {
  return packGenerated && canBuildYearEndPack(counts, pendingInboxCount);
}

export interface YearEndTotals {
  confirmedIncome: number;
  confirmedAllowableExpenses: number;
  confirmedProfit: number;
}

// Sums the same confirmed-only revenues/confirmedExpenses arrays already
// owned by plBreakdown (see store.tsx mapPLBreakdown) — no new ledger
// filtering or tax arithmetic, matching the pattern used by position.tsx
// and dashboard.tsx for "confirmed basis" profit.
export function computeYearEndTotals(
  revenues: Array<{ amount: number }>,
  confirmedExpenses: Array<{ amount: number }>,
): YearEndTotals {
  const confirmedIncome = revenues.reduce((sum, r) => sum + r.amount, 0);
  const confirmedAllowableExpenses = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);
  return {
    confirmedIncome,
    confirmedAllowableExpenses,
    confirmedProfit: confirmedIncome - confirmedAllowableExpenses,
  };
}
