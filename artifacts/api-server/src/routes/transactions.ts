import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";

const router = Router();

// GET /profiles/:profileId/transactions
router.get("/profiles/:profileId/transactions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const txns = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.profileId, profile.id));
    res.json(txns);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

// POST /profiles/:profileId/transactions — manual entry
router.post("/profiles/:profileId/transactions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.number(),
    category: z.string().default("expense"),
    taxTreatment: z.string().default("deductible"),
    idempotencyKey: z.string().uuid(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [existing] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, body.data.idempotencyKey),
      eq(transactionsTable.profileId, profile.id),
    ));
    if (existing) { res.json(existing); return; }
    const [txn] = await db.insert(transactionsTable).values({
      profileId: profile.id,
      id: body.data.idempotencyKey,
      date: body.data.date,
      description: body.data.description,
      amount: body.data.amount,
      recordType: body.data.amount > 0 ? "income" : "expense",
      category: body.data.category,
      taxTreatment: body.data.taxTreatment,
      source: "manual",
      evidenceTier: 4,
    }).returning();
    res.status(201).json(txn);
  } catch (err) {
    // Two identical requests can both miss the initial lookup. The primary-key
    // conflict is the durable idempotency guard, so return the winning record
    // rather than exposing that expected race as a failed save.
    const dbError = err as { cause?: { code?: string } };
    if (dbError.cause?.code === "23505") {
      const [existing] = await db.select().from(transactionsTable).where(and(
        eq(transactionsTable.id, body.data.idempotencyKey),
        eq(transactionsTable.profileId, req.params.profileId),
      ));
      if (existing) { res.json(existing); return; }
    }
    req.log.error(err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

export default router;
