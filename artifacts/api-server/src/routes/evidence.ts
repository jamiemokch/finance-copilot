import { Router } from "express";
import { db } from "@workspace/db";
import {
  evidenceItemsTable, inboxItemsTable, transactionsTable, profilesTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import {
  extractFromImageFile, extractFromText, isConfigured,
  type ExtractionContext, type ExtractedData,
} from "../lib/ai.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { computeTaxImpactDiff } from "../lib/finance.js";

const router = Router();
const storageService = new ObjectStorageService();

// GET /profiles/:profileId/evidence
router.get("/profiles/:profileId/evidence", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const items = await db.select().from(evidenceItemsTable)
      .where(eq(evidenceItemsTable.profileId, profile.id))
      .orderBy(desc(evidenceItemsTable.createdAt));
    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list evidence" });
  }
});

// POST /profiles/:profileId/evidence — register item after upload
router.post("/profiles/:profileId/evidence", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    filename: z.string().min(1),
    objectPath: z.string().min(1),
    mimeType: z.string().min(1),
    category: z.string().default("other"),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [item] = await db.insert(evidenceItemsTable).values({
      profileId: profile.id,
      filename: body.data.filename,
      objectPath: body.data.objectPath,
      mimeType: body.data.mimeType,
      category: body.data.category,
      status: "received",
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create evidence item" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/process — AI extraction
router.post("/profiles/:profileId/evidence/:evidenceId/process", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const [evidenceItem] = await db.select().from(evidenceItemsTable).where(
      and(eq(evidenceItemsTable.id, req.params.evidenceId),
          eq(evidenceItemsTable.profileId, profile.id))
    );
    if (!evidenceItem) { res.status(404).json({ error: "Evidence item not found" }); return; }

    await db.update(evidenceItemsTable)
      .set({ status: "processing" })
      .where(eq(evidenceItemsTable.id, evidenceItem.id));

    if (!isConfigured()) {
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "needs_review",
        aiReasoning: "AI not configured — classify manually.",
        confidence: 0,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      await db.insert(inboxItemsTable).values({
        profileId: profile.id,
        evidenceId: evidenceItem.id,
        date: new Date().toISOString().split("T")[0],
        description: evidenceItem.filename,
        amount: null,
        aiReasoning: "AI extraction not available. Please classify manually.",
        options: [
          { label: "Income received", isSuggested: false },
          { label: "Fully deductible business expense", isSuggested: false },
          { label: "Partially deductible (mixed use)", isSuggested: false },
          { label: "Not deductible — personal expense", isSuggested: false },
        ],
        status: "pending",
      });
      res.json(updated);
      return;
    }

    // Build extraction context from profile + recent confirmed treatments
    const recentTxns = await db.select({
      description: transactionsTable.description,
      taxTreatment: transactionsTable.taxTreatment,
      accountingCategory: transactionsTable.accountingCategory,
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.source, "extracted"),
      ))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(5);

    const context: ExtractionContext = {
      businessType: profile.type ?? "sole_trader",
      industry: (profile as Record<string, unknown>).industry as string ?? "other",
      uploadCategory: evidenceItem.category,
      priorTreatments: recentTxns.map((t) => ({
        description: t.description,
        treatment: t.taxTreatment,
        category: t.accountingCategory ?? "other",
      })),
    };

    // Fetch and process file
    let extracted: ExtractedData;
    try {
      const objectFile = await storageService.getObjectEntityFile(evidenceItem.objectPath);
      const [fileBuffer] = await objectFile.download();
      const mimeType = evidenceItem.mimeType;

      if (mimeType.startsWith("image/")) {
        extracted = await extractFromImageFile(
          fileBuffer.toString("base64"), mimeType, evidenceItem.filename, context
        );
      } else if (mimeType === "application/pdf") {
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(fileBuffer);
        extracted = await extractFromText(data.text, evidenceItem.filename, context);
      } else {
        extracted = await extractFromText(fileBuffer.toString("utf-8"), evidenceItem.filename, context);
      }
    } catch (extractErr) {
      req.log.error(extractErr, "Extraction failed");
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "error", aiReasoning: "Could not read or process the file.", confidence: 0,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);
      return;
    }

    const HIGH_CONFIDENCE = 0.75;
    const isHighConf = extracted.confidence >= HIGH_CONFIDENCE && extracted.taxTreatment !== "unclear";

    // Compute allowable amount for mixed-use items
    const allowableAmount =
      extracted.amount != null
        ? Math.round(extracted.amount * (extracted.allowablePercentage / 100) * 100) / 100
        : null;

    if (isHighConf && extracted.taxTreatment === "income" && extracted.amount) {
      // High-confidence income → auto-post as positive transaction
      await db.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: extracted.amount, // positive
        category: "income",
        taxTreatment: "income",
        source: "extracted",
        evidenceId: evidenceItem.id,
        accountingCategory: extracted.accountingCategory ?? "income",
        allowablePercentage: 100,
        allowableAmount: extracted.amount,
        capitalAllowanceType: null,
        vatMetadata: extracted.vatMetadata as Record<string, unknown> | null ?? null,
      });
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "processed",
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);

    } else if (isHighConf && extracted.taxTreatment === "deductible" && extracted.amount) {
      // High-confidence deductible expense → auto-post as negative transaction
      const txAmount = -(extracted.amount); // store as negative
      await db.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: txAmount,
        category: "expense",
        taxTreatment: "deductible",
        source: "extracted",
        evidenceId: evidenceItem.id,
        accountingCategory: extracted.accountingCategory ?? "other",
        allowablePercentage: extracted.allowablePercentage,
        allowableAmount: allowableAmount != null ? -allowableAmount : null,
        capitalAllowanceType: extracted.capitalAllowanceType ?? null,
        vatMetadata: extracted.vatMetadata as Record<string, unknown> | null ?? null,
      });
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "processed",
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);

    } else if (isHighConf && extracted.taxTreatment === "non_deductible" && extracted.amount) {
      // High-confidence non-deductible → record in ledger (for transparency) but NOT deducted
      await db.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: -(extracted.amount),
        category: "expense",
        taxTreatment: "non_deductible",
        source: "extracted",
        evidenceId: evidenceItem.id,
        accountingCategory: extracted.accountingCategory ?? "other",
        allowablePercentage: 0,
        allowableAmount: 0,
        capitalAllowanceType: null,
        vatMetadata: null,
      });
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "processed",
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);

    } else {
      // Low confidence or unclear → send to Inbox for user review
      const options = buildInboxOptions(extracted);
      await db.insert(inboxItemsTable).values({
        profileId: profile.id,
        evidenceId: evidenceItem.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: extracted.amount ?? null,
        aiReasoning: `${extracted.aiReasoning}${extracted.hmrcBasisNote ? ` (${extracted.hmrcBasisNote})` : ""}`,
        options,
        status: "pending",
      });
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "needs_review",
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to process evidence" });
  }
});

function buildInboxOptions(extracted: ExtractedData) {
  // If AI suspects income
  if (extracted.incomeOrExpense === "income" || extracted.taxTreatment === "income") {
    return [
      { label: "Income received — confirmed", isSuggested: true },
      { label: "Not income — reclassify as expense", isSuggested: false },
    ];
  }
  // Mixed-use or unclear
  if (extracted.taxTreatment === "unclear" || extracted.allowablePercentage < 100) {
    return [
      {
        label: "Fully deductible — 100% business use",
        isSuggested: extracted.taxTreatment === "deductible" && extracted.allowablePercentage >= 95,
      },
      {
        label: "75% business use — partially deductible",
        isSuggested: extracted.allowablePercentage >= 70 && extracted.allowablePercentage < 95,
        subOptions: [{ label: "75% business", isSuggested: true }],
      },
      {
        label: "50% business use — partially deductible",
        isSuggested: extracted.allowablePercentage >= 40 && extracted.allowablePercentage < 70,
        subOptions: [{ label: "50% business", isSuggested: true }],
      },
      { label: "Not deductible — personal expense", isSuggested: extracted.taxTreatment === "non_deductible" },
    ];
  }
  // Clear deductible — just confirm
  return [
    { label: "Confirm as deductible business expense", isSuggested: true },
    { label: "Not deductible — personal expense", isSuggested: false },
  ];
}

export default router;
