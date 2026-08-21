import type { Transaction } from '@workspace/db';

export interface TaxYearLedgerCategory {
  category: string;
  recordType: 'income' | 'expense';
  amount: number;
  records: Array<{ id: string; date: string; description: string; amount: number }>;
}

export function taxYearPeriod(taxYear: string): { start: string; end: string } | null {
  const match = /^(\d{4})\/(\d{2})$/.exec(taxYear);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== (startYear + 1) % 100) return null;
  return { start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` };
}

export function summarizeTaxYearLedger(
  transactions: Transaction[],
  taxYear: string,
  asOf = new Date().toISOString().slice(0, 10),
) {
  const period = taxYearPeriod(taxYear);
  if (!period) return null;
  const hasStarted = asOf >= period.start;
  const end = !hasStarted ? period.start : asOf < period.end ? asOf : period.end;
  const records = hasStarted
    ? transactions.filter((transaction) => transaction.date >= period.start && transaction.date <= end)
    : [];
  const categoryMap = new Map<string, TaxYearLedgerCategory>();
  let totalIncome = 0;
  let totalExpenses = 0;
  let allowableExpenses = 0;

  for (const transaction of records) {
    // Explicit record type is canonical. Signed amount remains a legacy fallback.
    const recordType = transaction.recordType === 'income' || transaction.recordType === 'expense'
      ? transaction.recordType
      : transaction.amount >= 0 ? 'income' : 'expense';
    const amount = Math.abs(transaction.amount);
    if (recordType === 'income') totalIncome += amount;
    else {
      totalExpenses += amount;
      if (transaction.taxTreatment === 'deductible') {
        allowableExpenses += transaction.allowableAmount == null ? amount : Math.abs(transaction.allowableAmount);
      }
    }

    const key = `${recordType}:${transaction.category}`;
    const entry = categoryMap.get(key) ?? {
      category: transaction.category || (recordType === 'income' ? 'income' : 'expense'),
      recordType,
      amount: 0,
      records: [],
    };
    entry.amount += amount;
    entry.records.push({
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
    });
    categoryMap.set(key, entry);
  }

  return {
    period: { start: period.start, end },
    hasStarted,
    isYearToDate: end !== period.end,
    records,
    totalIncome: roundMoney(totalIncome),
    totalExpenses: roundMoney(totalExpenses),
    allowableExpenses: roundMoney(allowableExpenses),
    profitLoss: roundMoney(totalIncome - totalExpenses),
    taxableBusinessProfit: roundMoney(totalIncome - allowableExpenses),
    categories: [...categoryMap.values()]
      .map((entry) => ({ ...entry, amount: roundMoney(entry.amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}