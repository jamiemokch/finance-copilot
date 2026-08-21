import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { estimateSoleTraderIncomeTax, getUkIncomeTaxRules, type AccountingBasis } from "../lib/income-tax.js";
import { requireProfile } from "./profiles.js";
import { getOrMigrateSa100Context } from "../lib/self-assessment-context.js";
import { summarizeTaxYearLedger } from "../lib/tax-year-ledger.js";

const router = Router();

// GET /profiles/:profileId/income-tax-estimate
router.get("/profiles/:profileId/income-tax-estimate", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    if (!getUkIncomeTaxRules(profile.taxYear)) {
      res.status(422).json({ error: "The selected profile tax year is not supported for an income-tax estimate" });
      return;
    }

    const transactions = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.profileId, profile.id), eq(transactionsTable.ledgerStatus, "active")));
    const ledger = summarizeTaxYearLedger(transactions, profile.taxYear);
    if (!ledger) { res.status(422).json({ error: "The selected profile tax year is not supported for an income-tax estimate" }); return; }
    if (!ledger.hasStarted) { res.status(422).json({ error: "The selected tax year has not started yet" }); return; }

    const accountingBasis: AccountingBasis = profile.accountingBasis === "accrual" ? "accrual" : "cash";
    const sa100Context = await getOrMigrateSa100Context(req.user.id, profile.taxYear);
    const otherTaxableIncome = sa100Context?.otherTaxableIncome ?? null;
    const estimate = estimateSoleTraderIncomeTax({
      taxYear: profile.taxYear,
      accountingBasis,
      businessProfitInput: ledger.taxableBusinessProfit,
      otherTaxableIncome,
    });

    res.json({
      period: ledger.period,
      taxYear: profile.taxYear,
      accountingBasis,
      profitLoss: {
        totalIncome: ledger.totalIncome,
        totalExpenses: ledger.totalExpenses,
        profitLoss: ledger.profitLoss,
        taxableBusinessProfit: ledger.taxableBusinessProfit,
        recordCount: ledger.records.length,
      },
      categories: ledger.categories,
      estimate,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to build income-tax estimate" });
  }
});

export default router;