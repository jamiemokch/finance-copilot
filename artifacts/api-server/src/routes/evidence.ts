import { Router } from "express";
import { db } from "@workspace/db";
import { evidenceItemsTable, inboxItemsTable, transactionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { extractFromImageFile, extractFromText, isConfigured } from "../lib/ai.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const storageService = new ObjectStorageService();

// GET /profiles/:profileId/evidence
router.get("/profiles/:profileId/evidence", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const items = await db.select().from(evidenceItemsTable)
      .where(eq(evidenceItemsTable.profileId, profile.id));
    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list evidence" });
  }
});

// POST /profiles/:profileId/evidence — register item after GCS upload
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

    // Mark as processing immediately
    await db.update(evidenceItemsTable)
      .set({ status: "processing" })
      .where(eq(evidenceItemsTable.id, evidenceItem.id));

    if (!isConfigured()) {
      // No AI key: mark needs_review with a placeholder
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "needs_review",
        aiReasoning: "OpenAI not configured — please classify manually.",
        confidence: 0,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      // Create inbox item for manual review
      await db.insert(inboxItemsTable).values({
        profileId: profile.id,
        evidenceId: evidenceItem.id,
        date: new Date().toISOString().split("T")[0],
        description: evidenceItem.filename,
        amount: null,
        aiReasoning: "AI extraction not available. Please classify this item manually.",
        options: [
          { label: "Fully deductible business expense", isSuggested: false },
          { label: "Partially deductible (mixed use)", isSuggested: false },
          { label: "Not deductible — personal expense", isSuggested: false },
        ],
        status: "pending",
      });
      res.json(updated);
      return;
    }

    // Download from GCS and extract
    let extracted: Awaited<ReturnType<typeof extractFromText>>;
    try {
      const gcsFile = await storageService.getObjectEntityFile(evidenceItem.objectPath);
      const fileBuffer = await gcsFile.download();
      const mimeType = evidenceItem.mimeType;

      if (mimeType.startsWith("image/")) {
        const base64 = fileBuffer[0].toString("base64");
        extracted = await extractFromImageFile(base64, mimeType, evidenceItem.filename);
      } else if (mimeType === "application/pdf") {
        // Use pdf-parse for text extraction
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(fileBuffer[0]);
        extracted = await extractFromText(data.text, evidenceItem.filename);
      } else {
        // Try as text
        extracted = await extractFromText(fileBuffer[0].toString("utf-8"), evidenceItem.filename);
      }
    } catch (extractErr) {
      req.log.error(extractErr, "Extraction failed");
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "error",
        aiReasoning: "Could not read or process the file.",
        confidence: 0,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);
      return;
    }

    const HIGH_CONFIDENCE = 0.75;
    const isHighConfidence = extracted.confidence >= HIGH_CONFIDENCE &&
      extracted.taxTreatment !== "unclear";

    if (isHighConfidence && extracted.taxTreatment === "deductible" && extracted.amount) {
      // Auto-create a transaction
      await db.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: -(extracted.amount),
        category: "expense",
        taxTreatment: "deductible",
        source: "extracted",
        evidenceId: evidenceItem.id,
      });
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "processed",
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
      }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
      res.json(updated);
    } else {
      // Create inbox item for user review
      const options = buildInboxOptions(extracted);
      await db.insert(inboxItemsTable).values({
        profileId: profile.id,
        evidenceId: evidenceItem.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: extracted.amount ?? null,
        aiReasoning: extracted.aiReasoning,
        options: options,
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

function buildInboxOptions(extracted: { taxTreatment: string; confidence: number }) {
  if (extracted.taxTreatment === "unclear" || extracted.confidence < 0.75) {
    return [
      { label: "Fully deductible — 100% business use", isSuggested: extracted.taxTreatment === "deductible" },
      {
        label: "Partially deductible — mixed personal and business use",
        isSuggested: false,
        subOptions: [
          { label: "50% business", isSuggested: false },
          { label: "75% business", isSuggested: false },
        ],
      },
      { label: "Not deductible — personal purchase", isSuggested: extracted.taxTreatment === "non_deductible" },
    ];
  }
  return [
    { label: "Confirm as deductible business expense", isSuggested: true },
    { label: "Not deductible — personal purchase", isSuggested: false },
  ];
}

export default router;
