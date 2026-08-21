import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelfAssessmentReadiness } from './self-assessment-readiness.js';
import { maskTaxIdentifier } from './tax-identifiers.js';
import { summarizeTaxYearLedger } from './tax-year-ledger.js';

const baseInput = {
  taxYear: '2025/26',
  profile: {
    id: 'profile-a',
    name: 'Northstar Design',
    type: 'sole_trader',
    industry: 'creative',
    accountingBasis: 'cash',
    coverageStartDate: null,
  },
  identity: { hasUtr: false, hasNationalInsuranceNumber: false },
  sa100: {
    otherTaxableIncome: null,
    allSelfEmploymentsDisclosed: null,
    migrationConflict: false,
  },
  sa103s: null,
  financials: {
    periodStart: '2025-04-06',
    periodEnd: '2026-03-01',
    hasStarted: true,
    isYearToDate: true,
    turnover: 18000,
    totalExpenses: 6200,
    allowableExpenses: 4900,
    taxableBusinessProfit: 13100,
    recordCount: 8,
  },
  businessSections: [{
    profileId: 'profile-a',
    businessName: 'Northstar Design',
    isActive: true,
    hasBusinessContext: false,
  }],
} as const;

test('readiness keeps whole-return and business sections separate', () => {
  const result = buildSelfAssessmentReadiness(baseInput);
  const allConcepts = [
    ...result.groups.complete,
    ...result.groups.derived,
    ...result.groups.missing,
    ...result.groups.needsConfirmation,
  ];

  assert.equal(result.returnStructure.model, 'one_sa100_plus_many_sa103s');
  assert.equal(result.returnStructure.businessSectionCount, 1);
  assert.ok(allConcepts.some((item) => item.id === 'sa100.all_self_employments_disclosed'));
  assert.ok(!allConcepts.some((item) => item.id.includes('no_additional_self_employment')));
  assert.ok(allConcepts.some((item) => item.id === 'sa103s.records_complete'));
  assert.ok(allConcepts.some((item) => item.id === 'sa103s.derived_figures_reviewed'));
});

test('readiness exposes derived totals without treating them as final filing data', () => {
  const result = buildSelfAssessmentReadiness({
    ...baseInput,
    identity: { hasUtr: true, hasNationalInsuranceNumber: true },
    sa100: {
      otherTaxableIncome: 0,
      allSelfEmploymentsDisclosed: true,
      migrationConflict: false,
    },
    sa103s: {
      selfEmploymentStartDate: '2020-08-01',
      businessDescription: 'Freelance graphic design',
      accountingPeriodEndDate: '2026-04-05',
      accountingPeriodConfirmed: true,
      recordsCompleteConfirmed: true,
      derivedFiguresReviewed: true,
    },
  });

  const profit = result.groups.derived.find((item) => item.id === 'sa103s.taxable_business_profit');
  const coverage = result.groups.derived.find((item) => item.id === 'return.data_coverage');
  assert.equal(profit?.value, 13100);
  assert.match(profit?.explanation ?? '', /not a final filed figure/i);
  assert.match(coverage?.explanation ?? '', /full-year review/i);
});

test('readiness composition carries independent same-year business sections', () => {
  const result = buildSelfAssessmentReadiness({
    ...baseInput,
    businessSections: [
      ...baseInput.businessSections,
      {
        profileId: 'profile-b',
        businessName: 'Northstar Training',
        isActive: false,
        hasBusinessContext: true,
      },
    ],
  });

  assert.equal(result.returnStructure.businessSectionCount, 2);
  assert.equal(result.returnStructure.businessSections[1]?.profileId, 'profile-b');
  assert.match(result.returnStructure.note, /2 business sections/i);
});

test('ledger summary keeps non-deductible and mixed-use expenses out of allowable profit', () => {
  const transactions = [
    { id: 'income', date: '2025-06-01', amount: 500, recordType: 'income', category: 'sales', taxTreatment: 'not_applicable', allowableAmount: null, description: 'Invoice' },
    { id: 'mixed', date: '2025-06-02', amount: -100, recordType: 'expense', category: 'motor', taxTreatment: 'deductible', allowableAmount: 40, description: 'Mixed-use mileage' },
    { id: 'private', date: '2025-06-03', amount: -60, recordType: 'expense', category: 'personal', taxTreatment: 'non_deductible', allowableAmount: null, description: 'Private purchase' },
  ] as any;
  const summary = summarizeTaxYearLedger(transactions, '2025/26', '2025-06-30');

  assert.equal(summary?.totalIncome, 500);
  assert.equal(summary?.totalExpenses, 160);
  assert.equal(summary?.allowableExpenses, 40);
  assert.equal(summary?.taxableBusinessProfit, 460);
});

test('empty ledgers and unresolved whole-return income stay explicitly incomplete', () => {
  const summary = summarizeTaxYearLedger([], '2025/26', '2025-06-30');
  assert.equal(summary?.records.length, 0);
  assert.equal(summary?.taxableBusinessProfit, 0);

  const result = buildSelfAssessmentReadiness({
    ...baseInput,
    sa100: { otherTaxableIncome: null, allSelfEmploymentsDisclosed: null, migrationConflict: true },
    financials: {
      ...baseInput.financials,
      turnover: 0,
      totalExpenses: 0,
      allowableExpenses: 0,
      taxableBusinessProfit: 0,
      recordCount: 0,
    },
  });
  const otherIncome = result.groups.missing.find((item) => item.id === 'sa100.other_taxable_income');
  assert.equal(otherIncome?.status, 'missing');
  assert.match(otherIncome?.explanation ?? '', /conflicting values/i);
});

test('identifier display retains only the final four characters', () => {
  const rawIdentifier = '1234567890';
  const masked = maskTaxIdentifier(rawIdentifier);
  assert.equal(masked, '•••• 7890');
  assert.equal(masked.includes(rawIdentifier), false);
});

test('a future tax year has no impossible coverage range or included records', () => {
  const summary = summarizeTaxYearLedger([
    { id: 'future', date: '2027-04-06', amount: 100, recordType: 'income', category: 'sales', taxTreatment: 'not_applicable', allowableAmount: null, description: 'Future invoice' },
  ] as any, '2027/28', '2026-08-21');

  assert.equal(summary?.hasStarted, false);
  assert.equal(summary?.period.start, '2027-04-06');
  assert.equal(summary?.period.end, '2027-04-06');
  assert.equal(summary?.records.length, 0);
});