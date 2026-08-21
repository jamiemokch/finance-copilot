import { Router } from "express";
import { db } from "@workspace/db";
import {
  transactionsTable, inboxItemsTable, saChecklistItemsTable, decisionMemoryTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  computePLBreakdown, computeTaxForProfit, computeCashPosition, buildKPIs,
  computeMonthlyTrend, computeVATWarning, computeEvidenceCoverage,
  type AccountBalance, type AREntry, type APEntry,
} from "../lib/finance.js";
import { generateBusinessIdeasAI, isConfigured } from "../lib/ai.js";
import { requireProfile } from "./profiles.js";

const router = Router();

// GET /profiles/:profileId/position — full financial position from live DB data
router.get("/profiles/:profileId/position", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const [transactions, inboxItems, saItems] = await Promise.all([
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id)),
      db.select().from(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, profile.id)),
    ]);

    const pendingInbox = inboxItems.filter((i) => i.status === "pending");
    const pendingAmounts = pendingInbox.map((i) => i.amount ?? 0);

    const pl = computePLBreakdown(transactions, pendingAmounts);
    const taxReserve = profile.taxReserve ?? 3500;
    const tax = computeTaxForProfit(pl.profit, taxReserve);

    const cashAccounts = (profile.cashAccounts as AccountBalance[]) ?? [];
    const arEntries = (profile.arEntries as AREntry[]) ?? [];
    const apEntries = (profile.apEntries as APEntry[]) ?? [];

    const cash = computeCashPosition(cashAccounts, taxReserve, apEntries);
    const kpis = buildKPIs(pl, tax, cash, arEntries, pendingInbox.length);
    const monthlyTrend = computeMonthlyTrend(transactions);
    const vatWarning = computeVATWarning(pl.revenues);
    const evidenceCoverage = computeEvidenceCoverage(transactions, pendingInbox.length);

    const completedCount = saItems.filter((i) => i.completed).length;
    const saReadiness = {
      score: saItems.length > 0 ? Math.round((completedCount / saItems.length) * 100) : 0,
      completedCount,
      totalCount: saItems.length,
    };

    res.json({
      plBreakdown: pl,
      taxCalculation: tax,
      cashPosition: cash,
      arEntries,
      apEntries,
      kpis,
      saReadiness,
      pendingInboxCount: pendingInbox.length,
      monthlyTrend,
      vatWarning: vatWarning.warning ? vatWarning : null,
      evidenceCoverage,
      nonDeductibleTotal: pl.nonDeductibleExpenses,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to compute financial position" });
  }
});

// GET /profiles/:profileId/business-ideas — AI-generated ideas grounded in live financials
router.get("/profiles/:profileId/business-ideas", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const [transactions, inboxItems, decisions, saItems] = await Promise.all([
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id)),
      db.select().from(decisionMemoryTable).where(eq(decisionMemoryTable.profileId, profile.id)),
      db.select().from(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, profile.id)),
    ]);

    const pendingInbox = inboxItems.filter((i) => i.status === "pending");
    const pendingAmounts = pendingInbox.map((i) => i.amount ?? 0);
    const pl = computePLBreakdown(transactions, pendingAmounts);
    const taxReserve = profile.taxReserve ?? 3500;
    const tax = computeTaxForProfit(pl.profit, taxReserve);

    const cashAccounts = (profile.cashAccounts as AccountBalance[]) ?? [];
    const arEntries = (profile.arEntries as AREntry[]) ?? [];
    const apEntries = (profile.apEntries as APEntry[]) ?? [];

    const cash = computeCashPosition(cashAccounts, taxReserve, apEntries);
    const kpis = buildKPIs(pl, tax, cash, arEntries, pendingInbox.length);
    const monthlyTrend = computeMonthlyTrend(transactions);
    const vatWarning = computeVATWarning(pl.revenues);
    const evidenceCoverage = computeEvidenceCoverage(transactions, pendingInbox.length);
    const completedCount = saItems.filter((i) => i.completed).length;

    const position = {
      plBreakdown: pl, taxCalculation: tax, cashPosition: cash,
      arEntries, apEntries, kpis,
      saReadiness: {
        score: saItems.length > 0 ? Math.round((completedCount / saItems.length) * 100) : 0,
        completedCount, totalCount: saItems.length,
      },
      pendingInboxCount: pendingInbox.length,
      monthlyTrend,
      vatWarning: vatWarning.warning ? vatWarning : null,
      evidenceCoverage,
    };

    const committedIds = decisions.map((d) => d.ideaId);

    let ideas: unknown[] = [];
    if (isConfigured()) {
      try {
        const profileCtx = {
          name: profile.name,
          industry: (profile as Record<string, unknown>).industry as string ?? "other",
          businessType: profile.type ?? "sole_trader",
          taxYear: profile.taxYear ?? "2024/25",
        };
        const aiIdeas = await generateBusinessIdeasAI(position, profileCtx, committedIds);
        // Mark already-committed ideas
        ideas = aiIdeas.map((idea) => {
          const decision = decisions.find((d) => d.ideaId === idea.id);
          return { ...idea, status: decision ? "saved" : "new", committedDecisionId: decision?.id ?? null };
        });
      } catch (aiErr) {
        req.log.warn({ err: aiErr }, "AI ideas generation failed — returning empty");
        ideas = [];
      }
    }

    res.json(ideas);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load business ideas" });
  }
});

export default router;
