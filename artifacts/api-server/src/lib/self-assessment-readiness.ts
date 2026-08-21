export type ReadinessStatus = 'complete' | 'derived' | 'missing' | 'needs_confirmation';

export interface ReadinessConcept {
  id: string;
  section: 'SA100' | 'SA103S' | 'Return';
  label: string;
  status: ReadinessStatus;
  value: string | number | boolean | null;
  source: string;
  explanation: string;
}

export interface ReadinessInput {
  taxYear: string;
  profile: {
    id: string;
    name: string;
    type: string;
    industry: string;
    accountingBasis: string;
    coverageStartDate: string | null;
  };
  identity: { hasUtr: boolean; hasNationalInsuranceNumber: boolean };
  sa100: {
    otherTaxableIncome: number | null;
    allSelfEmploymentsDisclosed: boolean | null;
    migrationConflict: boolean;
  } | null;
  sa103s: {
    selfEmploymentStartDate: string | null;
    businessDescription: string | null;
    accountingPeriodEndDate: string | null;
    accountingPeriodConfirmed: boolean | null;
    recordsCompleteConfirmed: boolean | null;
    derivedFiguresReviewed: boolean | null;
  } | null;
  financials: {
    periodStart: string;
    periodEnd: string;
    hasStarted: boolean;
    isYearToDate: boolean;
    turnover: number;
    totalExpenses: number;
    allowableExpenses: number;
    taxableBusinessProfit: number;
    recordCount: number;
  };
  businessSections: ReadonlyArray<{
    profileId: string;
    businessName: string;
    isActive: boolean;
    hasBusinessContext: boolean;
  }>;
}

function concept(
  id: string,
  section: ReadinessConcept['section'],
  label: string,
  status: ReadinessStatus,
  value: ReadinessConcept['value'],
  source: string,
  explanation: string,
): ReadinessConcept {
  return { id, section, label, status, value, source, explanation };
}

export function taxYearPeriod(taxYear: string): { start: string; end: string } | null {
  const match = /^(\d{4})\/(\d{2})$/.exec(taxYear);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== (startYear + 1) % 100) return null;
  return { start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` };
}

export function buildSelfAssessmentReadiness(input: ReadinessInput) {
  const sa100 = input.sa100;
  const sa103s = input.sa103s;
  const defaultPeriod = taxYearPeriod(input.taxYear);
  const concepts: ReadinessConcept[] = [
    concept(
      'sa100.utr',
      'SA100',
      'Unique Taxpayer Reference',
      input.identity.hasUtr ? 'complete' : 'missing',
      input.identity.hasUtr ? 'Provided' : null,
      'Your protected identity details',
      input.identity.hasUtr ? 'Stored securely and shown only as a masked value.' : 'Add your UTR to prepare this return.',
    ),
    concept(
      'sa100.national_insurance_number',
      'SA100',
      'National Insurance number',
      input.identity.hasNationalInsuranceNumber ? 'complete' : 'missing',
      input.identity.hasNationalInsuranceNumber ? 'Provided' : null,
      'Your protected identity details',
      input.identity.hasNationalInsuranceNumber ? 'Stored securely and shown only as a masked value.' : 'Add your National Insurance number to prepare this return.',
    ),
    concept(
      'sa100.other_taxable_income',
      'SA100',
      'Other taxable income',
      sa100?.otherTaxableIncome == null ? 'missing' : 'complete',
      sa100?.otherTaxableIncome ?? null,
      'Your whole-return context',
      sa100?.migrationConflict
        ? 'Older business profiles contained conflicting values. Confirm one amount for this tax year.'
        : 'Use £0 only when you have confirmed there is none.',
    ),
    concept(
      'sa100.all_self_employments_disclosed',
      'SA100',
      'All self-employments are represented',
      sa100?.allSelfEmploymentsDisclosed === true
        ? 'complete'
        : sa100?.allSelfEmploymentsDisclosed === false
          ? 'missing'
          : 'needs_confirmation',
      sa100?.allSelfEmploymentsDisclosed ?? null,
      'Your whole-return context',
      'Confirm that every self-employment relevant to this return has been represented or disclosed.',
    ),
    concept(
      'sa103s.business_name',
      'SA103S',
      'Business name',
      input.profile.name ? 'complete' : 'missing',
      input.profile.name || null,
      'Business profile',
      'Taken from your active business profile.',
    ),
    concept(
      'sa103s.business_description',
      'SA103S',
      'Business description',
      sa103s?.businessDescription?.trim() ? 'complete' : 'missing',
      sa103s?.businessDescription?.trim() || null,
      'Business profile confirmation',
      'Confirm a plain-language description for this business.',
    ),
    concept(
      'sa103s.self_employment_start_date',
      'SA103S',
      'Self-employment start date',
      sa103s?.selfEmploymentStartDate ? 'complete' : 'missing',
      sa103s?.selfEmploymentStartDate ?? null,
      'Business profile confirmation',
      'Add the date this self-employment began.',
    ),
    concept(
      'sa103s.accounting_period',
      'SA103S',
      'Accounting period',
      sa103s?.accountingPeriodConfirmed ? 'complete' : 'needs_confirmation',
      sa103s?.accountingPeriodEndDate ?? defaultPeriod?.end ?? null,
      sa103s?.accountingPeriodEndDate ? 'Business profile confirmation' : 'Tax-year default',
      sa103s?.accountingPeriodConfirmed
        ? 'Confirmed for this business.'
        : 'Review the default tax-year end date or provide this business’s accounting-period end date.',
    ),
    concept(
      'sa103s.records_complete',
      'SA103S',
      'This business’s records are complete',
      sa103s?.recordsCompleteConfirmed ? 'complete' : 'needs_confirmation',
      sa103s?.recordsCompleteConfirmed ?? null,
      'Business profile confirmation',
      'Confirm that this business’s records for the return period are complete.',
    ),
    concept(
      'sa103s.derived_figures_reviewed',
      'SA103S',
      'Derived business figures reviewed',
      sa103s?.derivedFiguresReviewed ? 'complete' : 'needs_confirmation',
      sa103s?.derivedFiguresReviewed ?? null,
      'Business profile confirmation',
      'Review the turnover, allowable expenses, and profit derived from Financial Memory.',
    ),
    concept(
      'sa103s.turnover',
      'SA103S',
      'Turnover',
      'derived',
      input.financials.turnover,
      'Financial Memory',
      `${input.financials.isYearToDate ? 'Year-to-date' : 'Full tax-year'} income from saved records. This is not final filing data.`,
    ),
    concept(
      'sa103s.allowable_expenses',
      'SA103S',
      'Allowable expenses',
      'derived',
      input.financials.allowableExpenses,
      'Financial Memory',
      'Only deductible and saved allowable amounts are included; non-deductible items remain excluded.',
    ),
    concept(
      'sa103s.taxable_business_profit',
      'SA103S',
      'Taxable business profit',
      'derived',
      input.financials.taxableBusinessProfit,
      'Financial Memory',
      'Derived turnover less saved allowable expenses. This is not a final filed figure.',
    ),
    concept(
      'return.data_coverage',
      'Return',
      'Return data coverage',
      'derived',
      input.financials.recordCount,
      'Financial Memory',
      input.financials.isYearToDate
        ? input.financials.hasStarted
          ? `Currently covers saved records from ${input.financials.periodStart} to ${input.financials.periodEnd}. A full-year review is still required.`
          : `This tax year does not start until ${input.financials.periodStart}; no records are included yet.`
        : 'Covers the selected tax year; final filing review is still required.',
    ),
  ];

  return {
    schemaVersion: 'uk-self-assessment-readiness-v1',
    taxYear: input.taxYear,
    returnStructure: {
      model: 'one_sa100_plus_many_sa103s',
      activeBusinessProfileId: input.profile.id,
      businessSectionCount: input.businessSections.length,
      businessSections: input.businessSections,
      note: input.businessSections.length === 1
        ? 'This return currently has one active business section. The same SA100 context can compose further business sections for this tax year.'
        : `This return has ${input.businessSections.length} business sections. This view shows the active section; switch profiles to review another section.`,
    },
    financialCoverage: input.financials,
    groups: {
      complete: concepts.filter((item) => item.status === 'complete'),
      derived: concepts.filter((item) => item.status === 'derived'),
      missing: concepts.filter((item) => item.status === 'missing'),
      needsConfirmation: concepts.filter((item) => item.status === 'needs_confirmation'),
    },
  };
}