/**
 * Demo reset route — wipes all user data and re-seeds the canonical sample journey.
 * Safely idempotent: calling it multiple times always returns the same seeded state.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  profilesTable,
  transactionsTable,
  inboxItemsTable,
  saChecklistItemsTable,
  evidenceItemsTable,
  decisionMemoryTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  DEMO_PROFILE_DEFAULTS,
  getDemoTransactions,
  getDemoInboxItems,
  getDemoSAChecklist,
} from "../lib/demo.js";

const router = Router();

// POST /demo/reset — clear all user data and re-seed demo
router.post("/demo/reset", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const userId = req.user.id;

    // Get all existing profiles for this user
    const existingProfiles = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, userId));

    // Delete all data for each profile (cascade handles most, but explicit for clarity)
    for (const profile of existingProfiles) {
      await Promise.all([
        db.delete(transactionsTable).where(eq(transactionsTable.profileId, profile.id)),
        db.delete(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id)),
        db.delete(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, profile.id)),
        db.delete(evidenceItemsTable).where(eq(evidenceItemsTable.profileId, profile.id)),
        db.delete(decisionMemoryTable).where(eq(decisionMemoryTable.profileId, profile.id)),
      ]);
    }
    // Delete all profiles
    await db.delete(profilesTable).where(eq(profilesTable.userId, userId));

    // Create fresh demo profile
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name: "Alex — Design & Consulting",
      type: DEMO_PROFILE_DEFAULTS.type,
      taxYear: "2024/25",
      taxReserve: DEMO_PROFILE_DEFAULTS.taxReserve,
      cashAccounts: DEMO_PROFILE_DEFAULTS.cashAccounts,
      arEntries: DEMO_PROFILE_DEFAULTS.arEntries,
      apEntries: DEMO_PROFILE_DEFAULTS.apEntries,
    }).returning();

    // Seed all demo data
    const [transactions, inboxItems, checklist] = await Promise.all([
      db.insert(transactionsTable).values(getDemoTransactions(profile.id)).returning(),
      db.insert(inboxItemsTable).values(getDemoInboxItems(profile.id)).returning(),
      db.insert(saChecklistItemsTable).values(getDemoSAChecklist(profile.id)).returning(),
    ]);

    req.log.info({ profileId: profile.id, userId }, "Demo data reset");
    res.json({
      success: true,
      profileId: profile.id,
      message: `Demo reset complete — ${transactions.length} transactions, ${inboxItems.length} inbox items, ${checklist.length} checklist items seeded.`,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to reset demo data" });
  }
});

// POST /demo/seed — create demo profile if user has none (auto-called on first login)
router.post("/demo/seed", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const userId = req.user.id;
    const existing = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, userId));

    if (existing.length > 0) {
      res.json({ success: true, profileId: existing[0].id, message: "Profile already exists" });
      return;
    }

    // First login — create demo profile
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name: "Alex — Design & Consulting",
      type: DEMO_PROFILE_DEFAULTS.type,
      taxYear: "2024/25",
      taxReserve: DEMO_PROFILE_DEFAULTS.taxReserve,
      cashAccounts: DEMO_PROFILE_DEFAULTS.cashAccounts,
      arEntries: DEMO_PROFILE_DEFAULTS.arEntries,
      apEntries: DEMO_PROFILE_DEFAULTS.apEntries,
    }).returning();

    await Promise.all([
      db.insert(transactionsTable).values(getDemoTransactions(profile.id)),
      db.insert(inboxItemsTable).values(getDemoInboxItems(profile.id)),
      db.insert(saChecklistItemsTable).values(getDemoSAChecklist(profile.id)),
    ]);

    res.json({ success: true, profileId: profile.id, message: "Demo profile created" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to seed demo" });
  }
});

// POST /demo/seed-transactions/:profileId — seed demo transactions into an existing profile
router.post("/demo/seed-transactions/:profileId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const userId = req.user.id;
    const profileId = req.params.profileId;

    // Verify the profile belongs to this user
    const [profile] = await db.select().from(profilesTable).where(
      and(eq(profilesTable.id, profileId), eq(profilesTable.userId, userId))
    );
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    // Seed transactions, inbox items, and SA checklist into the existing profile
    const [transactions, inboxItems, checklist] = await Promise.all([
      db.insert(transactionsTable).values(getDemoTransactions(profileId)).returning(),
      db.insert(inboxItemsTable).values(getDemoInboxItems(profileId)).returning(),
      db.insert(saChecklistItemsTable).values(getDemoSAChecklist(profileId)).returning(),
    ]);

    req.log.info({ profileId, userId }, "Demo transactions seeded to existing profile");
    res.json({
      success: true,
      message: `Loaded ${transactions.length} transactions, ${inboxItems.length} inbox items, ${checklist.length} checklist items.`,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to seed transactions" });
  }
});

export default router;
