import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, inboxItemsTable, saChecklistItemsTable, profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { getCopilotReply, isConfigured } from "../lib/ai.js";
import {
  computePLBreakdown,
  computeTaxForProfit,
  computeCashPosition,
  buildKPIs,
  type AccountBalance,
  type AREntry,
  type APEntry,
} from "../lib/finance.js";

const router = Router();

// POST /copilot/message — send message with live financial context
router.post("/copilot/message", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    profileId: z.string().min(1),
    message: z.string().min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "profileId and message are required" }); return; }

  if (!isConfigured()) {
    res.json({
      reply: "The AI Copilot is not yet configured. Please add an OpenAI API key in Replit Secrets (OPENAI_API_KEY) to enable real responses.",
      contextSummary: "",
    });
    return;
  }

  try {
    const profile = await requireProfile(body.data.profileId, req.user.id);
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
    const completedCount = saItems.filter((i) => i.completed).length;
    const totalCount = saItems.length;

    const position = {
      plBreakdown: pl,
      taxCalculation: tax,
      cashPosition: cash,
      arEntries,
      apEntries,
      kpis,
      saReadiness: {
        score: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
        completedCount,
        totalCount,
      },
      pendingInboxCount: pendingInbox.length,
    };

    const { reply, contextSummary } = await getCopilotReply(
      body.data.message,
      position,
      profile.name,
    );

    res.json({ reply, contextSummary });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Copilot request failed" });
  }
});

export default router;
