import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '@workspace/db';
import { buildTaxFilingPack } from './tax-filing-pack.js';

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(), profileId: 'profile-1', date: '2025-08-01', description: 'Record', amount: 0,
  recordType: 'expense', note: null, category: 'other', taxTreatment: 'deductible', source: 'manual', evidenceId: null,
  evidenceTier: 4, sourceRowIndex: null, rawRowData: null, classificationConfidence: 1, accountingCategory: 'other',
  allowablePercentage: 100, allowableAmount: null, capitalAllowanceType: null, vatMetadata: null, userOverride: true,
  accountingClassification: null, financialAccountId: null, bankImportBatchId: null, bankImportRowId: null,
  bankMovementIdentity: null, originalImportSnapshot: null, ledgerStatus: 'active', voidedAt: null, voidReason: null,
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

const context = {
  profile: { id: 'profile-1', name: 'Simple Studio', accountingBasis: 'cash' }, taxYear: '2025/26', asOf: '2026-04-05',
  businessDescription: 'Design services', accountingPeriodConfirmed: true, recordsCompleteConfirmed: true, derivedFiguresReviewed: true,
};

test('maps every included record to an SA103S box and preserves source trace', () => {
  const pack = buildTaxFilingPack([
    tx({ id: 'sale', recordType: 'income', accountingCategory: 'sales', amount: 20_000 }),
    tx({ id: 'travel', accountingCategory: 'travel', amount: -500, allowableAmount: 400 }),
    tx({ id: 'office', accountingCategory: 'office', amount: -700 }),
    tx({ id: 'private', accountingCategory: 'other', amount: -100, taxTreatment: 'non_deductible' }),
  ], context);
  assert.equal(pack.boxes.find((box) => box.box === '9')?.amount, 20_000);
  assert.equal(pack.boxes.find((box) => box.box === '12')?.amount, 400);
  assert.equal(pack.boxes.find((box) => box.box === '18')?.amount, 700);
  assert.equal(pack.calculated.box20TotalAllowableExpenses, 1_100);
  assert.equal(pack.trace.length, 4);
  assert.equal(pack.trace.find((item) => item.recordId === 'private')?.status, 'excluded');
  assert.equal(pack.filingReady, true);
});

test('fails closed when a record is unclassified or cannot map to a filing box', () => {
  const pack = buildTaxFilingPack([
    tx({ id: 'unknown', recordType: 'unknown', accountingClassification: 'unknown' }),
    tx({ id: 'unmapped', accountingCategory: 'crypto_spaceship' }),
  ], context);
  assert.equal(pack.filingReady, false);
  assert.deepEqual(pack.blockers.map((item) => item.code), ['record_needs_classification', 'record_needs_tax_category', 'no_confirmed_records']);
});

test('shows actual-expense and trading-allowance scenarios without silently choosing', () => {
  const pack = buildTaxFilingPack([
    tx({ recordType: 'income', accountingCategory: 'sales', amount: 5_000 }),
    tx({ accountingCategory: 'office', amount: -200 }),
  ], context);
  assert.equal(pack.decision.recommendedMethod, 'trading_allowance');
  assert.equal(pack.decision.selectedMethod, null);
  assert.deepEqual(pack.decision.scenarios.map((scenario) => scenario.taxableProfit), [4_800, 4_000]);
});

test('blocks an empty ledger instead of presenting zero figures as filing-ready', () => {
  const pack = buildTaxFilingPack([], context);
  assert.equal(pack.recordCount, 0);
  assert.equal(pack.filingReady, false);
  assert.equal(pack.blockers.some((blocker) => blocker.code === 'no_confirmed_records'), true);
});