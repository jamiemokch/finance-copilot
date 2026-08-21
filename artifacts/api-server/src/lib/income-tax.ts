export type AccountingBasis = "cash" | "accrual";

export interface IncomeTaxBand {
  label: string;
  rate: number;
  taxableAmount: number;
  tax: number;
}

export interface IncomeTaxEstimate {
  status: "complete" | "incomplete";
  taxYear: string;
  accountingBasis: AccountingBasis;
  businessProfitInput: number;
  otherTaxableIncome: number | null;
  totalIncome: number | null;
  personalAllowance: number | null;
  taxableIncome: number | null;
  estimatedIncomeTax: number | null;
  bands: IncomeTaxBand[];
  assumptions: string[];
  missingInputs: string[];
}

interface UkIncomeTaxRules {
  personalAllowance: number;
  personalAllowanceTaperStart: number;
  basicRateBand: number;
  higherRateThreshold: number;
}

const UK_RULES: Record<string, UkIncomeTaxRules> = {
  "2023/24": { personalAllowance: 12_570, personalAllowanceTaperStart: 100_000, basicRateBand: 37_700, higherRateThreshold: 125_140 },
  "2024/25": { personalAllowance: 12_570, personalAllowanceTaperStart: 100_000, basicRateBand: 37_700, higherRateThreshold: 125_140 },
  "2025/26": { personalAllowance: 12_570, personalAllowanceTaperStart: 100_000, basicRateBand: 37_700, higherRateThreshold: 125_140 },
  "2026/27": { personalAllowance: 12_570, personalAllowanceTaperStart: 100_000, basicRateBand: 37_700, higherRateThreshold: 125_140 },
};

export function getUkIncomeTaxRules(taxYear: string): UkIncomeTaxRules | null {
  return UK_RULES[taxYear] ?? null;
}

/**
 * A filing-first income-tax estimate. It intentionally returns no amount until
 * the user has confirmed their other taxable income, rather than assuming it.
 * It does not calculate National Insurance, payments on account, VAT, or any
 * reliefs/deductions outside the canonical business P&L input.
 */
export function estimateSoleTraderIncomeTax(input: {
  taxYear: string;
  accountingBasis: AccountingBasis;
  businessProfitInput: number;
  otherTaxableIncome: number | null;
}): IncomeTaxEstimate {
  const rules = getUkIncomeTaxRules(input.taxYear);
  if (!rules) {
    throw new Error(`Unsupported UK tax year: ${input.taxYear}`);
  }

  const assumptions = [
    "This is a current-tax-year, year-to-date income-tax estimate. It is not a filed return or a guaranteed liability.",
    "The business-profit input comes from saved Financial Memory income and expense records for the selected tax year.",
    input.accountingBasis === "cash"
      ? "This estimate uses the current ledger dates as the profile's cash-basis dates."
      : "An accrual-basis estimate needs invoice or recognition dates that are not yet stored in Financial Memory.",
    "The standard UK Personal Allowance is used and reduced for income above £100,000.",
    "National Insurance, VAT, payments on account, reliefs, losses carried forward, and other Self Assessment fields are not included.",
  ];

  const otherTaxableIncome = input.otherTaxableIncome;
  const missingInputs: string[] = [];
  if (otherTaxableIncome == null) missingInputs.push("Other taxable income for this tax year");
  if (input.accountingBasis === "accrual") missingInputs.push("Accrual recognition dates for Financial Memory records");

  if (missingInputs.length > 0) {
    return {
      status: "incomplete",
      taxYear: input.taxYear,
      accountingBasis: input.accountingBasis,
      businessProfitInput: roundMoney(input.businessProfitInput),
      otherTaxableIncome: null,
      totalIncome: null,
      personalAllowance: null,
      taxableIncome: null,
      estimatedIncomeTax: null,
      bands: [],
      assumptions,
      missingInputs,
    };
  }

  // The incomplete branch above returns for null; keep a runtime guard here
  // as this pure engine can also be called independently of the HTTP route.
  if (otherTaxableIncome == null) {
    throw new Error("Other taxable income is required for a completed estimate");
  }

  // This foundation does not model loss relief. A trading loss contributes £0
  // to taxable income until a later filing feature captures its treatment.
  const taxableBusinessProfit = Math.max(0, input.businessProfitInput);
  const totalIncome = taxableBusinessProfit + otherTaxableIncome;
  const personalAllowanceReduction = Math.max(0, (totalIncome - rules.personalAllowanceTaperStart) / 2);
  const personalAllowance = Math.max(0, rules.personalAllowance - personalAllowanceReduction);
  const taxableIncome = Math.max(0, totalIncome - personalAllowance);

  const basicTaxable = Math.min(taxableIncome, rules.basicRateBand);
  const higherTaxable = Math.min(
    Math.max(0, taxableIncome - rules.basicRateBand),
    Math.max(0, rules.higherRateThreshold - personalAllowance - rules.basicRateBand),
  );
  const additionalTaxable = Math.max(0, taxableIncome - basicTaxable - higherTaxable);
  const bands: IncomeTaxBand[] = [
    { label: "Basic rate", rate: 20, taxableAmount: roundMoney(basicTaxable), tax: roundMoney(basicTaxable * 0.2) },
    { label: "Higher rate", rate: 40, taxableAmount: roundMoney(higherTaxable), tax: roundMoney(higherTaxable * 0.4) },
    { label: "Additional rate", rate: 45, taxableAmount: roundMoney(additionalTaxable), tax: roundMoney(additionalTaxable * 0.45) },
  ].filter((band) => band.taxableAmount > 0);

  return {
    status: "complete",
    taxYear: input.taxYear,
    accountingBasis: input.accountingBasis,
    businessProfitInput: roundMoney(input.businessProfitInput),
    otherTaxableIncome: roundMoney(otherTaxableIncome),
    totalIncome: roundMoney(totalIncome),
    personalAllowance: roundMoney(personalAllowance),
    taxableIncome: roundMoney(taxableIncome),
    estimatedIncomeTax: roundMoney(bands.reduce((sum, band) => sum + band.tax, 0)),
    bands,
    assumptions,
    missingInputs: [],
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}