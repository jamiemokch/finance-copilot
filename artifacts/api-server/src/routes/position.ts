import { Router } from "express";
import { db } from "@workspace/db";
import {
  transactionsTable,
  inboxItemsTable,
  saChecklistItemsTable,
  decisionMemoryTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  computePLBreakdown,
  computeTaxForProfit,
  computeCashPosition,
  buildKPIs,
  type AccountBalance,
  type AREntry,
  type APEntry,
} from "../lib/finance.js";
import { requireProfile } from "./profiles.js";
import { generateBusinessIdeas } from "./business-ideas.js";

const router = Router();

// GET /profiles/:profileId/position — compute full financial position from DB data
router.get("/profiles/:profileId/position", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Fetch all data in parallel
    const [transactions, inboxItems, saItems] = await Promise.all([
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id)),
      db.select().from(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, profile.id)),
    ]);

    const pendingInbox = inboxItems.filter((i) => i.status === "pending");
    const pendingAmounts = pendingInbox.map((i) => i.amount ?? 0);

    // Deterministic UK sole trader calculations — no AI
    const pl = computePLBreakdown(transactions, pendingAmounts);
    const taxReserve = profile.taxReserve ?? 3500;
    const tax = computeTaxForProfit(pl.profit, taxReserve);

    const cashAccounts = (profile.cashAccounts as AccountBalance[]) ?? [];
    const arEntries = (profile.arEntries as AREntry[]) ?? [];
    const apEntries = (profile.apEntries as APEntry[]) ?? [];

    const cash = computeCashPosition(cashAccounts, taxReserve, apEntries);
    const kpis = buildKPIs(pl, tax, cash, arEntries, pendingInbox.length);

    const completedCount = saItems.filter((i) => i.completed).length;
    const totalCount = saItems.length;
    const saReadiness = {
      score: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      completedCount,
      totalCount,
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
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to compute financial position" });
  }
});

// GET /profiles/:profileId/business-ideas — ideas with live baselines from current position
router.get("/profiles/:profileId/business-ideas", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const [transactions, inboxItems, decisions] = await Promise.all([
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id)),
      db.select().from(decisionMemoryTable).where(eq(decisionMemoryTable.profileId, profile.id)),
    ]);

    const pendingAmounts = inboxItems
      .filter((i) => i.status === "pending")
      .map((i) => i.amount ?? 0);
    const pl = computePLBreakdown(transactions, pendingAmounts);

    // Generate ideas with live baselines, then mark committed ones
    const ideas = generateBusinessIdeas(pl, profile.taxReserve ?? 3500);
    const committedIds = new Set(decisions.map((d) => d.ideaId));
    const ideasWithStatus = ideas.map((idea) => {
      const decision = decisions.find((d) => d.ideaId === idea.id);
      return {
        ...idea,
        status: decision ? "saved" : "new",
        committedDecisionId: decision?.id ?? null,
      };
    });

    res.json(ideasWithStatus);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load business ideas" });
  }
});

export default router;
