import type { Transaction } from '@workspace/db';
import { taxYearPeriod } from './tax-year-ledger.js';

export type Sa103sBox = '9' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19';

export interface FilingPackContext {
  profile: { id: string; name: string; accountingBasis: string };
  taxYear: string;
  asOf?: string;
  businessDescription?: string | null;
  accountingPeriodConfirmed?: boolean | null;
  recordsCompleteConfirmed?: boolean | null;
  derivedFiguresReviewed?: boolean | null;
}

const BOX_LABELS: Record<Sa103sBox, string> = {
  '9': 'Turnover',
  '10': 'Other business income',
  '11': 'Cost of goods and materials',
  '12': 'Car, van and travel expenses',
  '13': 'Wages and staff costs',
  '14': 'Rent, rates, power and insurance',
  '15': 'Repairs and maintenance',
  '16': 'Accountancy, legal and professional fees',
  '17': 'Interest and financial charges',
  '18': 'Phone, stationery and office costs',
  '19': 'Other allowable business expenses',
};

const CATEGORY_TO_BOX: Record<string, Sa103sBox> = {
  sales: '9', revenue: '9', turnover: '9', income: '9', business_income: '9',
  other_income: '10', other_business_income: '10', grants: '10',
  materials: '11', goods: '11', stock: '11', cost_of_goods: '11', cost_of_sales: '11',
  travel: '12', vehicle: '12', motor: '12', mileage: '12', car_van_travel: '12',
  wages: '13', salary: '13', salaries: '13', staff: '13', payroll: '13', subcontractors: '13',
  rent: '14', rates: '14', utilities: '14', power: '14', insurance: '14', premises: '14',
  repairs: '15', maintenance: '15', repairs_maintenance: '15',
  professional: '16', professional_fees: '16', legal: '16', accountancy: '16', accounting: '16',
  interest: '17', bank_fees: '17', card_fees: '17', finance_charges: '17',
  office: '18', phone: '18', stationery: '18', software: '18', office_costs: '18',
  other: '19', other_expense: '19', misc: '19', miscellaneous: '19',
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function canonicalType(transaction: Transaction): 'income' | 'expense' | 'unknown' {
  if (transaction.recordType === 'income' || transaction.recordType === 'expense') return transaction.recordType;
  if (transaction.accountingClassification === 'income' || transaction.accountingClassification === 'expense') {
    return transaction.accountingClassification;
  }
  return 'unknown';
}

function normalizedCategory(transaction: Transaction) {
  return (transaction.accountingCategory || transaction.category || 'other')
    .trim().toLowerCase().replace(/[\s/&-]+/g, '_').replace(/_+/g, '_');
}

function filingBox(transaction: Transaction, type: 'income' | 'expense'): Sa103sBox | null {
  const mapped = CATEGORY_TO_BOX[normalizedCategory(transaction)];
  if (mapped && (type === 'income' ? mapped === '9' || mapped === '10' : mapped !== '9' && mapped !== '10')) return mapped;
  // A confirmed generic income/expense remains traceable instead of disappearing.
  if (normalizedCategory(transaction) === 'other') return type === 'income' ? '10' : '19';
  return null;
}

export function buildTaxFilingPack(transactions: Transaction[], context: FilingPackContext) {
  const period = taxYearPeriod(context.taxYear);
  if (!period) throw new Error('Unsupported tax year');
  const asOf = context.asOf ?? new Date().toISOString().slice(0, 10);
  const periodEnd = asOf < period.end ? asOf : period.end;
  const scoped = transactions.filter((record) =>
    record.ledgerStatus !== 'voided' && record.date >= period.start && record.date <= periodEnd,
  );
  const boxRecords = new Map<Sa103sBox, Array<{ recordId: string; date: string; description: string; amount: number }>>();
  const trace: Array<Record<string, unknown>> = [];
  const blockers: Array<{ code: string; recordId?: string; message: string }> = [];

  for (const record of scoped) {
    const type = canonicalType(record);
    if (type === 'unknown') {
      blockers.push({ code: 'record_needs_classification', recordId: record.id, message: `Classify “${record.description}” as income or expense.` });
      trace.push({ recordId: record.id, status: 'blocked', reason: 'record_needs_classification' });
      continue;
    }
    if (type === 'expense' && record.taxTreatment !== 'deductible') {
      trace.push({ recordId: record.id, status: 'excluded', reason: 'not_deductible', sourceAmount: money(Math.abs(record.amount)) });
      continue;
    }
    const box = filingBox(record, type);
    if (!box) {
      blockers.push({ code: 'record_needs_tax_category', recordId: record.id, message: `Choose a tax category for “${record.description}”.` });
      trace.push({ recordId: record.id, status: 'blocked', reason: 'record_needs_tax_category' });
      continue;
    }
    const sourceAmount = money(Math.abs(record.amount));
    const amount = type === 'expense'
      ? money(Math.min(sourceAmount, Math.max(0, record.allowableAmount == null ? sourceAmount * record.allowablePercentage / 100 : Math.abs(record.allowableAmount))))
      : sourceAmount;
    const item = { recordId: record.id, date: record.date, description: record.description, amount };
    boxRecords.set(box, [...(boxRecords.get(box) ?? []), item]);
    trace.push({ recordId: record.id, status: 'mapped', box, sourceAmount, filingAmount: amount });
  }

  const boxes = (Object.keys(BOX_LABELS) as Sa103sBox[]).map((box) => ({
    box,
    label: BOX_LABELS[box],
    amount: money((boxRecords.get(box) ?? []).reduce((sum, record) => sum + record.amount, 0)),
    records: boxRecords.get(box) ?? [],
  }));
  const boxAmount = (box: Sa103sBox) => boxes.find((entry) => entry.box === box)!.amount;
  const turnover = money(boxAmount('9') + boxAmount('10'));
  const actualExpenses = money(boxes.filter((entry) => Number(entry.box) >= 11).reduce((sum, entry) => sum + entry.amount, 0));
  const tradingAllowance = Math.min(1_000, turnover);
  const actualProfit = money(turnover - actualExpenses);
  const allowanceProfit = money(Math.max(0, turnover - tradingAllowance));
  const recommendedMethod = allowanceProfit < actualProfit ? 'trading_allowance' : 'actual_expenses';
  const shortFormThreshold = context.taxYear === '2025/26' ? 90_000 : context.taxYear === '2024/25' ? 85_000 : null;

  if (periodEnd !== period.end) blockers.push({ code: 'tax_year_incomplete', message: `Records currently stop at ${periodEnd}; the tax year ends ${period.end}.` });
  if (!context.businessDescription?.trim()) blockers.push({ code: 'business_description_missing', message: 'Add a plain-language business description.' });
  if (context.accountingPeriodConfirmed !== true) blockers.push({ code: 'accounting_period_unconfirmed', message: 'Confirm the accounting period.' });
  if (context.recordsCompleteConfirmed !== true) blockers.push({ code: 'records_unconfirmed', message: 'Confirm the records are complete.' });
  if (context.derivedFiguresReviewed !== true) blockers.push({ code: 'figures_unconfirmed', message: 'Review and confirm the derived tax figures.' });
  if (shortFormThreshold == null) blockers.push({ code: 'tax_year_rules_unsupported', message: 'This tax year needs a current-rules review before filing.' });
  else if (turnover >= shortFormThreshold) blockers.push({ code: 'sa103s_turnover_limit', message: `Turnover is not below the £${shortFormThreshold.toLocaleString('en-GB')} SA103S limit; use the full self-employment pages.` });

  return {
    schemaVersion: 'uk-sa103s-filing-pack-v1',
    artifactType: 'accountant_and_filing_ready_workpaper',
    disclaimer: 'Prepared workpaper only. It does not submit a return to HMRC.',
    generatedAt: new Date().toISOString(),
    taxYear: context.taxYear,
    period: { start: period.start, end: periodEnd, complete: periodEnd === period.end },
    business: context.profile,
    eligibility: { form: 'SA103S', shortFormThreshold, status: blockers.some((item) => item.code === 'sa103s_turnover_limit' || item.code === 'tax_year_rules_unsupported') ? 'manual_review' : 'eligible' },
    decision: {
      required: true,
      selectedMethod: null,
      recommendedMethod,
      explanation: recommendedMethod === 'trading_allowance'
        ? `The £${tradingAllowance.toFixed(2)} trading allowance currently gives a lower taxable profit than claiming £${actualExpenses.toFixed(2)} actual expenses.`
        : `Claiming £${actualExpenses.toFixed(2)} actual expenses currently gives a lower taxable profit than the £${tradingAllowance.toFixed(2)} trading allowance.`,
      scenarios: [
        { method: 'actual_expenses', deduction: actualExpenses, taxableProfit: actualProfit },
        { method: 'trading_allowance', deduction: tradingAllowance, taxableProfit: allowanceProfit },
      ],
      warning: 'The two methods cannot be claimed together. Confirm the chosen method before filing.',
    },
    boxes,
    calculated: { box20TotalAllowableExpenses: actualExpenses, box21NetProfit: Math.max(0, actualProfit), box22NetLoss: Math.max(0, -actualProfit) },
    trace,
    blockers,
    filingReady: blockers.length === 0,
  };
}