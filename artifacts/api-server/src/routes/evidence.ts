import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  evidenceItemsTable, inboxItemsTable, transactionsTable, profilesTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import {
  extractFromImageFile, extractFromText, isConfigured, detectColumnSchema,
  type ExtractionContext, type ExtractedData, type MappingSchema,
} from "../lib/ai.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { parseSpreadsheet, normaliseCell, mapSpreadsheetRow } from "../lib/spreadsheet.js";

const router = Router();
const storageService = new ObjectStorageService();
const PROCESSING_LEASE_MS = 10 * 60 * 1000;
const mappingSchemaInput = z.object({
  headerRow: z.number().int().nonnegative(),
  columns: z.object({
    date: z.number().int().nonnegative().optional(),
    amount: z.number().int().nonnegative().optional(),
    debit: z.number().int().nonnegative().optional(),
    credit: z.number().int().nonnegative().optional(),
    description: z.number().int().nonnegative().optional(),
    category: z.number().int().nonnegative().optional(),
    balance: z.number().int().nonnegative().optional(),
  }).strict(),
  dateFormat: z.string().nullable().optional(),
  currency: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.array(z.string()).optional(),
}).strict().superRefine((mapping, context) => {
  if (mapping.columns.date === undefined) context.addIssue({ code: "custom", message: "A date column is required" });
  if (mapping.columns.description === undefined) context.addIssue({ code: "custom", message: "A description column is required" });
  if (mapping.columns.amount === undefined && mapping.columns.debit === undefined && mapping.columns.credit === undefined) {
    context.addIssue({ code: "custom", message: "An amount, debit, or credit column is required" });
  }
});

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
    evidenceType: z.enum(["document", "bank_csv", "ledger", "manual"]).default("document"),
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
      evidenceType: body.data.evidenceType,
      status: "received",
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create evidence item" });
  }
});

// DELETE /profiles/:profileId/evidence/:evidenceId — discard an unfinished upload
router.delete("/profiles/:profileId/evidence/:evidenceId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    type DiscardResult =
      | { evidenceItem: typeof evidenceItemsTable.$inferSelect }
      | { error: string; status: 404 | 409 };
    const result: DiscardResult = await db.transaction(async (tx) => {
      const [evidenceItem] = await tx.select().from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.id, req.params.evidenceId),
        eq(evidenceItemsTable.profileId, profile.id),
      )).for("update");
      if (!evidenceItem) return { error: "Evidence item not found", status: 404 as const };
      const now = new Date();
      const activeLease = (evidenceItem.status === "processing" || evidenceItem.importStatus === "processing")
        && (!evidenceItem.processingLeaseExpiresAt || evidenceItem.processingLeaseExpiresAt > now);
      if (activeLease) {
        return { error: "This upload is currently processing. Wait for it to finish before discarding it.", status: 409 as const };
      }

      const [[linkedTransaction], [linkedInboxItem]] = await Promise.all([
        tx.select({ id: transactionsTable.id }).from(transactionsTable).where(and(
          eq(transactionsTable.profileId, profile.id),
          eq(transactionsTable.evidenceId, evidenceItem.id),
        )).limit(1),
        tx.select({ id: inboxItemsTable.id }).from(inboxItemsTable).where(and(
          eq(inboxItemsTable.profileId, profile.id),
          eq(inboxItemsTable.evidenceId, evidenceItem.id),
        )).limit(1),
      ]);
      if (linkedTransaction || linkedInboxItem) {
        return { error: "This upload already has financial records. Resolve or keep those records instead.", status: 409 as const };
      }
      if (evidenceItem.status === "processed" || evidenceItem.status === "needs_review" || evidenceItem.importStatus === "done") {
        return { error: "This upload is already complete and cannot be discarded.", status: 409 as const };
      }

      await tx.delete(evidenceItemsTable).where(eq(evidenceItemsTable.id, evidenceItem.id));
      return { evidenceItem };
    });
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    // The database row is the source of truth for resuming. Clean up the
    // corresponding object as best-effort after the row is safely removed.
    await storageService.getObjectEntityFile(result.evidenceItem.objectPath)
      .then(file => file.delete())
      .catch(err => req.log.warn({ err }, "Could not remove discarded upload object"));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error(err, "Failed to discard evidence");
    res.status(500).json({ error: "Failed to discard upload" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/process — AI extraction
router.post("/profiles/:profileId/evidence/:evidenceId/process", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  let processingToken = "";
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

    const existingEvidence = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!existingEvidence) { res.status(404).json({ error: "Evidence item not found" }); return; }

    // A retry after the server has already persisted an outcome must return that
    // outcome instead of extracting and posting the same document a second time.
    if (existingEvidence.status === "processed" || existingEvidence.status === "needs_review") {
      res.json(existingEvidence);
      return;
    }

    // Claim the evidence item before reading the file. This also makes a
    // simultaneous retry explicit rather than letting two requests post twice.
    const now = new Date();
    processingToken = randomUUID();
    const [evidenceItem] = await db.update(evidenceItemsTable)
      .set({
        status: "processing",
        processingToken,
        processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      })
      .where(and(
        eq(evidenceItemsTable.id, existingEvidence.id),
        eq(evidenceItemsTable.profileId, profile.id),
        or(
          inArray(evidenceItemsTable.status, ["received", "error"]),
          and(eq(evidenceItemsTable.status, "processing"), or(
            isNull(evidenceItemsTable.processingLeaseExpiresAt),
            lt(evidenceItemsTable.processingLeaseExpiresAt, now),
          )),
        ),
      ))
      .returning();
    if (!evidenceItem) {
      res.status(409).json({ error: "This document is already being processed" });
      return;
    }
    const respondWithLatestEvidence = async () => {
      const latest = await getEvidenceItem(profile.id, evidenceItem.id);
      if (latest) res.json(latest);
      else res.status(409).json({ error: "This upload was reclaimed by another request" });
    };

    if (!isConfigured()) {
      const [updated] = await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.status, "processing"),
          eq(evidenceItemsTable.processingToken, processingToken),
        )).for("update");
        if (!owned) return [];
        await tx.insert(inboxItemsTable).values({
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
        return tx.update(evidenceItemsTable).set({
          status: "needs_review",
          processingLeaseExpiresAt: null,
          processingToken: null,
          aiReasoning: "AI not configured — classify manually.",
          confidence: 0,
        }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      });
      if (!updated) { await respondWithLatestEvidence(); return; }
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
        const pdfParse = (await import("pdf-parse") as unknown as { default: (input: Buffer) => Promise<{ text: string }> }).default;
        const data = await pdfParse(fileBuffer);
        extracted = await extractFromText(data.text, evidenceItem.filename, context);
      } else {
        extracted = await extractFromText(fileBuffer.toString("utf-8"), evidenceItem.filename, context);
      }
    } catch (extractErr) {
      req.log.error(extractErr, "Extraction failed");
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "error", processingLeaseExpiresAt: null, processingToken: null, aiReasoning: "Could not read or process the file.", confidence: 0,
      }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      if (!updated) { await respondWithLatestEvidence(); return; }
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
      const incomeAmount = extracted.amount;
      const [updated] = await db.transaction(async (tx) => {
       const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
         eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.profileId, profile.id),
         eq(evidenceItemsTable.status, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
       )).for("update");
       if (!owned) return [];
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: incomeAmount, // positive
        recordType: "income",
        category: "income",
        taxTreatment: "income",
        source: "extracted",
        evidenceId: evidenceItem.id,
        evidenceTier: 1,
        classificationConfidence: extracted.confidence,
        accountingCategory: extracted.accountingCategory ?? "income",
        allowablePercentage: 100,
        allowableAmount: incomeAmount,
        capitalAllowanceType: null,
        vatMetadata: extracted.vatMetadata as Record<string, unknown> | null ?? null,
      });
      return tx.update(evidenceItemsTable).set({
        status: "processed",
        processingLeaseExpiresAt: null,
         processingToken: null,
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
       }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      });
      if (!updated) { await respondWithLatestEvidence(); return; }
      res.json(updated);

    } else if (isHighConf && extracted.taxTreatment === "deductible" && extracted.amount) {
      // High-confidence deductible expense → auto-post as negative transaction
      const txAmount = -(extracted.amount); // store as negative
      const [updated] = await db.transaction(async (tx) => {
       const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
         eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.profileId, profile.id),
         eq(evidenceItemsTable.status, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
       )).for("update");
       if (!owned) return [];
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: txAmount,
        recordType: "expense",
        category: "expense",
        taxTreatment: "deductible",
        source: "extracted",
        evidenceId: evidenceItem.id,
        evidenceTier: 1,
        classificationConfidence: extracted.confidence,
        accountingCategory: extracted.accountingCategory ?? "other",
        allowablePercentage: extracted.allowablePercentage,
        allowableAmount: allowableAmount != null ? -allowableAmount : null,
        capitalAllowanceType: extracted.capitalAllowanceType ?? null,
        vatMetadata: extracted.vatMetadata as Record<string, unknown> | null ?? null,
      });
      return tx.update(evidenceItemsTable).set({
        status: "processed",
        processingLeaseExpiresAt: null,
         processingToken: null,
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
       }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      });
      if (!updated) { await respondWithLatestEvidence(); return; }
      res.json(updated);

    } else if (isHighConf && extracted.taxTreatment === "non_deductible" && extracted.amount) {
      // High-confidence non-deductible → record in ledger (for transparency) but NOT deducted
      const nonDeductibleAmount = extracted.amount;
      const [updated] = await db.transaction(async (tx) => {
       const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
         eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.profileId, profile.id),
         eq(evidenceItemsTable.status, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
       )).for("update");
       if (!owned) return [];
      await tx.insert(transactionsTable).values({
        profileId: profile.id,
        date: extracted.date ?? new Date().toISOString().split("T")[0],
        description: extracted.description ?? evidenceItem.filename,
        amount: -nonDeductibleAmount,
        recordType: "expense",
        category: "expense",
        taxTreatment: "non_deductible",
        source: "extracted",
        evidenceId: evidenceItem.id,
        evidenceTier: 1,
        classificationConfidence: extracted.confidence,
        accountingCategory: extracted.accountingCategory ?? "other",
        allowablePercentage: 0,
        allowableAmount: 0,
        capitalAllowanceType: null,
        vatMetadata: null,
      });
      return tx.update(evidenceItemsTable).set({
        status: "processed",
        processingLeaseExpiresAt: null,
         processingToken: null,
        extractedData: extracted as unknown as Record<string, unknown>,
        confidence: extracted.confidence,
        aiReasoning: extracted.aiReasoning,
       }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      });
      if (!updated) { await respondWithLatestEvidence(); return; }
      res.json(updated);

    } else {
      // Low confidence or unclear → send to Inbox for user review
      const options = buildInboxOptions(extracted);
      const [updated] = await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.status, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
        )).for("update");
        if (!owned) return [];
        await tx.insert(inboxItemsTable).values({
          profileId: profile.id,
          evidenceId: evidenceItem.id,
          date: extracted.date ?? new Date().toISOString().split("T")[0],
          description: extracted.description ?? evidenceItem.filename,
          amount: extracted.amount ?? null,
          aiReasoning: `${extracted.aiReasoning}${extracted.hmrcBasisNote ? ` (${extracted.hmrcBasisNote})` : ""}`,
          options,
          status: "pending",
        });
        return tx.update(evidenceItemsTable).set({
          status: "needs_review",
          processingLeaseExpiresAt: null,
          processingToken: null,
          extractedData: extracted as unknown as Record<string, unknown>,
          confidence: extracted.confidence,
          aiReasoning: extracted.aiReasoning,
        }).where(and(eq(evidenceItemsTable.id, evidenceItem.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      });
      if (!updated) { await respondWithLatestEvidence(); return; }
      res.json(updated);
    }
  } catch (err) {
    req.log.error(err);
    await db.update(evidenceItemsTable).set({ status: "error", processingLeaseExpiresAt: null, processingToken: null }).where(and(
      eq(evidenceItemsTable.id, req.params.evidenceId),
      eq(evidenceItemsTable.profileId, req.params.profileId),
      eq(evidenceItemsTable.status, "processing"),
      eq(evidenceItemsTable.processingToken, processingToken),
    )).catch(() => undefined);
    res.status(500).json({ error: "Failed to process evidence" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/detect-schema — CSV/XLSX column proposal
router.post("/profiles/:profileId/evidence/:evidenceId/detect-schema", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidenceItem = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidenceItem) { res.status(404).json({ error: "Evidence item not found" }); return; }
    const now = new Date();
    if (evidenceItem.importStatus === "processing"
      && (!evidenceItem.processingLeaseExpiresAt || evidenceItem.processingLeaseExpiresAt > now)) {
      res.status(409).json({ error: "This spreadsheet is still being processed" });
      return;
    }
    const file = await storageService.getObjectEntityFile(evidenceItem.objectPath);
    const [buffer] = await file.download();
    const rows = parseSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    if (rows.length === 0) { res.status(400).json({ error: "The spreadsheet contains no rows" }); return; }
    // Keep a user-confirmed mapping when reopening a failed or interrupted
    // import. Fresh uploads still get a new AI proposal.
    const savedMapping = evidenceItem.mappingSchema as MappingSchema | null;
    const mappingSchema = savedMapping && evidenceItem.importStatus !== "idle"
      ? savedMapping
      : await detectColumnSchema(rows.slice(0, 10), evidenceItem.filename, evidenceItem.mimeType);
    const previewRows = rows.slice(mappingSchema.headerRow + 1, mappingSchema.headerRow + 6);
    const [reopened] = await db.update(evidenceItemsTable).set({
      mappingSchema: mappingSchema as unknown as Record<string, unknown>,
      importStatus: "mapping",
      processingLeaseExpiresAt: null,
      processingToken: null,
      totalRows: Math.max(0, rows.length - mappingSchema.headerRow - 1),
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      or(
        inArray(evidenceItemsTable.importStatus, ["idle", "mapping", "done", "error"]),
        and(eq(evidenceItemsTable.importStatus, "processing"), or(
          isNull(evidenceItemsTable.processingLeaseExpiresAt),
          lt(evidenceItemsTable.processingLeaseExpiresAt, now),
        )),
      ),
    )).returning();
    if (!reopened) { res.status(409).json({ error: "This spreadsheet is still being processed" }); return; }
    res.json({ mappingSchema, previewRows });
  } catch (err) {
    req.log.error(err, "Failed to detect spreadsheet schema");
    res.status(500).json({ error: "Failed to detect spreadsheet schema" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/process-batch — confirmed CSV/XLSX import
router.post("/profiles/:profileId/evidence/:evidenceId/process-batch", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ confirmedMapping: mappingSchemaInput, bankCsv: z.boolean().optional() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid confirmedMapping is required" }); return;
  }
  let processingToken = "";
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidenceItem = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidenceItem) { res.status(404).json({ error: "Evidence item not found" }); return; }
    const mapping = body.data.confirmedMapping as MappingSchema;
    const bankCsv = body.data.bankCsv ?? evidenceItem.evidenceType === "bank_csv";
    const evidenceTier = bankCsv ? 2 : 3;
    const file = await storageService.getObjectEntityFile(evidenceItem.objectPath);
    const [buffer] = await file.download();
    const rows = parseSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    const widestRow = Math.max(...rows.map((row) => row.length), 0);
    const mappingIndexes = Object.values(mapping.columns).filter((index): index is number => index !== undefined);
    if (mapping.headerRow >= rows.length || mappingIndexes.some((index) => index < 0 || index >= widestRow)) {
      res.status(400).json({ error: "The confirmed mapping contains columns outside this spreadsheet" }); return;
    }
    // Atomically claim this evidence item. A second concurrent batch request sees
    // "processing" and cannot send the same source row to a different outcome.
    const now = new Date();
    processingToken = randomUUID();
    const [claimed] = await db.update(evidenceItemsTable).set({
      importStatus: "processing",
      processingToken,
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      or(
        inArray(evidenceItemsTable.importStatus, ["idle", "mapping", "done", "error"]),
        and(eq(evidenceItemsTable.importStatus, "processing"), or(
          isNull(evidenceItemsTable.processingLeaseExpiresAt),
          lt(evidenceItemsTable.processingLeaseExpiresAt, now),
        )),
      ),
    )).returning();
    if (!claimed) { res.status(409).json({ error: "This spreadsheet is already being processed" }); return; }
    const existing = await db.select({
      evidenceId: transactionsTable.evidenceId, sourceRowIndex: transactionsTable.sourceRowIndex,
    }).from(transactionsTable).where(eq(transactionsTable.profileId, profile.id));
    const existingInbox = await db.select({
      evidenceId: inboxItemsTable.evidenceId, sourceRowIndex: inboxItemsTable.sourceRowIndex,
    }).from(inboxItemsTable).where(eq(inboxItemsTable.profileId, profile.id));
    const handledRowIndexes = new Set([
      ...existing.filter((row) => row.evidenceId === evidenceItem.id && row.sourceRowIndex !== null).map((row) => row.sourceRowIndex!),
      ...existingInbox.filter((row) => row.evidenceId === evidenceItem.id && row.sourceRowIndex !== null).map((row) => row.sourceRowIndex!),
    ]);
    const context = await buildExtractionContext(profile, evidenceItem.category);

    let processedRows = 0, autoPostedRows = 0, inboxRows = 0, skippedRows = 0;
    const totalRowCount = Math.max(0, rows.length - mapping.headerRow - 1);
    const [prepared] = await db.update(evidenceItemsTable).set({
      evidenceType: bankCsv ? "bank_csv" : "ledger",
      mappingSchema: mapping as unknown as Record<string, unknown>,
      totalRows: totalRowCount,
      processedRows: 0, autoPostedRows: 0, inboxRows: 0, skippedRows: 0,
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      eq(evidenceItemsTable.importStatus, "processing"),
      eq(evidenceItemsTable.processingToken, processingToken),
    )).returning();
    if (!prepared) { res.status(409).json({ error: "This spreadsheet was reclaimed by another request" }); return; }

    for (let index = mapping.headerRow + 1; index < rows.length; index += 1) {
      // Long imports renew their lease as they make progress. If a different
      // request reclaimed the file after an interruption, stop before touching
      // the next source row.
      const [renewed] = await db.update(evidenceItemsTable).set({
        processingLeaseExpiresAt: new Date(Date.now() + PROCESSING_LEASE_MS),
      }).where(and(
        eq(evidenceItemsTable.id, evidenceItem.id),
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.importStatus, "processing"),
        eq(evidenceItemsTable.processingToken, processingToken),
      )).returning({ id: evidenceItemsTable.id });
      if (!renewed) { res.status(409).json({ error: "This spreadsheet was reclaimed by another request" }); return; }
      const row = rows[index];
      if (handledRowIndexes.has(index)) { skippedRows += 1; continue; }
      // The mapped header is always before this loop. Only blank rows are
      // skipped here: descriptions such as "balance transfer" are valid data.
      if (row.every((cell) => !normaliseCell(cell))) {
        skippedRows += 1; continue;
      }
      const rowData = mapSpreadsheetRow(row, mapping);
      const parsedAmount = rowData.amount;
      if (!rowData.date || parsedAmount === null || !rowData.description) { skippedRows += 1; continue; }
      const confirmedRow = { ...rowData, amount: parsedAmount };
      if (isStructuralBalanceSummary(confirmedRow, mapping)) { skippedRows += 1; continue; }

      const extracted = isConfigured()
        ? await extractFromText(`Spreadsheet row: ${JSON.stringify(row)}\nDate: ${confirmedRow.date}\nAmount: ${confirmedRow.amount}\nDescription: ${confirmedRow.description}`, evidenceItem.filename, context)
        : lowConfidenceRow(confirmedRow);
      const highConfidence = extracted.confidence >= 0.75 && extracted.taxTreatment !== "unclear";
      const conflictsWithCashDirection =
        (confirmedRow.amount > 0 && extracted.taxTreatment !== "income") ||
        (confirmedRow.amount < 0 && extracted.taxTreatment === "income");
      const wroteRow = await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.importStatus, "processing"),
          eq(evidenceItemsTable.processingToken, processingToken),
        )).for("update");
        if (!owned) return false;
        if (highConfidence && !conflictsWithCashDirection) {
          const transaction = transactionFromExtracted(profile.id, evidenceItem.id, extracted, confirmedRow, evidenceTier, index, row);
          await tx.insert(transactionsTable).values(transaction);
        } else {
          await tx.insert(inboxItemsTable).values({
            profileId: profile.id, evidenceId: evidenceItem.id, date: confirmedRow.date,
            description: confirmedRow.description, amount: confirmedRow.amount,
            aiReasoning: conflictsWithCashDirection
              ? `${extracted.aiReasoning} The suggested classification conflicts with the bank debit/credit direction, so please review it.`
              : extracted.aiReasoning,
            options: buildInboxOptions(extracted), status: "pending",
            sourceRowIndex: index, rawRowData: row,
          });
        }
        return true;
      });
      if (!wroteRow) { res.status(409).json({ error: "This spreadsheet was reclaimed by another request" }); return; }
      processedRows += 1;
      if (highConfidence && !conflictsWithCashDirection) autoPostedRows += 1;
      else inboxRows += 1;
    }
    // Recompute from persisted source-row identities so a resumed import reports
    // the complete batch, not only the rows processed during its final retry.
    const [persistedTransactions, persistedInbox] = await Promise.all([
      db.select({ sourceRowIndex: transactionsTable.sourceRowIndex })
        .from(transactionsTable).where(eq(transactionsTable.evidenceId, evidenceItem.id)),
      db.select({ sourceRowIndex: inboxItemsTable.sourceRowIndex })
        .from(inboxItemsTable).where(eq(inboxItemsTable.evidenceId, evidenceItem.id)),
    ]);
    const inboxRowIndexes = new Set(persistedInbox
      .map((row) => row.sourceRowIndex)
      .filter((index): index is number => index !== null));
    const transactionRowIndexes = new Set(persistedTransactions
      .map((row) => row.sourceRowIndex)
      .filter((index): index is number => index !== null));
    const autoPostedTotal = [...transactionRowIndexes].filter((index) => !inboxRowIndexes.has(index)).length;
    const inboxTotal = inboxRowIndexes.size;
    const processedTotal = new Set([...transactionRowIndexes, ...inboxRowIndexes]).size;
    const skippedTotal = Math.max(0, totalRowCount - processedTotal);
    const [updated] = await db.update(evidenceItemsTable).set({
      status: inboxTotal > 0 ? "needs_review" : "processed",
      importStatus: "done",
      totalRows: totalRowCount,
      processedRows: processedTotal,
      autoPostedRows: autoPostedTotal,
      inboxRows: inboxTotal,
      skippedRows: skippedTotal,
      processingLeaseExpiresAt: null,
      processingToken: null,
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      eq(evidenceItemsTable.importStatus, "processing"),
      eq(evidenceItemsTable.processingToken, processingToken),
    )).returning();
    if (!updated) { res.status(409).json({ error: "This spreadsheet was reclaimed by another request" }); return; }
    res.json({ evidence: updated, processedRows: processedTotal, autoPostedRows: autoPostedTotal, inboxRows: inboxTotal, skippedRows: skippedTotal });
  } catch (err) {
    req.log.error(err, "Failed to process spreadsheet batch");
    await db.update(evidenceItemsTable).set({ importStatus: "error", processingLeaseExpiresAt: null, processingToken: null })
      .where(and(
        eq(evidenceItemsTable.id, req.params.evidenceId),
        eq(evidenceItemsTable.profileId, req.params.profileId),
        eq(evidenceItemsTable.importStatus, "processing"),
        eq(evidenceItemsTable.processingToken, processingToken),
      )).catch(() => undefined);
    res.status(500).json({ error: "Failed to process spreadsheet batch" });
  }
});

// PATCH /profiles/:profileId/transactions/:txId/attach-evidence
router.patch("/profiles/:profileId/transactions/:txId/attach-evidence", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ evidenceId: z.string().uuid() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A valid evidenceId is required" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [transaction] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, req.params.txId), eq(transactionsTable.profileId, profile.id),
    ));
    const evidenceItem = await getEvidenceItem(profile.id, body.data.evidenceId);
    if (!transaction || !evidenceItem) { res.status(404).json({ error: "Transaction or evidence item not found" }); return; }
    const tier = tierForEvidenceType(evidenceItem.evidenceType);
    if (transaction.evidenceTier !== 0 && transaction.evidenceTier <= tier) {
      res.status(409).json({ error: "The transaction already has equal or stronger evidence" }); return;
    }
    const [updated] = await db.update(transactionsTable).set({
      evidenceId: evidenceItem.id, evidenceTier: tier,
    }).where(eq(transactionsTable.id, transaction.id)).returning();
    await db.update(evidenceItemsTable).set({ status: "processed" })
      .where(eq(evidenceItemsTable.id, evidenceItem.id));
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to attach evidence");
    res.status(500).json({ error: "Failed to attach evidence" });
  }
});

async function getEvidenceItem(profileId: string, evidenceId: string) {
  const [item] = await db.select().from(evidenceItemsTable).where(and(
    eq(evidenceItemsTable.id, evidenceId), eq(evidenceItemsTable.profileId, profileId),
  ));
  return item;
}

async function buildExtractionContext(profile: typeof profilesTable.$inferSelect, uploadCategory: string): Promise<ExtractionContext> {
  const recent = await db.select({
    description: transactionsTable.description, taxTreatment: transactionsTable.taxTreatment,
    accountingCategory: transactionsTable.accountingCategory,
  }).from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))
    .orderBy(desc(transactionsTable.createdAt)).limit(5);
  return {
    businessType: profile.type, industry: profile.industry, uploadCategory,
    priorTreatments: recent.map((transaction) => ({
      description: transaction.description, treatment: transaction.taxTreatment, category: transaction.accountingCategory,
    })),
  };
}

function isStructuralBalanceSummary(
  row: { description: string; amount: number; date: string },
  mapping: MappingSchema,
): boolean {
  if (mapping.columns.balance === undefined) return false;
  return /^(opening|closing|running)\s+balance$/i.test(row.description.trim());
}

function lowConfidenceRow(row: { date: string; amount: number; description: string }): ExtractedData {
  return { supplier: null, date: row.date, amount: Math.abs(row.amount), description: row.description,
    incomeOrExpense: row.amount >= 0 ? "income" : "expense", taxTreatment: "unclear", accountingCategory: "other",
    capitalOrRevenue: "unclear", allowablePercentage: 100, capitalAllowanceType: null, vatMetadata: null,
    hmrcBasisNote: null, confidence: 0, needsReview: true, aiReasoning: "AI classification is unavailable; please review this imported row." };
}

function transactionFromExtracted(profileId: string, evidenceId: string, extracted: ExtractedData,
  row: { date: string; amount: number; description: string }, evidenceTier: number, sourceRowIndex: number, rawRowData: string[]) {
  const isIncome = extracted.taxTreatment === "income";
  // The bank/ledger amount is the cash fact; AI only classifies its treatment.
  const amount = row.amount;
  const allowable = Math.abs(amount) * (extracted.allowablePercentage / 100);
  return {
    profileId, evidenceId, date: extracted.date ?? row.date, description: extracted.description ?? row.description,
    amount, recordType: isIncome ? "income" : "expense", category: isIncome ? "income" : "expense", taxTreatment: extracted.taxTreatment, source: "extracted",
    evidenceTier, sourceRowIndex, rawRowData, classificationConfidence: extracted.confidence,
    accountingCategory: extracted.accountingCategory, allowablePercentage: isIncome ? 100 : extracted.allowablePercentage,
    allowableAmount: isIncome ? amount : extracted.taxTreatment === "non_deductible" ? 0 : -allowable,
    capitalAllowanceType: extracted.capitalAllowanceType, vatMetadata: extracted.vatMetadata,
  };
}

function tierForEvidenceType(type: string): number {
  return type === "document" ? 1 : type === "bank_csv" ? 2 : type === "ledger" ? 3 : 4;
}

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
