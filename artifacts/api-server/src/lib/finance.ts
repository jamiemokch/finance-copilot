/**
 * Deterministic UK Sole Trader tax and P&L calculations.
 * All arithmetic lives here; the AI never does maths — it only explains these results.
 *
 * Key principle: actual vs. allowable distinction.
 * - `amount` on a transaction = what was actually paid
 * - `allowableAmount` = the tax-deductible portion (amount × allowablePercentage/100)
 * - Non-deductible items are RECORDED in the ledger but not deducted from profit
 */

export interface TaxLine {
  label: string;
  amount: number;
}

export interface TaxCalculation {
  lines: TaxLine[];
  balanceDue: number;
  reserveGap: number;
}

export interface PLBreakdown {
  revenues: number;
  confirmedExpenses: number;      // tax-allowable portion only (sum of allowableAmount)
  nonDeductibleExpenses: number;  // recorded but not deductible (for transparency)
  pendingExpenses: number;
  profit: number;                 // revenues − confirmedExpenses (actual taxable profit)
}

export interface AccountBalance {
  name: string;
  balance: number;
}

export interface CashPosition {
  accounts: AccountBalance[];
  taxReserve: number;
  apDueWithin30Days: number;
  netAvailable: number;
}

export interface AREntry {
  name: string;
  amount: number;
  daysPastDue: number;
  invoiceCount: number;
}

export interface APEntry {
  name: string;
  amount: number;
  daysUntilDue: number;
}

export interface KPI {
  id: string;
  label: string;
  value: string;
  trend: string;
  basis: string;
  rawValue?: number;
  detail?: string;
}

export interface SAReadiness {
  score: number;
  completedCount: number;
  totalCount: number;
}

export interface MonthlyDataPoint {
  month: string;          // "2024-11"
  revenue: number;
  expenses: number;
  profit: number;
  cumulativeProfit: number;
}

export interface VATWarning {
  currentRevenue: number;
  threshold: number;       // £90,000
  registrationThreshold: number;  // £90,000 (2024/25)
  warning: boolean;
  urgency: 'none' | 'watch' | 'urgent';
  message: string;
}

export interface EvidenceCoverage {
  tierAmounts: Record<'0' | '1' | '2' | '3' | '4', number>;
  strongEvidencePct: number;
  selfDeclaredPct: number;
  documentedPct: number;
  coveragePct: number;
  defensibilityPct: number;
  classificationPct: number;
  financialConfidenceScore: number;
  financialConfidenceLabel: 'high' | 'medium' | 'low' | 'very_low';
}

export interface FinancialPosition {
  plBreakdown: PLBreakdown;
  taxCalculation: TaxCalculation;
  cashPosition: CashPosition;
  arEntries: AREntry[];
  apEntries: APEntry[];
  kpis: KPI[];
  saReadiness: SAReadiness;
  pendingInboxCount: number;
  monthlyTrend: MonthlyDataPoint[];
  vatWarning: VATWarning | null;
  evidenceCoverage: EvidenceCoverage;
}

// ─── UK Sole Trader Tax 2024/25 ───────────────────────────────────────────────

const TAX_YEAR = '2024/25';
const PERSONAL_ALLOWANCE = 12_570;
const BASIC_RATE_LIMIT = 50_270;
const BASIC_RATE = 0.20;
const HIGHER_RATE = 0.40;
const CLASS4_LOWER = 12_570;
const CLASS4_UPPER = 50_270;
const CLASS4_MAIN_RATE = 0.09;
const CLASS4_ADDITIONAL_RATE = 0.02;
const CLASS2_ANNUAL = 179.40;
const CLASS2_THRESHOLD = 12_570;
const POA_RATE = 0.50;
const VAT_THRESHOLD = 90_000;

export function computeTaxForProfit(profit: number, taxReserve: number): TaxCalculation {
  const totalIncome = profit;
  const taxableIncome = Math.max(0, totalIncome - PERSONAL_ALLOWANCE);

  let incomeTax = 0;
  if (taxableIncome > 0) {
    const basicBand = Math.min(taxableIncome, BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE);
    incomeTax += basicBand * BASIC_RATE;
    const higherBand = Math.max(0, taxableIncome - (BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE));
    incomeTax += higherBand * HIGHER_RATE;
  }
  incomeTax = Math.round(incomeTax);

  let class4Ni = 0;
  if (profit > CLASS4_LOWER) {
    const mainBand = Math.min(profit, CLASS4_UPPER) - CLASS4_LOWER;
    class4Ni += mainBand * CLASS4_MAIN_RATE;
    const additionalBand = Math.max(0, profit - CLASS4_UPPER);
    class4Ni += additionalBand * CLASS4_ADDITIONAL_RATE;
  }
  class4Ni = Math.round(class4Ni);

  const class2Ni = profit > CLASS2_THRESHOLD ? Math.round(CLASS2_ANNUAL) : 0;

  const totalTax = incomeTax + class4Ni + class2Ni;
  const poa = Math.round(totalTax * POA_RATE);
  const balanceDue = totalTax;
  const reserveGap = Math.max(0, balanceDue - taxReserve);

  const lines: TaxLine[] = [
    { label: `Income tax (${TAX_YEAR})`, amount: incomeTax },
    { label: 'Class 4 NI (9% on profit £12,570–£50,270)', amount: class4Ni },
  ];
  if (class2Ni > 0) {
    lines.push({ label: 'Class 2 NI (£3.45/week)', amount: class2Ni });
  }
  lines.push({ label: 'Payments on Account due Jan 31', amount: poa });

  return { lines, balanceDue, reserveGap };
}

/**
 * Compute the marginal tax saving from an additional deduction.
 * Uses the difference between tax before and after deducting the expense.
 */
export function computeTaxImpactDiff(profitBefore: number, profitAfter: number): number {
  const taxBefore = computeTaxForProfit(profitBefore, 0).balanceDue;
  const taxAfter = computeTaxForProfit(profitAfter, 0).balanceDue;
  return Math.round(taxBefore - taxAfter); // positive = tax saving
}

export function computePLBreakdown(
  transactions: Array<{
    amount: number;
    category: string;
    taxTreatment: string;
    allowableAmount?: number | null;
    allowablePercentage?: number | null;
  }>,
  pendingInboxAmounts: number[],
): PLBreakdown {
  let revenues = 0;
  let confirmedExpenses = 0;
  let nonDeductibleExpenses = 0;

  for (const tx of transactions) {
    const isIncome = tx.category === 'income' || tx.taxTreatment === 'income';
    const isDeductible =
      (tx.category === 'expense' || tx.category === 'expense_deductible') &&
      tx.taxTreatment === 'deductible' &&
      tx.amount < 0;
    const isNonDeductible =
      tx.taxTreatment === 'non_deductible' && tx.amount < 0;

    if (isIncome) {
      revenues += Math.abs(tx.amount);
    } else if (isDeductible) {
      // Use allowableAmount if set (handles mixed-use); otherwise full amount
      const allowable =
        tx.allowableAmount != null
          ? Math.abs(tx.allowableAmount)
          : Math.abs(tx.amount);
      confirmedExpenses += allowable;
    } else if (isNonDeductible) {
      // Recorded but not deducted from profit
      nonDeductibleExpenses += Math.abs(tx.amount);
    }
  }

  revenues = Math.round(revenues);
  confirmedExpenses = Math.round(confirmedExpenses);
  nonDeductibleExpenses = Math.round(nonDeductibleExpenses);

  const pendingExpenses = Math.round(
    pendingInboxAmounts.reduce((sum, a) => sum + (a || 0), 0),
  );

  const profit = revenues - confirmedExpenses;

  return { revenues, confirmedExpenses, nonDeductibleExpenses, pendingExpenses, profit };
}

export function computeCashPosition(
  cashAccounts: AccountBalance[],
  taxReserve: number,
  apEntries: APEntry[],
): CashPosition {
  const apDueWithin30Days = Math.round(
    apEntries
      .filter((ap) => ap.daysUntilDue <= 30)
      .reduce((sum, ap) => sum + ap.amount, 0),
  );

  const grossCash = cashAccounts.reduce((sum, a) => sum + a.balance, 0);
  const netAvailable = Math.round(grossCash - taxReserve - apDueWithin30Days);

  return { accounts: cashAccounts, taxReserve, apDueWithin30Days, netAvailable };
}

export function buildKPIs(
  pl: PLBreakdown,
  tax: TaxCalculation,
  cash: CashPosition,
  arEntries: AREntry[],
  pendingInboxCount: number,
): KPI[] {
  const totalAR = arEntries.reduce((sum, e) => sum + e.amount, 0);
  const profitMargin = pl.revenues > 0 ? ((pl.profit / pl.revenues) * 100).toFixed(0) : '0';
  const taxGapNote =
    tax.reserveGap > 0
      ? `Tax gap: £${tax.reserveGap.toLocaleString()} still needed`
      : 'Reserve covers your tax bill';

  return [
    {
      id: 'kpi1',
      label: 'YTD Profit',
      value: `£${pl.profit.toLocaleString()}`,
      trend: `${profitMargin}% margin`,
      basis: `Revenue £${pl.revenues.toLocaleString()} less allowable expenses £${pl.confirmedExpenses.toLocaleString()}`,
      rawValue: pl.profit,
      detail:
        pendingInboxCount > 0
          ? `${pendingInboxCount} unclassified item${pendingInboxCount > 1 ? 's' : ''} (£${pl.pendingExpenses.toLocaleString()})`
          : pl.nonDeductibleExpenses > 0
          ? `£${pl.nonDeductibleExpenses.toLocaleString()} non-deductible recorded`
          : undefined,
    },
    {
      id: 'kpi2',
      label: 'Est. Tax Due',
      value: `£${tax.balanceDue.toLocaleString()}`,
      trend: tax.reserveGap > 0 ? `↑ ${taxGapNote}` : `✓ ${taxGapNote}`,
      basis: 'UK sole trader 2024/25 — income tax + Class 4 NI',
      rawValue: tax.balanceDue,
      detail:
        tax.reserveGap > 0
          ? `£${tax.reserveGap.toLocaleString()} more to set aside`
          : undefined,
    },
    {
      id: 'kpi3',
      label: 'Available Cash',
      value: `£${cash.netAvailable.toLocaleString()}`,
      trend: `After £${cash.taxReserve.toLocaleString()} tax reserve`,
      basis: `Gross £${cash.accounts.reduce((s, a) => s + a.balance, 0).toLocaleString()} less tax reserve and AP due`,
      rawValue: cash.netAvailable,
    },
    {
      id: 'kpi4',
      label: 'Invoices Owed',
      value: `£${totalAR.toLocaleString()}`,
      trend: arEntries.some((e) => e.daysPastDue > 0) ? '⚠ Overdue' : 'All current',
      basis: `${arEntries.length} outstanding invoice${arEntries.length !== 1 ? 's' : ''}`,
      rawValue: totalAR,
    },
    {
      id: 'kpi5',
      label: 'SA Readiness',
      value: pendingInboxCount > 0 ? `${pendingInboxCount} to review` : 'On track',
      trend: pendingInboxCount > 0 ? 'Action needed' : 'Filing Jan 31',
      basis:
        pendingInboxCount > 0
          ? 'Resolve inbox items to improve readiness'
          : 'Inbox clear — keep records updated',
    },
  ];
}

/** Monthly revenue/expense/profit breakdown for trend charts. */
export function computeMonthlyTrend(
  transactions: Array<{
    date: string;
    amount: number;
    taxTreatment: string;
    category: string;
    allowableAmount?: number | null;
  }>,
): MonthlyDataPoint[] {
  const byMonth = new Map<string, { revenue: number; expenses: number }>();

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7); // "2024-11"
    if (!byMonth.has(month)) byMonth.set(month, { revenue: 0, expenses: 0 });
    const m = byMonth.get(month)!;

    if (tx.taxTreatment === 'income' || tx.category === 'income') {
      m.revenue += Math.abs(tx.amount);
    } else if (tx.taxTreatment === 'deductible' && tx.amount < 0) {
      const allowable =
        tx.allowableAmount != null ? Math.abs(tx.allowableAmount) : Math.abs(tx.amount);
      m.expenses += allowable;
    }
  }

  const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  let cumulativeProfit = 0;

  return sorted.map(([month, { revenue, expenses }]) => {
    const profit = revenue - expenses;
    cumulativeProfit += profit;
    return {
      month,
      revenue: Math.round(revenue),
      expenses: Math.round(expenses),
      profit: Math.round(profit),
      cumulativeProfit: Math.round(cumulativeProfit),
    };
  });
}

/** VAT threshold monitoring for 2024/25. */
export function computeVATWarning(currentRevenue: number): VATWarning {
  const pct = currentRevenue / VAT_THRESHOLD;
  let urgency: VATWarning['urgency'] = 'none';
  let warning = false;
  let message = '';

  if (currentRevenue >= VAT_THRESHOLD) {
    urgency = 'urgent';
    warning = true;
    message = `Revenue £${currentRevenue.toLocaleString()} has crossed the VAT registration threshold (£${VAT_THRESHOLD.toLocaleString()}). You must register for VAT.`;
  } else if (pct >= 0.85) {
    urgency = 'urgent';
    warning = true;
    message = `Revenue is ${Math.round(pct * 100)}% of the VAT threshold. Register before reaching £${VAT_THRESHOLD.toLocaleString()} to avoid penalties.`;
  } else if (pct >= 0.70) {
    urgency = 'watch';
    warning = true;
    message = `Revenue is ${Math.round(pct * 100)}% of the £${VAT_THRESHOLD.toLocaleString()} VAT threshold. Monitor closely.`;
  }

  return {
    currentRevenue: Math.round(currentRevenue),
    threshold: VAT_THRESHOLD,
    registrationThreshold: VAT_THRESHOLD,
    warning,
    urgency,
    message,
  };
}

/**
 * Measure the quality of the records, independently from any tax arithmetic.
 * Lower evidence tiers are stronger: 1=document, 2=bank CSV, 3=ledger,
 * 4=manual declaration; tier 0 is sample/demo data.
 */
export function computeEvidenceCoverage(
  transactions: Array<{
    amount: number;
    evidenceTier?: number | null;
    classificationConfidence?: number | null;
  }>,
  pendingInboxCount = 0,
): EvidenceCoverage {
  const tierAmounts: EvidenceCoverage['tierAmounts'] = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 };
  let classifiedTotal = 0;
  let classifiedCount = 0;

  for (const transaction of transactions) {
    const tier = Math.max(0, Math.min(4, transaction.evidenceTier ?? 4)) as 0 | 1 | 2 | 3 | 4;
    tierAmounts[String(tier) as keyof typeof tierAmounts] += Math.abs(transaction.amount);
    if (typeof transaction.classificationConfidence === 'number') {
      classifiedTotal += Math.max(0, Math.min(1, transaction.classificationConfidence));
      classifiedCount += 1;
    }
  }

  const totalAmount = Object.values(tierAmounts).reduce((sum, amount) => sum + amount, 0);
  const percentage = (amount: number) => totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
  const strongEvidencePct = percentage(tierAmounts['1'] + tierAmounts['2']);
  const selfDeclaredPct = percentage(tierAmounts['3'] + tierAmounts['4']);
  const documentedPct = percentage(tierAmounts['1']);
  const recordTotal = transactions.length + pendingInboxCount;
  const coveragePct = recordTotal > 0 ? Math.round((transactions.length / recordTotal) * 100) : 0;
  const classificationPct = classifiedCount > 0 ? Math.round((classifiedTotal / classifiedCount) * 100) : 0;
  const financialConfidenceScore = Math.round(
    coveragePct * 0.3 + strongEvidencePct * 0.45 + classificationPct * 0.25,
  );
  const financialConfidenceLabel: EvidenceCoverage['financialConfidenceLabel'] =
    financialConfidenceScore >= 85 ? 'high'
      : financialConfidenceScore >= 65 ? 'medium'
      : financialConfidenceScore >= 40 ? 'low'
      : 'very_low';

  return {
    tierAmounts: Object.fromEntries(
      Object.entries(tierAmounts).map(([tier, amount]) => [tier, Math.round(amount * 100) / 100]),
    ) as EvidenceCoverage['tierAmounts'],
    strongEvidencePct,
    selfDeclaredPct,
    documentedPct,
    coveragePct,
    defensibilityPct: strongEvidencePct,
    classificationPct,
    financialConfidenceScore,
    financialConfidenceLabel,
  };
}

/** Format a number as GBP string. */
export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString()}`;
}
