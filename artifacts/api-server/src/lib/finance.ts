/**
 * Deterministic UK Sole Trader tax and P&L calculations.
 * All arithmetic lives here; the AI never does maths — it only explains these results.
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
  confirmedExpenses: number;
  pendingExpenses: number;
  profit: number;
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

export interface FinancialPosition {
  plBreakdown: PLBreakdown;
  taxCalculation: TaxCalculation;
  cashPosition: CashPosition;
  arEntries: AREntry[];
  apEntries: APEntry[];
  kpis: KPI[];
  saReadiness: SAReadiness;
  pendingInboxCount: number;
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
const CLASS2_ANNUAL = 179.40; // £3.45/week × 52
const CLASS2_THRESHOLD = 12_570;
// Simplified PoA: 50% of current year bill, due Jan 31
const POA_RATE = 0.50;

export function computeTaxForProfit(profit: number, taxReserve: number): TaxCalculation {
  const totalIncome = profit;
  const taxableIncome = Math.max(0, totalIncome - PERSONAL_ALLOWANCE);

  // Income Tax
  let incomeTax = 0;
  if (taxableIncome > 0) {
    const basicBand = Math.min(taxableIncome, BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE);
    incomeTax += basicBand * BASIC_RATE;
    const higherBand = Math.max(0, taxableIncome - (BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE));
    incomeTax += higherBand * HIGHER_RATE;
  }
  incomeTax = Math.round(incomeTax);

  // Class 4 NI
  let class4Ni = 0;
  if (profit > CLASS4_LOWER) {
    const mainBand = Math.min(profit, CLASS4_UPPER) - CLASS4_LOWER;
    class4Ni += mainBand * CLASS4_MAIN_RATE;
    const additionalBand = Math.max(0, profit - CLASS4_UPPER);
    class4Ni += additionalBand * CLASS4_ADDITIONAL_RATE;
  }
  class4Ni = Math.round(class4Ni);

  // Class 2 NI
  const class2Ni = profit > CLASS2_THRESHOLD ? Math.round(CLASS2_ANNUAL) : 0;

  const totalTax = incomeTax + class4Ni + class2Ni;
  const poa = Math.round(totalTax * POA_RATE);
  const balanceDue = totalTax; // Simplified: balance = total tax (Jan 31 filing)
  const reserveGap = Math.max(0, balanceDue - taxReserve);

  const lines: TaxLine[] = [
    {
      label: `Income tax (${TAX_YEAR})`,
      amount: incomeTax,
    },
    {
      label: 'Class 4 NI (9% on profit above £12,570)',
      amount: class4Ni,
    },
  ];
  if (class2Ni > 0) {
    lines.push({ label: 'Class 2 NI (£3.45/week)', amount: class2Ni });
  }
  lines.push({ label: 'Payments on Account (1st: Jan 31)', amount: poa });

  return {
    lines,
    balanceDue,
    reserveGap,
  };
}

export function computePLBreakdown(
  transactions: Array<{ amount: number; category: string; taxTreatment: string }>,
  pendingInboxAmounts: number[],
): PLBreakdown {
  let revenues = 0;
  let confirmedExpenses = 0;

  for (const tx of transactions) {
    if (tx.category === 'income' || tx.taxTreatment === 'income') {
      revenues += Math.abs(tx.amount);
    } else if (
      (tx.category === 'expense' || tx.category === 'expense_deductible') &&
      tx.taxTreatment === 'deductible' &&
      tx.amount < 0
    ) {
      confirmedExpenses += Math.abs(tx.amount);
    }
  }

  revenues = Math.round(revenues);
  confirmedExpenses = Math.round(confirmedExpenses);

  const pendingExpenses = Math.round(
    pendingInboxAmounts.reduce((sum, a) => sum + (a || 0), 0),
  );

  const profit = revenues - confirmedExpenses;

  return { revenues, confirmedExpenses, pendingExpenses, profit };
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

  return {
    accounts: cashAccounts,
    taxReserve,
    apDueWithin30Days,
    netAvailable,
  };
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
      basis: `Revenue £${pl.revenues.toLocaleString()} less expenses £${pl.confirmedExpenses.toLocaleString()}`,
      rawValue: pl.profit,
      detail: pendingInboxCount > 0
        ? `${pendingInboxCount} pending item${pendingInboxCount > 1 ? 's' : ''} in Inbox (£${pl.pendingExpenses.toLocaleString()} unclassified)`
        : undefined,
    },
    {
      id: 'kpi2',
      label: 'Est. Tax Due',
      value: `£${tax.balanceDue.toLocaleString()}`,
      trend: tax.reserveGap > 0 ? `↑ ${taxGapNote}` : `✓ ${taxGapNote}`,
      basis: 'UK sole trader 2024/25 rates — income tax + Class 4 NI',
      rawValue: tax.balanceDue,
      detail: tax.reserveGap > 0 ? `£${tax.reserveGap.toLocaleString()} more to set aside` : undefined,
    },
    {
      id: 'kpi3',
      label: 'Available Cash',
      value: `£${cash.netAvailable.toLocaleString()}`,
      trend: `After £${cash.taxReserve.toLocaleString()} tax reserve`,
      basis: `Gross cash £${cash.accounts.reduce((s, a) => s + a.balance, 0).toLocaleString()} less tax reserve and AP`,
      rawValue: cash.netAvailable,
    },
    {
      id: 'kpi4',
      label: 'Invoices Owed',
      value: `£${totalAR.toLocaleString()}`,
      trend: arEntries.some((e) => e.daysPastDue > 0) ? '⚠ Overdue invoices' : 'All current',
      basis: `${arEntries.length} outstanding invoice${arEntries.length !== 1 ? 's' : ''}`,
      rawValue: totalAR,
    },
    {
      id: 'kpi5',
      label: 'SA Readiness',
      value: pendingInboxCount > 0
        ? `${pendingInboxCount} item${pendingInboxCount > 1 ? 's' : ''} to review`
        : 'On track',
      trend: pendingInboxCount > 0 ? 'Action needed' : 'Filing Jan 31',
      basis:
        pendingInboxCount > 0
          ? `Resolve inbox items to improve readiness`
          : 'Inbox clear — keep records updated',
    },
  ];
}

/** Format a number as GBP string */
export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString()}`;
}
