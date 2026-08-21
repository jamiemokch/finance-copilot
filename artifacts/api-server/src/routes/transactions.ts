import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";

const router = Router();
const recordInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recordType: z.enum(["income", "expense"]),
  description: z.string().trim().min(1).max(240),
  amount: z.number().finite().positive(),
  category: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional().nullable(),
});

function currentTaxYearBounds() {
  const now = new Date();
  const startYear = now.getUTCMonth() > 3 || (now.getUTCMonth() === 3 && now.getUTCDate() >= 6)
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

function isCurrentTaxYear(date: string) {
  if (!isValidIsoDate(date)) return false;
  const bounds = currentTaxYearBounds();
  return date >= bounds.start && date <= bounds.end;
}

function isValidIsoDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function toTransactionValues(input: z.infer<typeof recordInput>, profileId: string) {
  const signedAmount = input.recordType === "income" ? input.amount : -input.amount;
  return {
    profileId,
    date: input.date,
    description: input.description,
    amount: signedAmount,
    recordType: input.recordType,
    category: input.category,
    note: input.note || null,
    taxTreatment: input.recordType === "income" ? "income" : "deductible",
    accountingCategory: input.category,
    source: "manual" as const,
    evidenceTier: 4,
  };
}

async function ownedProfile(req: any) {
  return requireProfile(req.params.profileId, req.user.id);
}

router.get("/profiles/:profileId/transactions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await ownedProfile(req);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const txns = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.profileId, profile.id))
      .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt));
    res.json(txns);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.post("/profiles/:profileId/transactions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = recordInput.safeParse(req.body);
  if (!body.success || !isCurrentTaxYear(body.data.date)) {
    res.status(400).json({ error: "Records must use a valid date in the current UK tax year." }); return;
  }
  try {
    const profile = await ownedProfile(req);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [txn] = await db.insert(transactionsTable).values(toTransactionValues(body.data, profile.id)).returning();
    res.status(201).json(txn);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

router.patch("/profiles/:profileId/transactions/:transactionId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = recordInput.safeParse(req.body);
  if (!body.success || !isCurrentTaxYear(body.data.date)) {
    res.status(400).json({ error: "Records must use a valid date in the current UK tax year." }); return;
  }
  try {
    const profile = await ownedProfile(req);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [txn] = await db.update(transactionsTable)
      .set(toTransactionValues(body.data, profile.id))
      .where(and(
        eq(transactionsTable.id, req.params.transactionId),
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.source, "manual"),
      ))
      .returning();
    if (!txn) { res.status(404).json({ error: "Record not found" }); return; }
    res.json(txn);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

router.delete("/profiles/:profileId/transactions/:transactionId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await ownedProfile(req);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [deleted] = await db.delete(transactionsTable)
      .where(and(
        eq(transactionsTable.id, req.params.transactionId),
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.source, "manual"),
      ))
      .returning({ id: transactionsTable.id });
    if (!deleted) { res.status(404).json({ error: "Record not found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

export default router;