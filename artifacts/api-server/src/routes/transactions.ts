import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { scanProfile } from "./reconciliation.js";

const router = Router();

// GET /profiles/:profileId/transactions
router.get("/profiles/:profileId/transactions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const txns = await db.select().from(transactionsTable)
      .where(and(
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.ledgerStatus, "active"),
      ));
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
    allowablePercentage: z.number().min(0).max(100).default(100),
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
    const isIncome = body.data.amount > 0;
    const allowablePercentage = isIncome ? 100 : body.data.allowablePercentage;
    const allowableAmount = isIncome
      ? body.data.amount
      : body.data.taxTreatment === "non_deductible"
        ? 0
        : -Math.abs(body.data.amount) * (allowablePercentage / 100);
    const [txn] = await db.insert(transactionsTable).values({
      profileId: profile.id,
      id: body.data.idempotencyKey,
      date: body.data.date,
      description: body.data.description,
      amount: body.data.amount,
      recordType: isIncome ? "income" : "expense",
      category: body.data.category,
      taxTreatment: body.data.taxTreatment,
      source: "manual",
      evidenceTier: 4,
      accountingCategory: body.data.category,
      allowablePercentage,
      allowableAmount,
    }).returning();
    res.status(201).json(txn);
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-transaction reconciliation scan failed"));
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

// GET /profiles/:profileId/transactions/:txId — read one Financial Memory record
router.get("/profiles/:profileId/transactions/:txId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [transaction] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, req.params.txId),
      eq(transactionsTable.profileId, profile.id),
    ));
    if (!transaction) { res.status(404).json({ error: "Transaction not found" }); return; }
    res.json(transaction);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load transaction" });
  }
});

// PATCH /profiles/:profileId/transactions/:txId — edit manual or explicitly classify imported record
router.patch("/profiles/:profileId/transactions/:txId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    date: z.string().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    amount: z.number().refine((value) => value !== 0, "Amount must be non-zero").optional(),
    category: z.string().trim().min(1).optional(),
    taxTreatment: z.string().optional(),
    allowablePercentage: z.number().min(0).max(100).optional(),
    accountingClassification: z.enum([
      "income", "expense", "transfer", "owner_funds", "drawings", "loan", "tax_payment", "unknown",
    ]).optional(),
  }).safeParse(req.body);
  if (!body.success || Object.keys(body.data).length === 0) { res.status(400).json({ error: "Invalid transaction update" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [existing] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, req.params.txId),
      eq(transactionsTable.profileId, profile.id),
    ));
    if (!existing) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (existing.ledgerStatus !== "active") { res.status(422).json({ error: "Voided records cannot be edited" }); return; }
    if (existing.source !== "manual" && existing.source !== "bank_csv") {
      res.status(422).json({ error: "Only manual or bank-imported records can be edited here" });
      return;
    }
    const amount = body.data.amount ?? existing.amount;
    const updates: Record<string, unknown> = {
      ...body.data,
    };
    if (existing.source === "manual") {
      updates.recordType = amount > 0 ? "income" : "expense";
      const isIncome = amount > 0;
      const taxTreatment = body.data.taxTreatment ?? existing.taxTreatment;
      const allowablePercentage = isIncome ? 100 : body.data.allowablePercentage ?? existing.allowablePercentage;
      updates.allowablePercentage = allowablePercentage;
      updates.allowableAmount = isIncome
        ? amount
        : taxTreatment === "non_deductible"
          ? 0
          : -Math.abs(amount) * (allowablePercentage / 100);
      if (body.data.category !== undefined) updates.accountingCategory = body.data.category;
    }
    if (existing.source === "manual" && body.data.amount !== undefined && body.data.taxTreatment === undefined) {
      updates.taxTreatment = amount > 0 ? "income" : "deductible";
    }
    if (existing.source === "bank_csv") {
      updates.userOverride = true;
      const classification = body.data.accountingClassification ?? existing.accountingClassification ?? "unknown";
      updates.accountingClassification = classification;
      if (classification === "income") {
        updates.recordType = "income";
        updates.category = body.data.category ?? "income";
        updates.taxTreatment = body.data.taxTreatment ?? "income";
      } else if (classification === "expense") {
        updates.recordType = "expense";
        updates.category = body.data.category ?? "expense";
        updates.taxTreatment = body.data.taxTreatment ?? "deductible";
      } else {
        updates.recordType = "unknown";
        updates.category = body.data.category ?? classification;
        updates.taxTreatment = "unreviewed";
      }
    }
    const [updated] = await db.update(transactionsTable).set(updates)
      .where(and(eq(transactionsTable.id, existing.id), eq(transactionsTable.profileId, profile.id)))
      .returning();
    res.json(updated);
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-transaction reconciliation scan failed"));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

// DELETE /profiles/:profileId/transactions/:txId — delete manual or audit-void an imported record
router.delete("/profiles/:profileId/transactions/:txId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [existing] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, req.params.txId),
      eq(transactionsTable.profileId, profile.id),
    ));
    if (!existing) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (existing.source === "manual") {
      await db.delete(transactionsTable).where(and(
        eq(transactionsTable.id, existing.id),
        eq(transactionsTable.profileId, profile.id),
      ));
    } else if (existing.source === "bank_csv") {
      await db.update(transactionsTable).set({
        ledgerStatus: "voided",
        voidedAt: new Date(),
        voidReason: "Removed from active Financial Memory by the user",
      }).where(and(
        eq(transactionsTable.id, existing.id),
        eq(transactionsTable.profileId, profile.id),
      ));
    } else {
      res.status(422).json({ error: "Only manually added or bank-imported records can be removed here" });
      return;
    }
    res.status(204).end();
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-transaction reconciliation scan failed"));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

export default router;
