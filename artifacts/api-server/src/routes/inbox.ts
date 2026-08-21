import { Router } from "express";
import { db } from "@workspace/db";
import {
  inboxItemsTable, transactionsTable, saChecklistItemsTable,
  evidenceItemsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { computePLBreakdown, computeTaxImpactDiff } from "../lib/finance.js";

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
router.patch("/profiles/:profileId/inbox/:itemId/resolve", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ resolution: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "resolution is required" }); return; }

  let claimedInboxItemId: string | null = null;
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const [existingItem] = await db.select().from(inboxItemsTable).where(
      and(eq(inboxItemsTable.id, req.params.itemId), eq(inboxItemsTable.profileId, profile.id))
    );
    if (!existingItem) { res.status(404).json({ error: "Inbox item not found" }); return; }

    // A client can retry after a response is lost. Returning the already
    // persisted resolution keeps that retry idempotent instead of adding a
    // second transaction.
    if (existingItem.status === "resolved") {
      res.json(existingItem);
      return;
    }

    // Claim the item before any ledger write. This makes "resolve all" safe
    // even when a user double-clicks or another request retries concurrently.
    const [item] = await db.update(inboxItemsTable)
      .set({ status: "resolving" })
      .where(and(
        eq(inboxItemsTable.id, existingItem.id),
        eq(inboxItemsTable.profileId, profile.id),
        eq(inboxItemsTable.status, "pending"),
      ))
      .returning();
    if (!item) {
      const [latestItem] = await db.select().from(inboxItemsTable).where(
        and(eq(inboxItemsTable.id, existingItem.id), eq(inboxItemsTable.profileId, profile.id))
      );
      if (latestItem?.status === "resolved") {
        res.json(latestItem);
        return;
      }
      res.status(409).json({ error: "This Inbox item is already being resolved" });
      return;
    }
    claimedInboxItemId = item.id;

    const { resolution } = body.data;
    const classification = classifyResolution(resolution);
    const pct = extractPercentage(resolution); // 0–100
    const evidenceTier = await tierForInboxEvidence(item.evidenceId);

    // The financial write and terminal Inbox status commit together. If either
    // fails, this transaction rolls back before the outer retry handler resets
    // the temporary claim.
    const resolutionResult = await db.transaction(async (tx) => {
    // Fetch current transactions to compute tax impact diff accurately
    const existingTxns = await tx.select().from(transactionsTable)
      .where(and(
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.ledgerStatus, "active"),
      ));
    const existingPendingAmounts = await tx.select().from(inboxItemsTable)
      .where(and(eq(inboxItemsTable.profileId, profile.id), eq(inboxItemsTable.status, "pending")));
    const pendingAmounts = existingPendingAmounts
      .filter((i) => i.id !== item.id)
      .map((i) => i.amount ?? 0);

    const plBefore = computePLBreakdown(existingTxns, pendingAmounts);

    let taxImpact = 0;

    if (classification === "income" && item.amount) {
      const signedAmount = item.sourceRowIndex != null ? item.amount : Math.abs(item.amount);
      // Income confirmed → positive transaction
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: item.date,
        description: item.description,
        amount: signedAmount,
        recordType: "income",
        category: "income",
        taxTreatment: "income",
        source: "manual",
        evidenceId: item.evidenceId ?? null,
        evidenceTier,
        sourceRowIndex: item.sourceRowIndex ?? null,
        rawRowData: item.rawRowData ?? null,
        accountingCategory: "income",
        allowablePercentage: 100,
        allowableAmount: signedAmount,
        userOverride: true,
      });
      const plAfter = computePLBreakdown([
        ...existingTxns,
        { amount: signedAmount, category: "income", taxTreatment: "income" },
      ], pendingAmounts);
      // Income increases tax due (negative saving)
      taxImpact = computeTaxImpactDiff(plBefore.profit, plAfter.profit) * -1;

    } else if (classification === "deductible" && item.amount) {
      const signedAmount = item.sourceRowIndex != null ? item.amount : -Math.abs(item.amount);
      // Deductible expense → negative transaction with allowable amount
      const allowableAmount = signedAmount * (pct / 100);
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: item.date,
        description: item.description,
        amount: signedAmount,
        recordType: "expense",
        category: "expense",
        taxTreatment: "deductible",
        source: "manual",
        evidenceId: item.evidenceId ?? null,
        evidenceTier,
        sourceRowIndex: item.sourceRowIndex ?? null,
        rawRowData: item.rawRowData ?? null,
        accountingCategory: guessAccountingCategory(item.description),
        allowablePercentage: pct,
        allowableAmount,
        userOverride: true,
      });
      // Tax saving = reduction in tax when profit decreases by allowableAmount
      const syntheticTx = {
        amount: signedAmount, category: "expense", taxTreatment: "deductible" as const,
        allowableAmount, allowablePercentage: pct,
      };
      const plAfter = computePLBreakdown([...existingTxns, syntheticTx], pendingAmounts);
      taxImpact = computeTaxImpactDiff(plBefore.profit, plAfter.profit);

    } else if (classification === "non_deductible" && item.amount) {
      const signedAmount = item.sourceRowIndex != null ? item.amount : -Math.abs(item.amount);
      // Non-deductible → record in ledger for transparency; zero tax impact
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: item.date,
        description: item.description,
        amount: signedAmount,
        recordType: "expense",
        category: "expense",
        taxTreatment: "non_deductible",
        source: "manual",
        evidenceId: item.evidenceId ?? null,
        evidenceTier,
        sourceRowIndex: item.sourceRowIndex ?? null,
        rawRowData: item.rawRowData ?? null,
        accountingCategory: guessAccountingCategory(item.description),
        allowablePercentage: 0,
        allowableAmount: 0,
        userOverride: true,
      });
      taxImpact = 0;
    }

    const [updated] = await tx.update(inboxItemsTable).set({
      status: "resolved",
      resolution,
      taxImpact,
      resolvedAt: new Date(),
    }).where(and(
      eq(inboxItemsTable.id, item.id),
      eq(inboxItemsTable.status, "resolving"),
    )).returning();
    if (!updated) {
      throw new Error("Failed to finalize Inbox resolution");
    }
    return updated;
    });

    // Checklist progress is non-financial and must never turn a committed
    // resolution into a failed client response.
    if (classification !== null) {
      await markInboxChecklistProgress(profile.id);
    }
    res.json(resolutionResult);
  } catch (err) {
    if (claimedInboxItemId) {
      await db.update(inboxItemsTable)
        .set({ status: "pending" })
        .where(and(
          eq(inboxItemsTable.id, claimedInboxItemId),
          eq(inboxItemsTable.status, "resolving"),
        ))
        .catch(() => undefined);
    }
    req.log.error(err);
    res.status(500).json({ error: "Failed to resolve inbox item" });
  }
});

type ResolutionClass = "income" | "deductible" | "non_deductible" | null;

function classifyResolution(resolution: string): ResolutionClass {
  const lower = resolution.toLowerCase();
  if (lower.includes("income") || lower.includes("received")) return "income";
  if (lower.includes("personal") || lower.includes("not deductible") || lower.includes("not business")) {
    return "non_deductible";
  }
  if (lower.includes("deductible") || lower.includes("business") || lower.includes("confirm")) {
    return "deductible";
  }
  return null;
}

function extractPercentage(resolution: string): number {
  const match = resolution.match(/(\d+)%/);
  if (match) return Math.min(100, Math.max(0, parseInt(match[1], 10)));
  return 100;
}

function guessAccountingCategory(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("travel") || lower.includes("train") || lower.includes("taxi") || lower.includes("flight")) return "travel";
  if (lower.includes("meal") || lower.includes("lunch") || lower.includes("dinner") || lower.includes("restaurant")) return "meals";
  if (lower.includes("software") || lower.includes("subscription") || lower.includes("saas")) return "subscriptions";
  if (lower.includes("accountant") || lower.includes("solicitor") || lower.includes("legal") || lower.includes("consultant")) return "professional_fees";
  if (lower.includes("phone") || lower.includes("mobile")) return "utilities";
  if (lower.includes("office") || lower.includes("desk") || lower.includes("wework")) return "office_costs";
  if (lower.includes("training") || lower.includes("course") || lower.includes("conference")) return "training";
  if (lower.includes("insurance")) return "insurance";
  if (lower.includes("equipment") || lower.includes("laptop") || lower.includes("camera") || lower.includes("computer")) return "equipment";
  return "other";
}

async function tierForInboxEvidence(evidenceId: string | null): Promise<number> {
  if (!evidenceId) return 4;
  const [evidence] = await db.select({ evidenceType: evidenceItemsTable.evidenceType })
    .from(evidenceItemsTable).where(eq(evidenceItemsTable.id, evidenceId));
  return evidence?.evidenceType === "document" ? 1
    : evidence?.evidenceType === "bank_csv" ? 2
    : evidence?.evidenceType === "ledger" ? 3
    : 4;
}

async function markInboxChecklistProgress(profileId: string) {
  try {
    const remaining = await db.select().from(inboxItemsTable).where(
      and(eq(inboxItemsTable.profileId, profileId), eq(inboxItemsTable.status, "pending"))
    );
    if (remaining.length === 0) {
      await db.update(saChecklistItemsTable).set({
        completed: true, completedAt: new Date(),
      }).where(and(
        eq(saChecklistItemsTable.profileId, profileId),
        eq(saChecklistItemsTable.checkId, "inbox_cleared"),
      ));
    }
  } catch { /* non-fatal */ }
}

export default router;
