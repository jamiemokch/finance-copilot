import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfirmedFinancialMemoryRecord } from './financial-memory.js';
import {
  canBuildYearEndPack,
  computeYearEndTotals,
  shouldShowGeneratedYearEndPack,
} from './year-end-pack.js';
import { computePLBreakdown, computeTaxForProfit } from '../../../api-server/src/lib/finance.js';

// One provider-free, DB-free proof of the Backbone V1 Golden Path chain:
// confirm -> Financial Memory -> P&L/tax -> Year-End readiness -> refresh.
// The confirm step below models the idempotency contract already codified
// in the confirm-transaction route (api-server/src/routes/evidence.ts) and
// the manual-entry route (api-server/src/routes/transactions.ts): a
// caller-supplied id is the durable idempotency guard, and a retry under
// the same id with a different financial outcome is rejected rather than
// silently applied. Everything downstream of confirmation reuses the real
// pure predicates/calculators, not a reimplementation of them.

interface ConfirmedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  recordType: 'income' | 'expense';
  category: string;
  taxTreatment: string;
  allowablePercentage: number;
  allowableAmount: number;
  ledgerStatus: 'active';
}

interface ConfirmationCandidate {
  idempotencyKey: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  taxTreatment: 'income' | 'deductible' | 'non_deductible';
  allowablePercentage: number;
}

function confirmCandidate(
  ledger: ConfirmedTransaction[],
  candidate: ConfirmationCandidate,
): ConfirmedTransaction {
  const isIncome = candidate.taxTreatment === 'income';
  const canonicalAmount = isIncome ? Math.abs(candidate.amount) : -Math.abs(candidate.amount);
  const deductible = candidate.taxTreatment !== 'non_deductible' && !isIncome;
  const allowablePercentage = isIncome ? 100 : candidate.allowablePercentage;
  const allowableAmount = isIncome
    ? canonicalAmount
    : deductible ? -Math.abs(canonicalAmount) * (allowablePercentage / 100) : 0;

  const existing = ledger.find((tx) => tx.id === candidate.idempotencyKey);
  if (existing) {
    const matchesConfirmation =
      existing.date === candidate.date
      && existing.description === candidate.description
      && existing.amount === canonicalAmount
      && existing.recordType === (isIncome ? 'income' : 'expense')
      && existing.category === candidate.category
      && existing.taxTreatment === candidate.taxTreatment
      && existing.allowablePercentage === allowablePercentage
      && existing.allowableAmount === allowableAmount;
    if (!matchesConfirmation) {
      throw new Error('This confirmation key belongs to a different financial outcome');
    }
    return existing;
  }

  const created: ConfirmedTransaction = {
    id: candidate.idempotencyKey,
    date: candidate.date,
    description: candidate.description,
    amount: canonicalAmount,
    recordType: isIncome ? 'income' : 'expense',
    category: candidate.category,
    taxTreatment: candidate.taxTreatment,
    allowablePercentage,
    allowableAmount,
    ledgerStatus: 'active',
  };
  ledger.push(created);
  return created;
}

// Mirrors the positive-amount, allowableAmount-preferring convention that
// the real Year-End totals source (store.tsx mapPLBreakdown) already uses,
// so computeYearEndTotals is exercised on the same shape it sees in the app.
function confirmedRevenueRows(ledger: ConfirmedTransaction[]): Array<{ amount: number }> {
  return ledger.filter((tx) => tx.recordType === 'income').map((tx) => ({ amount: Math.abs(tx.amount) }));
}
function confirmedExpenseRows(ledger: ConfirmedTransaction[]): Array<{ amount: number }> {
  return ledger
    .filter((tx) => tx.recordType === 'expense' && tx.taxTreatment === 'deductible' && tx.amount < 0)
    .map((tx) => ({ amount: Math.abs(tx.allowableAmount) }));
}

test('Backbone V1 Golden Path: unconfirmed input stays out of Financial Memory until explicit, idempotent confirmation, and P&L/tax/Year-End readiness recompute from that confirmed source', () => {
  const ledger: ConfirmedTransaction[] = [];

  // 1. Synthetic financial input enters the supported ingestion path as a
  // proposal — a spreadsheet/document candidate awaiting review — plus an
  // imported bank row still unclassified (recordType "unknown").
  const proposedInvoice: ConfirmationCandidate = {
    idempotencyKey: 'aaaaaaaa-0000-4000-8000-000000000001',
    date: '2025-06-10',
    description: 'Consulting invoice — Acme Ltd',
    amount: 20000,
    category: 'services',
    taxTreatment: 'income',
    allowablePercentage: 100,
  };
  const unresolvedBankRow = {
    amount: -120,
    recordType: 'unknown' as const,
    ledgerStatus: 'active' as const,
    category: 'other',
    taxTreatment: 'unreviewed',
  };

  // 2. Nothing becomes confirmed Financial Memory before explicit confirmation.
  assert.equal(isConfirmedFinancialMemoryRecord(unresolvedBankRow), false);
  const preConfirmationPL = computePLBreakdown([unresolvedBankRow, ...ledger], []);
  assert.equal(preConfirmationPL.revenues, 0);
  assert.equal(preConfirmationPL.profit, 0);

  // 3. Explicit confirmation creates the canonical Financial Memory record.
  const confirmed = confirmCandidate(ledger, proposedInvoice);
  assert.equal(ledger.length, 1);
  assert.equal(confirmed.recordType, 'income');
  assert.equal(confirmed.amount, 20000);

  // 4. Confirmation is idempotent: a retry with the same key and the same
  // payload returns the same canonical record, not a duplicate.
  const confirmedAgain = confirmCandidate(ledger, proposedInvoice);
  assert.equal(ledger.length, 1);
  assert.deepEqual(confirmedAgain, confirmed);
  // A retry under the same key but a different financial outcome is
  // rejected rather than silently overwriting confirmed memory.
  assert.throws(() => confirmCandidate(ledger, { ...proposedInvoice, amount: 25000 }));
  assert.equal(ledger.length, 1);

  // 5. P&L and tax estimate recompute from the confirmed source, still
  // excluding the unresolved bank row and never having seen the raw proposal.
  let pl = computePLBreakdown([...ledger, unresolvedBankRow], []);
  assert.equal(pl.revenues, 20000);
  assert.equal(pl.profit, 20000);
  let tax = computeTaxForProfit(pl.profit, 0);
  assert.ok(tax.balanceDue > 0);

  // 6. Unresolved Inbox/checklist items block Year-End readiness even
  // though a confirmed record already exists.
  const almostDoneChecklist = { total: 3, done: 2 };
  const pendingInboxCount = 1;
  assert.equal(canBuildYearEndPack(almostDoneChecklist, pendingInboxCount), false);
  assert.equal(shouldShowGeneratedYearEndPack(true, almostDoneChecklist, pendingInboxCount), false);

  // 7. Once readiness conditions are satisfied, the Year-End surface can
  // present a confirmed-only summary sourced from the same ledger.
  const readyChecklist = { total: 3, done: 3 };
  assert.equal(canBuildYearEndPack(readyChecklist, 0), true);
  assert.equal(shouldShowGeneratedYearEndPack(true, readyChecklist, 0), true);
  let totals = computeYearEndTotals(confirmedRevenueRows(ledger), confirmedExpenseRows(ledger));
  assert.deepEqual(totals, {
    confirmedIncome: pl.revenues,
    confirmedAllowableExpenses: pl.confirmedExpenses,
    confirmedProfit: pl.profit,
  });

  // 8. A later confirmed record refreshes P&L/tax/Year-End totals from the
  // same source, and the newly unresolved bank row reopens the readiness gate.
  const secondCandidate: ConfirmationCandidate = {
    idempotencyKey: 'aaaaaaaa-0000-4000-8000-000000000002',
    date: '2025-09-02',
    description: 'Office supplies — Staples',
    amount: 200,
    category: 'office',
    taxTreatment: 'deductible',
    allowablePercentage: 100,
  };
  confirmCandidate(ledger, secondCandidate);
  assert.equal(ledger.length, 2);

  pl = computePLBreakdown([...ledger, unresolvedBankRow], []);
  assert.equal(pl.revenues, 20000);
  assert.equal(pl.confirmedExpenses, 200);
  assert.equal(pl.profit, 19800);
  tax = computeTaxForProfit(pl.profit, 0);
  assert.ok(tax.balanceDue > 0);

  const newPendingInboxCount = 1; // the still-unresolved bank row
  assert.equal(canBuildYearEndPack(readyChecklist, newPendingInboxCount), false);
  assert.equal(shouldShowGeneratedYearEndPack(true, readyChecklist, newPendingInboxCount), false);

  totals = computeYearEndTotals(confirmedRevenueRows(ledger), confirmedExpenseRows(ledger));
  assert.deepEqual(totals, {
    confirmedIncome: pl.revenues,
    confirmedAllowableExpenses: pl.confirmedExpenses,
    confirmedProfit: pl.profit,
  });
});
