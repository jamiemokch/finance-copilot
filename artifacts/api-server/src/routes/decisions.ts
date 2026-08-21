import { Router } from "express";
import { db } from "@workspace/db";
import { decisionMemoryTable, saChecklistItemsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";

const router = Router();

const assumptionFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
});

// GET /profiles/:profileId/decisions
router.get("/profiles/:profileId/decisions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const decisions = await db.select().from(decisionMemoryTable)
      .where(eq(decisionMemoryTable.profileId, profile.id));
    res.json(decisions);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list decisions" });
  }
});

// POST /profiles/:profileId/decisions — save a committed decision
router.post("/profiles/:profileId/decisions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    ideaId: z.string(),
    ideaTitle: z.string(),
    ideaCategory: z.string(),
    userDecision: z.string(),
    userRationale: z.string().default(""),
    assumptionsSnapshot: z.array(assumptionFieldSchema).default([]),
    expectedPLImpact: z.number(),
    expectedCashImpact: z.number(),
    expectedTaxImpact: z.number(),
    status: z.string().default("committed"),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [decision] = await db.insert(decisionMemoryTable).values({
      profileId: profile.id,
      date: new Date().toISOString().split("T")[0],
      ...body.data,
      assumptionsSnapshot: JSON.stringify(body.data.assumptionsSnapshot),
    }).returning();
    res.status(201).json(decision);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save decision" });
  }
});

// PATCH /profiles/:profileId/decisions/:decisionId — update status/outcome
router.patch("/profiles/:profileId/decisions/:decisionId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    status: z.string().optional(),
    actualOutcome: z.string().optional(),
    actualPLImpact: z.number().optional(),
    actualCashImpact: z.number().optional(),
    actualTaxImpact: z.number().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [updated] = await db.update(decisionMemoryTable)
      .set(body.data)
      .where(
        and(
          eq(decisionMemoryTable.id, req.params.decisionId),
          eq(decisionMemoryTable.profileId, profile.id),
        )
      )
      .returning();
    if (!updated) { res.status(404).json({ error: "Decision not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update decision" });
  }
});

// GET /profiles/:profileId/sa-checklist
router.get("/profiles/:profileId/sa-checklist", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const items = await db.select().from(saChecklistItemsTable)
      .where(eq(saChecklistItemsTable.profileId, profile.id));
    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list SA checklist" });
  }
});

// PATCH /profiles/:profileId/sa-checklist/:itemId
router.patch("/profiles/:profileId/sa-checklist/:itemId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ completed: z.boolean() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "completed (boolean) is required" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [updated] = await db.update(saChecklistItemsTable)
      .set({
        completed: body.data.completed,
        completedAt: body.data.completed ? new Date() : null,
      })
      .where(
        and(
          eq(saChecklistItemsTable.id, req.params.itemId),
          eq(saChecklistItemsTable.profileId, profile.id),
        )
      )
      .returning();
    if (!updated) { res.status(404).json({ error: "Checklist item not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update checklist item" });
  }
});

export default router;
