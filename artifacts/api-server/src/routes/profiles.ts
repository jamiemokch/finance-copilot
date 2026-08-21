import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// GET /profiles
router.get("/profiles", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profiles = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, req.user.id));
    res.json(profiles);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list profiles" });
  }
});

// POST /profiles
router.post("/profiles", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    name: z.string().min(1),
    type: z.string().default("sole_trader"),
    industry: z.string().default("other"),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [profile] = await db.insert(profilesTable).values({
      userId: req.user.id,
      name: body.data.name,
      type: body.data.type,
    }).returning();
    res.status(201).json(profile);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create profile" });
  }
});

// PATCH /profiles/:profileId — update editable financial inputs and profile context
router.patch("/profiles/:profileId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const CashAccountSchema = z.object({ name: z.string(), balance: z.number() });
  const AREntrySchema = z.object({
    name: z.string(), amount: z.number(),
    daysPastDue: z.number().default(0), invoiceCount: z.number().default(1),
  });
  const APEntrySchema = z.object({
    name: z.string(), amount: z.number(), daysUntilDue: z.number().default(30),
  });

  const body = z.object({
    name: z.string().min(1).optional(),
    industry: z.string().optional(),
    vatRegistered: z.boolean().optional(),
    taxReserve: z.number().min(0).optional(),
    cashAccounts: z.array(CashAccountSchema).optional(),
    arEntries: z.array(AREntrySchema).optional(),
    apEntries: z.array(APEntrySchema).optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: "Invalid input", details: body.error.issues }); return; }

  try {
    const [existing] = await db.select().from(profilesTable).where(
      and(eq(profilesTable.id, req.params.profileId), eq(profilesTable.userId, req.user.id))
    );
    if (!existing) { res.status(404).json({ error: "Profile not found" }); return; }

    const updates: Partial<typeof profilesTable.$inferInsert> = {};
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.taxReserve !== undefined) updates.taxReserve = body.data.taxReserve;
    if (body.data.cashAccounts !== undefined) updates.cashAccounts = body.data.cashAccounts;
    if (body.data.arEntries !== undefined) updates.arEntries = body.data.arEntries;
    if (body.data.apEntries !== undefined) updates.apEntries = body.data.apEntries;

    // Handle new columns via type cast (schema fields added via migration)
    const extUpdates = updates as Record<string, unknown>;
    if (body.data.industry !== undefined) extUpdates.industry = body.data.industry;
    if (body.data.vatRegistered !== undefined) extUpdates.vatRegistered = body.data.vatRegistered;

    const [updated] = await db.update(profilesTable)
      .set(extUpdates as typeof profilesTable.$inferInsert)
      .where(and(eq(profilesTable.id, req.params.profileId), eq(profilesTable.userId, req.user.id)))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export async function requireProfile(profileId: string, userId: string) {
  const [profile] = await db.select().from(profilesTable).where(
    and(eq(profilesTable.id, profileId), eq(profilesTable.userId, userId))
  );
  return profile ?? null;
}

export default router;
