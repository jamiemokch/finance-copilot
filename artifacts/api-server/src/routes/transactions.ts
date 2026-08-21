import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [txn] = await db.insert(transactionsTable).values({
      profileId: profile.id,
      ...body.data,
      source: "manual",
      evidenceTier: 4,
    }).returning();
    res.status(201).json(txn);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

export default router;
