import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getOrMigrateSa100Context, updateSa100Context } from "../lib/self-assessment-context.js";

const router = Router();

async function profileWithAnnualTaxContext(profile: typeof profilesTable.$inferSelect) {
  const context = await getOrMigrateSa100Context(profile.userId, profile.taxYear);
  return {
    ...profile,
    otherTaxableIncome: context?.otherTaxableIncome ?? null,
    otherTaxableIncomeTaxYear: context?.otherTaxableIncome == null ? null : profile.taxYear,
  };
}

// GET /profiles
router.get("/profiles", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profiles = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, req.user.id));
    res.json(await Promise.all(profiles.map(profileWithAnnualTaxContext)));
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
    industry: z.string().optional().default("other"),
    vatRegistered: z.boolean().optional().default(false),
    taxYear: z.string().optional().default("2024/25"),
    accountingBasis: z.string().optional().default("cash"),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const insertData: Record<string, unknown> = {
      userId: req.user.id,
      name: body.data.name,
      type: body.data.type,
      industry: body.data.industry,
      vatRegistered: body.data.vatRegistered,
      taxYear: body.data.taxYear,
    };
    // accountingBasis handled via cast — column added in migration
    if (body.data.accountingBasis) {
      insertData.accountingBasis = body.data.accountingBasis;
    }
    const [profile] = await db.insert(profilesTable)
      .values(insertData as typeof profilesTable.$inferInsert)
      .returning();
    res.status(201).json(await profileWithAnnualTaxContext(profile));
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
  const ISODateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
    }, "Use a real calendar date");

  const body = z.object({
    name: z.string().min(1).optional(),
    industry: z.string().optional(),
    vatRegistered: z.boolean().optional(),
    taxYear: z.string().optional(),
    accountingBasis: z.string().optional(),
    taxReserve: z.number().min(0).optional(),
    cashAccounts: z.array(CashAccountSchema).optional(),
    arEntries: z.array(AREntrySchema).optional(),
    apEntries: z.array(APEntrySchema).optional(),
    openingPositionStatus: z.enum(["not_started", "skipped", "complete"]).optional(),
    openingBalance: z.number().finite().optional().nullable(),
    openingDetails: z.string().trim().max(2000).optional().nullable(),
    coverageStartDate: ISODateSchema.optional().nullable(),
    coverageEndDate: ISODateSchema.optional().nullable(),
    businessStartDate: ISODateSchema.optional().nullable(),
    otherTaxableIncome: z.number().min(0).finite().optional().nullable(),
    otherTaxableIncomeTaxYear: z.string().regex(/^\d{4}\/\d{2}$/).optional().nullable(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: "Invalid input", details: body.error.issues }); return; }

  try {
    const [existing] = await db.select().from(profilesTable).where(
      and(eq(profilesTable.id, req.params.profileId), eq(profilesTable.userId, req.user.id))
    );
    if (!existing) { res.status(404).json({ error: "Profile not found" }); return; }
    const effectiveTaxYear = body.data.taxYear === undefined ? existing.taxYear : body.data.taxYear;
    if (
      body.data.otherTaxableIncomeTaxYear !== undefined
      && body.data.otherTaxableIncomeTaxYear !== null
      && body.data.otherTaxableIncomeTaxYear !== effectiveTaxYear
    ) {
      res.status(400).json({ error: "Other taxable income must use the selected tax year" });
      return;
    }

    // Validate the complete resulting state rather than only the submitted
    // patch. Users may edit one coverage field or one opening detail at a time.
    const effectiveCoverageStart = body.data.coverageStartDate === undefined
      ? existing.coverageStartDate
      : body.data.coverageStartDate;
    const effectiveCoverageEnd = body.data.coverageEndDate === undefined
      ? existing.coverageEndDate
      : body.data.coverageEndDate;
    const effectiveOpeningStatus = body.data.openingPositionStatus === undefined
      ? existing.openingPositionStatus
      : body.data.openingPositionStatus;
    const effectiveOpeningBalance = body.data.openingBalance === undefined
      ? existing.openingBalance
      : body.data.openingBalance;
    const effectiveOpeningDetails = body.data.openingDetails === undefined
      ? existing.openingDetails
      : body.data.openingDetails;

    if (effectiveCoverageStart && effectiveCoverageEnd && effectiveCoverageStart > effectiveCoverageEnd) {
      res.status(400).json({ error: "Coverage end date must be on or after the start date" });
      return;
    }
    if (
      effectiveOpeningStatus === "complete" &&
      effectiveOpeningBalance == null &&
      !effectiveOpeningDetails?.trim()
    ) {
      res.status(400).json({ error: "Add an opening balance or detail before marking this complete" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.taxReserve !== undefined) updates.taxReserve = body.data.taxReserve;
    if (body.data.cashAccounts !== undefined) updates.cashAccounts = body.data.cashAccounts;
    if (body.data.arEntries !== undefined) updates.arEntries = body.data.arEntries;
    if (body.data.apEntries !== undefined) updates.apEntries = body.data.apEntries;
    if (body.data.industry !== undefined) updates.industry = body.data.industry;
    if (body.data.vatRegistered !== undefined) updates.vatRegistered = body.data.vatRegistered;
    if (body.data.taxYear !== undefined) updates.taxYear = body.data.taxYear;
    if (body.data.accountingBasis !== undefined) updates.accountingBasis = body.data.accountingBasis;
    if (body.data.openingPositionStatus !== undefined) updates.openingPositionStatus = body.data.openingPositionStatus;
    if (body.data.openingBalance !== undefined) updates.openingBalance = body.data.openingBalance;
    if (body.data.openingDetails !== undefined) updates.openingDetails = body.data.openingDetails;
    if (body.data.coverageStartDate !== undefined) updates.coverageStartDate = body.data.coverageStartDate;
    if (body.data.coverageEndDate !== undefined) updates.coverageEndDate = body.data.coverageEndDate;
    if (body.data.businessStartDate !== undefined) updates.businessStartDate = body.data.businessStartDate;
    const [updated] = await db.update(profilesTable)
      .set(updates as typeof profilesTable.$inferInsert)
      .where(and(eq(profilesTable.id, req.params.profileId), eq(profilesTable.userId, req.user.id)))
      .returning();

    if (body.data.otherTaxableIncome !== undefined) {
      const current = await getOrMigrateSa100Context(req.user.id, effectiveTaxYear);
      await updateSa100Context(req.user.id, effectiveTaxYear, {
        otherTaxableIncome: body.data.otherTaxableIncome,
        allSelfEmploymentsDisclosed: current?.allSelfEmploymentsDisclosed ?? null,
      });
    }

    res.json(await profileWithAnnualTaxContext(updated));
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
