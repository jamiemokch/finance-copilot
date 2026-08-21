/**
 * Business ideas with live baselines computed from the current P&L.
 * Ideas are static definitions; the numerical baselines are injected live.
 */

import type { PLBreakdown } from "../lib/finance.js";

export interface BusinessIdea {
  id: string;
  category: string;
  title: string;
  summary: string;
  currentPosition: string;
  proposedAction: string;
  priorityTier: "do_now" | "consider" | "watch";
  plImpactRange?: { min: number; max: number };
  cashImpactRange?: { min: number; max: number };
  taxImpactRange?: { min: number; max: number };
  paybackRange?: { minMonths: number | null; maxMonths: number | null };
  urgencyNote?: string;
  editableAssumptions: Array<{
    key: string;
    label: string;
    value: number;
    unit: string;
    min: number;
    max: number;
    step: number;
  }>;
  whatMustBeTrue: string[];
  source: string;
  confidence: "high" | "medium" | "low";
  status: "new" | "saved" | "actioned" | "dismissed";
  committedDecisionId: string | null;
}

export function generateBusinessIdeas(
  pl: PLBreakdown,
  taxReserve: number,
): BusinessIdea[] {
  const { profit, revenues, confirmedExpenses, pendingExpenses } = pl;
  const taxGap = Math.max(0, estimateTaxDue(profit) - taxReserve);
  const totalPending = pendingExpenses;

  const ideas: BusinessIdea[] = [
    // ── TAX ──────────────────────────────────────────────────────────────
    {
      id: "tax-inbox-resolution",
      category: "tax",
      title: "Classify pending expenses to reduce your tax bill",
      summary: `You have £${totalPending.toLocaleString()} of unclassified expenses in your Inbox. Confirming these as deductible could save up to £${Math.round(totalPending * 0.29).toLocaleString()} in income tax and NI.`,
      currentPosition: `£${totalPending.toLocaleString()} pending in Inbox (unclassified)`,
      proposedAction: "Review and classify each Inbox item — takes under 5 minutes",
      priorityTier: totalPending > 500 ? "do_now" : "consider",
      taxImpactRange: {
        min: Math.round(totalPending * 0.20),
        max: Math.round(totalPending * 0.29),
      },
      plImpactRange: { min: totalPending, max: totalPending },
      cashImpactRange: { min: 0, max: 0 },
      paybackRange: { minMonths: 0, maxMonths: 0 },
      urgencyNote: "Deductions must be classified before your SA return (Jan 31)",
      editableAssumptions: [
        {
          key: "pct_deductible",
          label: "% of inbox items deductible",
          value: 80,
          unit: "%",
          min: 0,
          max: 100,
          step: 5,
        },
      ],
      whatMustBeTrue: [
        "Expenses are genuinely for business purposes",
        "You have receipts or records to support the claim",
      ],
      source: "HMRC ITTOIA 2005 s34 — allowable deductions",
      confidence: "high",
      status: "new",
      committedDecisionId: null,
    },

    {
      id: "tax-reserve-top-up",
      category: "tax",
      title: "Top up your tax reserve to avoid a January cash crunch",
      summary:
        taxGap > 0
          ? `Your tax reserve is £${taxGap.toLocaleString()} short of your estimated bill. Setting aside more now avoids a cash shock in January.`
          : "Your tax reserve currently covers your estimated bill — keep it topped up as income grows.",
      currentPosition: `Tax reserve: £${taxReserve.toLocaleString()} | Est. bill: £${estimateTaxDue(profit).toLocaleString()}`,
      proposedAction:
        taxGap > 0
          ? `Transfer £${Math.ceil(taxGap / 100) * 100} to a dedicated tax pot now`
          : "Monitor reserve monthly as revenue grows",
      priorityTier: taxGap > 1000 ? "do_now" : taxGap > 0 ? "consider" : "watch",
      cashImpactRange: { min: -taxGap, max: -taxGap },
      taxImpactRange: { min: 0, max: 0 },
      paybackRange: { minMonths: null, maxMonths: null },
      urgencyNote: "SA payment due 31 January — 5 months away",
      editableAssumptions: [
        {
          key: "monthly_set_aside",
          label: "Monthly amount to set aside",
          value: Math.max(100, Math.ceil(taxGap / 5 / 50) * 50),
          unit: "£/month",
          min: 0,
          max: 2000,
          step: 50,
        },
      ],
      whatMustBeTrue: [
        "You have sufficient cash flow to transfer the reserve",
        "You maintain the reserve in a separate account to avoid accidental spending",
      ],
      source: "HMRC SA payment deadlines",
      confidence: "high",
      status: "new",
      committedDecisionId: null,
    },

    // ── CASH ──────────────────────────────────────────────────────────────
    {
      id: "cash-invoice-chasing",
      category: "cash",
      title: "Chase overdue invoices to improve cash flow",
      summary: `You have outstanding invoices totalling over £3,400. Collecting these within 30 days adds directly to your available cash without any additional revenue effort.`,
      currentPosition: "£2,400 overdue from Axiom Ltd (7 days) — no penalty risk yet",
      proposedAction:
        "Send a polite payment reminder to Axiom Ltd today; follow up with Studio Nine if due date is near",
      priorityTier: "do_now",
      cashImpactRange: { min: 2400, max: 3400 },
      plImpactRange: { min: 0, max: 0 },
      taxImpactRange: { min: 0, max: 0 },
      paybackRange: { minMonths: 0, maxMonths: 1 },
      urgencyNote: "Late invoices become harder to collect after 30 days",
      editableAssumptions: [
        {
          key: "collection_rate",
          label: "Expected collection rate",
          value: 90,
          unit: "%",
          min: 50,
          max: 100,
          step: 5,
        },
      ],
      whatMustBeTrue: [
        "Invoice terms have passed or are about to",
        "You have the client's correct payment details",
      ],
      source: "Working capital best practice",
      confidence: "high",
      status: "new",
      committedDecisionId: null,
    },

    // ── GROWTH ────────────────────────────────────────────────────────────
    {
      id: "growth-day-rate",
      category: "growth",
      title: "Increase your effective day rate by 10%",
      summary: `Based on your current revenue of £${revenues.toLocaleString()}, a 10% rate increase on new projects would add approximately £${Math.round(revenues * 0.1).toLocaleString()} to annual P&L — the highest-leverage change you can make.`,
      currentPosition: `Revenue YTD: £${revenues.toLocaleString()} across 4 projects`,
      proposedAction:
        "Apply the new rate to your next proposal — test the market before blanket increase",
      priorityTier: "consider",
      plImpactRange: {
        min: Math.round(revenues * 0.05),
        max: Math.round(revenues * 0.15),
      },
      taxImpactRange: {
        min: Math.round(revenues * 0.05 * 0.29),
        max: Math.round(revenues * 0.15 * 0.29),
      },
      cashImpactRange: {
        min: Math.round(revenues * 0.05 * 0.71),
        max: Math.round(revenues * 0.15 * 0.71),
      },
      paybackRange: { minMonths: 1, maxMonths: 3 },
      urgencyNote: "Rate increases are easier to implement at the start of new client relationships",
      editableAssumptions: [
        {
          key: "rate_increase_pct",
          label: "Day rate increase",
          value: 10,
          unit: "%",
          min: 5,
          max: 30,
          step: 5,
        },
        {
          key: "projects_at_new_rate",
          label: "Projects at new rate per year",
          value: 3,
          unit: "projects",
          min: 1,
          max: 8,
          step: 1,
        },
      ],
      whatMustBeTrue: [
        "Market demand supports the higher rate",
        "Your portfolio demonstrates the value increase",
        "Existing retainer contracts allow renegotiation",
      ],
      source: "Freelancer rate benchmarking — IPSE 2024",
      confidence: "medium",
      status: "new",
      committedDecisionId: null,
    },

    // ── OPERATIONS ────────────────────────────────────────────────────────
    {
      id: "ops-expense-review",
      category: "operations",
      title: "Review recurring subscriptions for unused tools",
      summary: `With £${confirmedExpenses.toLocaleString()} in confirmed expenses, a quick audit of recurring subscriptions often reveals 10–15% that can be cancelled or downgraded — savings of £${Math.round(confirmedExpenses * 0.10).toLocaleString()}–£${Math.round(confirmedExpenses * 0.15).toLocaleString()}/year.`,
      currentPosition: `Confirmed expenses: £${confirmedExpenses.toLocaleString()} YTD`,
      proposedAction:
        "Audit bank statement for recurring payments — cancel anything unused for 3+ months",
      priorityTier: "watch",
      plImpactRange: {
        min: Math.round(confirmedExpenses * 0.05),
        max: Math.round(confirmedExpenses * 0.15),
      },
      taxImpactRange: { min: 0, max: 0 },
      cashImpactRange: {
        min: Math.round(confirmedExpenses * 0.05),
        max: Math.round(confirmedExpenses * 0.15),
      },
      paybackRange: { minMonths: 1, maxMonths: 2 },
      editableAssumptions: [
        {
          key: "savings_pct",
          label: "Estimated savings",
          value: 10,
          unit: "%",
          min: 5,
          max: 25,
          step: 5,
        },
      ],
      whatMustBeTrue: [
        "You have access to bank/card statements for the full year",
        "Cancelled tools won't impact current project delivery",
      ],
      source: "SME operating cost benchmarks",
      confidence: "medium",
      status: "new",
      committedDecisionId: null,
    },
  ];

  // Only include inbox idea if there are actually pending items
  return ideas.filter(
    (idea) => idea.id !== "tax-inbox-resolution" || totalPending > 0,
  );
}

/** Simplified tax estimate for idea baselines (not the canonical computation) */
function estimateTaxDue(profit: number): number {
  const taxable = Math.max(0, profit - 12570);
  const incomeTax = Math.min(taxable, 37700) * 0.2 + Math.max(0, taxable - 37700) * 0.4;
  const class4 = Math.max(0, Math.min(profit, 50270) - 12570) * 0.09;
  const class2 = profit > 12570 ? 179 : 0;
  return Math.round(incomeTax + class4 + class2);
}
