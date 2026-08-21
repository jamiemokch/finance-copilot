import { Router } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, transactionsTable, saChecklistItemsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";

const router = Router();

// GET /profiles/:profileId/inbox
router.get("/profiles/:profileId/inbox", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const items = await db.select().from(inboxItemsTable)
      .where(eq(inboxItemsTable.profileId, profile.id));
    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list inbox items" });
  }
});

// PATCH /profiles/:profileId/inbox/:itemId/resolve
// Resolves an inbox item — creates a transaction if deductible, cascades to position
router.patch("/profiles/:profileId/inbox/:itemId/resolve", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ resolution: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "resolution is required" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const [item] = await db.select().from(inboxItemsTable).where(
      and(eq(inboxItemsTable.id, req.params.itemId), eq(inboxItemsTable.profileId, profile.id))
    );
    if (!item) { res.status(404).json({ error: "Inbox item not found" }); return; }
    if (item.status === "resolved") {
      res.status(400).json({ error: "Item already resolved" }); return;
    }

    const { resolution } = body.data;
    const treatment = classifyResolution(resolution);

    // Create a transaction if this is a deductible expense
    if (treatment === "deductible" && item.amount) {
      const pct = extractPercentage(resolution);
      const deductibleAmount = item.amount * (pct / 100);
      await db.insert(transactionsTable).values({
        profileId: profile.id,
        date: item.date,
        description: item.description,
        amount: -deductibleAmount,
        category: "expense",
        taxTreatment: "deductible",
        source: "manual",
        evidenceId: item.evidenceId ?? null,
      });
      // Update inbox checklist item if present
      await updateInboxChecklistItem(profile.id, true);
    } else if (treatment === "non_deductible") {
      // Still update checklist — item reviewed
      await updateInboxChecklistItem(profile.id, false);
    }

    const taxImpact = treatment === "deductible" && item.amount
      ? Math.round(item.amount * 0.29) // approx income tax + NI saving
      : 0;

    const [updated] = await db.update(inboxItemsTable).set({
      status: "resolved",
      resolution,
      taxImpact,
      resolvedAt: new Date(),
    }).where(eq(inboxItemsTable.id, item.id)).returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to resolve inbox item" });
  }
});

/**
 * Classify the resolution text to determine tax treatment.
 * Simple heuristic: personal/not business → non_deductible, else deductible.
 */
function classifyResolution(resolution: string): "deductible" | "non_deductible" {
  const lower = resolution.toLowerCase();
  const personalTerms = ["personal", "not business", "not deductible", "entertainment", "social"];
  if (personalTerms.some((t) => lower.includes(t))) return "non_deductible";
  return "deductible";
}

/** Extract business use percentage from resolution text (e.g. "50% business" → 50) */
function extractPercentage(resolution: string): number {
  const match = resolution.match(/(\d+)%/);
  if (match) return Math.min(100, Math.max(0, parseInt(match[1], 10)));
  return 100; // default: fully deductible
}

/** Mark the SA checklist inbox item as done when all inbox items are resolved */
async function updateInboxChecklistItem(profileId: string, resolved: boolean) {
  if (!resolved) return;
  try {
    await db.update(saChecklistItemsTable).set({
      completed: true,
      completedAt: new Date(),
    }).where(
      and(
        eq(saChecklistItemsTable.profileId, profileId),
        eq(saChecklistItemsTable.checkId, "inbox_cleared"),
      )
    );
  } catch {
    // Non-fatal — SA checklist update failure shouldn't block resolution
  }
}

export default router;
