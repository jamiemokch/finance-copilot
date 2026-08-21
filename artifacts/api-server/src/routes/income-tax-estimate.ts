import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { estimateSoleTraderIncomeTax, getUkIncomeTaxRules, type AccountingBasis } from "../lib/income-tax.js";
import { requireProfile } from "./profiles.js";

const router = Router();

function taxYearPeriod(taxYear: string) {
  const match = /^(\d{4})\/(\d{2})$/.exec(taxYear);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== (startYear + 1) % 100) return null;
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

// GET /profiles/:profileId/income-tax-estimate
router.get("/profiles/:profileId/income-tax-estimate", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const period = taxYearPeriod(profile.taxYear);
    if (!period || !getUkIncomeTaxRules(profile.taxYear)) {
      res.status(422).json({ error: "The selected profile tax year is not supported for an income-tax estimate" });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const ytdEnd = today < period.end ? today : period.end;
    const transactions = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.profileId, profile.id));
    const records = transactions.filter((transaction) =>
      transaction.date >= period.start && transaction.date <= ytdEnd,
    );

    const categoryMap = new Map<string, {
      category: string;
      recordType: "income" | "expense";
      amount: number;
      records: Array<{ id: string; date: string; description: string; amount: number }>;
    }>();
    let totalIncome = 0;
    let totalExpenses = 0;
    let allowableExpenses = 0;

    for (const transaction of records) {
      const recordType = transaction.recordType === "income" || transaction.recordType === "expense"
        ? transaction.recordType
        : transaction.amount >= 0 ? "income" : "expense";
      const amount = Math.abs(transaction.amount);
      if (recordType === "income") totalIncome += amount;
      else {
        totalExpenses += amount;
        if (transaction.taxTreatment === "deductible") {
          allowableExpenses += transaction.allowableAmount == null
            ? amount
            : Math.abs(transaction.allowableAmount);
        }
      }

      const key = `${recordType}:${transaction.category}`;
      const entry = categoryMap.get(key) ?? {
        category: transaction.category || (recordType === "income" ? "income" : "expense"),
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

    const accountingBasis: AccountingBasis = profile.accountingBasis === "accrual" ? "accrual" : "cash";
    const profitLoss = totalIncome - totalExpenses;
    const taxableBusinessProfit = totalIncome - allowableExpenses;
    const otherTaxableIncome = profile.otherTaxableIncomeTaxYear === profile.taxYear
      ? profile.otherTaxableIncome
      : null;
    const estimate = estimateSoleTraderIncomeTax({
      taxYear: profile.taxYear,
      accountingBasis,
      businessProfitInput: taxableBusinessProfit,
      otherTaxableIncome,
    });

    res.json({
      period: { ...period, end: ytdEnd },
      taxYear: profile.taxYear,
      accountingBasis,
      profitLoss: {
        totalIncome: roundMoney(totalIncome),
        totalExpenses: roundMoney(totalExpenses),
        profitLoss: roundMoney(profitLoss),
        taxableBusinessProfit: roundMoney(taxableBusinessProfit),
        recordCount: records.length,
      },
      categories: [...categoryMap.values()]
        .map((entry) => ({ ...entry, amount: roundMoney(entry.amount) }))
        .sort((a, b) => b.amount - a.amount),
      estimate,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to build income-tax estimate" });
  }
});

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default router;