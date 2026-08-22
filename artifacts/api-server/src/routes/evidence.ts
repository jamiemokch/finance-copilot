import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { Readable } from "stream";
import {
  bankImportBatchesTable,
  db,
  privateUploadBindingsTable,
  privateUploadObjectsTable,
} from "@workspace/db";
import {
  evidenceAuditEventsTable, evidenceItemsTable, evidenceTransactionLinksTable,
  inboxItemsTable, transactionsTable, profilesTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { scanProfile } from "./reconciliation.js";
import {
  analyseSpreadsheetWithAI, extractFromImageFile, extractFromText, isConfigured, detectColumnSchema,
  type ExtractionContext, type ExtractedData, type MappingSchema,
} from "../lib/ai.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { analyseSpreadsheet, inspectSpreadsheet, parseSpreadsheet, normaliseCell, mapSpreadsheetRow, ukTaxYear, looksLikeBalanceRow, type RowDisposition } from "../lib/spreadsheet.js";

const router = Router();
const storageService = new ObjectStorageService();
const PROCESSING_LEASE_MS = 10 * 60 * 1000;
const SPREADSHEET_SOURCE_ROW_CONFLICT_CODE = "source_row_conflict";
const SPREADSHEET_IMPORT_FAILURE_CODE = "spreadsheet_import_failed";

type SpreadsheetSourceRowConflict = {
  sheetId: string;
  worksheet: string;
  rowNumber: number;
};

class SpreadsheetSourceRowConflictError extends Error {
  readonly code = SPREADSHEET_SOURCE_ROW_CONFLICT_CODE;

  constructor(readonly conflict: SpreadsheetSourceRowConflict) {
    super(
      `This import was not completed because worksheet "${conflict.worksheet}", row ${conflict.rowNumber} already has a source record. No rows from this confirmation were added.`,
    );
    this.name = "SpreadsheetSourceRowConflictError";
  }
}

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

const confirmedSpreadsheetInput = z.object({
  confirmation: z.literal(true),
  selectedSheetIds: z.array(z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/)).min(1).max(100),
  sheetMappings: z.record(mappingSchemaInput),
  filingScope: z.array(z.string().regex(/^\d{4}-\d{4}$/)).min(1).max(20),
  excludedRowRefs: z.array(z.object({
    sheetId: z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/),
    rowNumber: z.number().int().positive(),
  }).strict()).max(100_000).default([]),
  preTradingStartMode: z.enum(["retain", "exclude"]).default("exclude"),
  outsideScopeMode: z.enum(["retain", "exclude"]).default("exclude"),
}).strict();

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

// Documents without an active financial relationship are supporting records
// only. They intentionally do not appear in Financial Memory totals.
router.get("/profiles/:profileId/evidence/unmatched", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [documents, links] = await Promise.all([
      db.select().from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.workflowVersion, 2),
        eq(evidenceItemsTable.documentLifecycle, "active"),
      )).orderBy(desc(evidenceItemsTable.createdAt)),
      db.select({ evidenceId: evidenceTransactionLinksTable.evidenceId }).from(evidenceTransactionLinksTable).where(and(
        eq(evidenceTransactionLinksTable.profileId, profile.id),
        eq(evidenceTransactionLinksTable.linkStatus, "active"),
      )),
    ]);
    const linkedIds = new Set(links.map((link) => link.evidenceId));
    res.json(documents.filter((document) => !linkedIds.has(document.id)));
  } catch (err) {
    req.log.error(err, "Failed to list unmatched evidence");
    res.status(500).json({ error: "Failed to list unmatched evidence" });
  }
});

router.get("/profiles/:profileId/evidence/:evidenceId/download", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidence = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidence || evidence.documentLifecycle === "tombstoned") {
      res.status(404).json({ error: "Document not found" }); return;
    }
    const objectFile = await storageService.getObjectEntityFile(evidence.objectPath);
    const response = await storageService.downloadObject(objectFile, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${evidence.filename.replace(/["\r\n]/g, "_")}"`);
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (err) {
    req.log.error(err, "Failed to download evidence");
    res.status(500).json({ error: "Failed to download document" });
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
    const [upload] = await db.select().from(privateUploadObjectsTable).where(
      eq(privateUploadObjectsTable.objectPath, body.data.objectPath),
    ).limit(1);
    // Only truly unbound pre-M9 staged uploads may be adopted on first
    // registration. An object already bound to another profile stays scoped.
    const [anyBinding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(eq(privateUploadBindingsTable.objectId, upload.id)).limit(1) : [];
    if (upload && upload.userId === req.user.id && !anyBinding) {
      await db.insert(privateUploadBindingsTable).values({
        profileId: profile.id, objectId: upload.id, userId: req.user.id,
      }).onConflictDoNothing();
    }
    const [binding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(and(
        eq(privateUploadBindingsTable.objectId, upload.id),
        eq(privateUploadBindingsTable.profileId, profile.id),
        eq(privateUploadBindingsTable.userId, req.user.id),
      )).limit(1) : [];
    if (!upload || upload.userId !== req.user.id || !binding) {
      // An opaque storage path alone is never proof that the caller owns the
      // bytes. This blocks attachment and downstream processing cross-user.
      res.status(404).json({ error: "Uploaded file not found" });
      return;
    }
    // New original documents never use the legacy auto-post workflow. Exact
    // same-profile files share their document identity, but later links remain
    // independent through evidence_transaction_links.
    if (body.data.evidenceType === "document" && upload.contentHash) {
      const [existing] = await db.select().from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.workflowVersion, 2),
        eq(evidenceItemsTable.documentLifecycle, "active"),
        eq(evidenceItemsTable.contentHash, upload.contentHash),
      )).limit(1);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }
    let item: typeof evidenceItemsTable.$inferSelect;
    try {
      [item] = await db.insert(evidenceItemsTable).values({
        profileId: profile.id,
        filename: body.data.filename,
        objectPath: body.data.objectPath,
        mimeType: body.data.mimeType,
        category: body.data.category,
        evidenceType: body.data.evidenceType,
        status: "received",
        workflowVersion: body.data.evidenceType === "document" ? 2 : 1,
        reviewState: "pending",
        contentHash: upload.contentHash,
        objectSize: upload.objectSize,
      }).returning();
    } catch (err) {
      const dbError = err as { cause?: { code?: string } };
      if (dbError.cause?.code === "23505" && body.data.evidenceType === "document" && upload.contentHash) {
        const [winner] = await db.select().from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.workflowVersion, 2),
          eq(evidenceItemsTable.documentLifecycle, "active"),
          eq(evidenceItemsTable.contentHash, upload.contentHash),
        )).limit(1);
        if (winner) { res.status(200).json(winner); return; }
      }
      throw err;
    }
    if (item.workflowVersion === 2) {
      await addEvidenceAudit(profile.id, item.id, req.user.id, "document_registered", {
        filename: item.filename, contentHash: item.contentHash,
      });
    }
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
      if (evidenceItem.workflowVersion >= 2) {
        const [tombstoned] = await tx.update(evidenceItemsTable).set({
          documentLifecycle: "tombstoned",
        }).where(eq(evidenceItemsTable.id, evidenceItem.id)).returning();
        return { evidenceItem: tombstoned, tombstoned: true };
      }
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
    if ("tombstoned" in result) {
      await addEvidenceAudit(profile.id, result.evidenceItem.id, req.user.id, "document_tombstoned", { via: "discard" });
      res.json({ deleted: true, tombstoned: true });
      return;
    }
    // A content-hashed object can be shared by later evidence registrations.
    // Keep it after a discard: removing a shared physical object would make a
    // different active evidence row (or a safe repeat upload) unreadable.
    // Older pre-deduplication objects can still be removed once no evidence or
    // bank-import row refers to their path.
    const [[upload], [otherEvidence], [bankBatch]] = await Promise.all([
      db.select().from(privateUploadObjectsTable)
        .where(eq(privateUploadObjectsTable.objectPath, result.evidenceItem.objectPath)).limit(1),
      db.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable)
        .where(eq(evidenceItemsTable.objectPath, result.evidenceItem.objectPath)).limit(1),
      db.select({ id: bankImportBatchesTable.id }).from(bankImportBatchesTable)
        .where(eq(bankImportBatchesTable.objectPath, result.evidenceItem.objectPath)).limit(1),
    ]);
    if (!upload?.contentHash && !otherEvidence && !bankBatch) {
      await storageService.getObjectEntityFile(result.evidenceItem.objectPath)
        .then(async (file) => {
          await file.delete();
          await db.delete(privateUploadObjectsTable)
            .where(eq(privateUploadObjectsTable.objectPath, result.evidenceItem.objectPath));
        })
        .catch(err => req.log.warn({ err }, "Could not remove discarded legacy upload object"));
    }
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
    if (existingEvidence.workflowVersion >= 2 && existingEvidence.documentLifecycle !== "active") {
      res.status(409).json({ error: "This document is no longer active" }); return;
    }

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
        eq(evidenceItemsTable.documentLifecycle, "active"),
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

    if (!isConfigured() && evidenceItem.workflowVersion < 2) {
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
    if (!isConfigured() && evidenceItem.workflowVersion >= 2) {
      const [updated] = await db.update(evidenceItemsTable).set({
        status: "needs_review",
        reviewState: "review_required",
        processingLeaseExpiresAt: null,
        processingToken: null,
        aiReasoning: "Extraction is unavailable. Review and enter the financial details yourself.",
        confidence: 0,
      }).where(and(
        eq(evidenceItemsTable.id, evidenceItem.id),
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.documentLifecycle, "active"),
        eq(evidenceItemsTable.processingToken, processingToken),
      )).returning();
      if (!updated) { await respondWithLatestEvidence(); return; }
      await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "extraction_unavailable", {});
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

    // M9 documents always stop at a reviewable candidate. No confidence level,
    // category, or extraction result is allowed to write the canonical ledger.
    if (evidenceItem.workflowVersion >= 2) {
      const [updated] = await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.documentLifecycle, "active"),
          eq(evidenceItemsTable.status, "processing"),
          eq(evidenceItemsTable.processingToken, processingToken),
        )).for("update");
        if (!owned) return [];
        await tx.insert(evidenceAuditEventsTable).values({
          profileId: profile.id,
          evidenceId: evidenceItem.id,
          actorUserId: req.user.id,
          eventType: "extraction_completed",
          details: { confidence: extracted.confidence, suggestedTaxTreatment: extracted.taxTreatment },
        });
        return tx.update(evidenceItemsTable).set({
          status: "needs_review",
          reviewState: "review_required",
          processingLeaseExpiresAt: null,
          processingToken: null,
          extractedData: extracted as unknown as Record<string, unknown>,
          confidence: extracted.confidence,
          aiReasoning: extracted.aiReasoning,
        }).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.documentLifecycle, "active"),
          eq(evidenceItemsTable.processingToken, processingToken),
        )).returning();
      });
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
    if (evidenceItem.workflowVersion >= 2) {
      res.status(422).json({ error: "Original documents use the review workflow, not spreadsheet import." }); return;
    }
    const now = new Date();
    if (evidenceItem.importStatus === "processing"
      && (!evidenceItem.processingLeaseExpiresAt || evidenceItem.processingLeaseExpiresAt > now)) {
      res.status(409).json({ error: "This spreadsheet is still being processed" });
      return;
    }
    const file = await storageService.getObjectEntityFile(evidenceItem.objectPath);
    const [buffer] = await file.download();
    const savedState = evidenceItem.mappingSchema as {
      mappingSchema?: MappingSchema;
      deterministicFindings?: unknown;
      aiProposal?: unknown;
      aiStatus?: unknown;
      userDecision?: unknown;
      lastImportError?: unknown;
    } | null;
    // A user decision is durable and must never be overwritten by a later
    // analysis request. Return the persisted review state instead.
    if (savedState?.deterministicFindings && savedState.mappingSchema && savedState.userDecision) {
      res.json({
        mappingSchema: savedState.mappingSchema,
        previewRows: [],
        analysis: savedState.deterministicFindings,
        aiProposal: savedState.aiProposal ?? null,
        aiStatus: savedState.aiStatus ?? { status: "not_requested" },
        userDecision: savedState.userDecision,
        lastImportError: savedState.lastImportError ?? null,
      });
      return;
    }
    const workbook = inspectSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    const analysis = analyseSpreadsheet(workbook);
    if (workbook.totalParserRows === 0) { res.status(400).json({ error: "The spreadsheet contains no rows" }); return; }
    const ai = await analyseSpreadsheetWithAI(workbook, analysis);
    const primarySheet = analysis.sheets.find((sheet) => sheet.role === "transactional") ?? analysis.sheets[0];
    const mappingSchema: MappingSchema = primarySheet ? {
      headerRow: primarySheet.mapping.headerRow ?? 0,
      columns: primarySheet.mapping.columns,
      dateFormat: null,
      currency: "GBP",
      confidence: 0.35,
      notes: ["Rule-based mapping; confirm the selected sheet and columns before import."],
    } : {
      headerRow: 0, columns: {}, dateFormat: null, currency: "GBP", confidence: 0, notes: ["No transaction sheet was inferred."],
    };
    const previewRows = primarySheet?.previewRows.map((row) => row.values) ?? [];
    const state = {
      schemaVersion: "spreadsheet-review.v1",
      mappingSchema,
      deterministicFindings: analysis,
      aiProposal: ai.proposal,
      aiStatus: { status: ai.status, reason: ai.reason ?? null, sampledSheetIds: ai.sampledSheetIds, providerCalls: ai.providerCalls, limits: ai.limits },
      userDecision: savedState?.userDecision ?? null,
      lastImportError: savedState?.lastImportError ?? null,
    };
    const [reopened] = await db.update(evidenceItemsTable).set({
      mappingSchema: state as unknown as Record<string, unknown>,
      importStatus: "mapping",
      processingLeaseExpiresAt: null,
      processingToken: null,
      totalRows: workbook.totalParserRows,
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
    await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_inspected", {
      contentHash: workbook.contentHash, parserVersion: analysis.parserVersion, sheetCount: workbook.sheets.length,
      totalParserRows: workbook.totalParserRows, aiStatus: ai.status, fallbackReason: ai.reason ?? null,
    });
    res.json({
      mappingSchema, previewRows, analysis, aiProposal: ai.proposal,
      aiStatus: state.aiStatus, userDecision: state.userDecision, lastImportError: state.lastImportError,
    });
  } catch (err) {
    req.log.error(err, "Failed to detect spreadsheet schema");
    res.status(500).json({ error: "Failed to detect spreadsheet schema" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/confirm-spreadsheet
// This is the only spreadsheet path permitted to create financial records. It
// deliberately receives a human-confirmed mapping and scope, never an AI
// proposal. Imported movements remain unclassified until the user reviews them.
router.post("/profiles/:profileId/evidence/:evidenceId/confirm-spreadsheet", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = confirmedSpreadsheetInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Confirm selected sheets, mappings, and filing scope before importing." }); return; }
  let processingToken = "";
  let evidenceItem: typeof evidenceItemsTable.$inferSelect | undefined;
  let userDecision: Record<string, unknown> | undefined;
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    evidenceItem = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidenceItem) { res.status(404).json({ error: "Evidence item not found" }); return; }
    const confirmedEvidence = evidenceItem;
    if (evidenceItem.workflowVersion >= 2) {
      res.status(422).json({ error: "Original documents use the review workflow, not spreadsheet import." }); return;
    }
    const file = await storageService.getObjectEntityFile(evidenceItem.objectPath);
    const [buffer] = await file.download();
    const workbook = inspectSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    const selected = new Set(body.data.selectedSheetIds);
    const knownSheetIds = new Set(workbook.sheets.map((sheet) => sheet.sheetId));
    if ([...selected].some((sheetId) => !knownSheetIds.has(sheetId))) {
      res.status(400).json({ error: "A selected sheet is not part of this workbook." }); return;
    }
    const excluded = new Set(body.data.excludedRowRefs.map((row) => `${row.sheetId}:${row.rowNumber}`));
    const counts = Object.fromEntries([
      "imported", "duplicate", "invalid", "header", "blank", "balance_total", "non_transactional",
      "excluded_by_user", "excluded_by_rule", "unmapped", "outside_scope", "pre_trading_start", "unselected_sheet",
    ].map((key) => [key, 0])) as Record<RowDisposition, number>;
    const rowsToWrite: Array<{
      sourceRowIndex: number; row: string[]; sheetId: string; displayName: string; sourceRow: number;
      date: string; amount: number; description: string; taxYear: string; filingScope: boolean; disposition: RowDisposition;
    }> = [];
    const fingerprints = new Set<string>();
    const mappingsForAudit: Record<string, MappingSchema> = {};

    for (const sheet of workbook.sheets) {
      if (!selected.has(sheet.sheetId)) {
        for (const row of sheet.rows) counts.unselected_sheet += 1;
        continue;
      }
      const mapping = body.data.sheetMappings[sheet.sheetId] as MappingSchema | undefined;
      if (!mapping) { res.status(400).json({ error: `Choose a confirmed mapping for ${sheet.displayName}.` }); return; }
      mappingsForAudit[sheet.sheetId] = mapping;
      const maxColumn = sheet.columnCount;
      const indices = Object.values(mapping.columns).filter((value): value is number => value !== undefined);
      if (mapping.headerRow < 0 || mapping.headerRow >= sheet.rowCount || indices.some((index) => index < 0 || index >= maxColumn)) {
        res.status(400).json({ error: `The confirmed mapping contains a column outside ${sheet.displayName}.` }); return;
      }
      for (const source of sheet.rows) {
        if (source.rowNumber <= mapping.headerRow + 1) { counts.header += 1; continue; }
        const rowKey = `${sheet.sheetId}:${source.rowNumber}`;
        if (source.values.every((cell) => !normaliseCell(cell))) { counts.blank += 1; continue; }
        if (excluded.has(rowKey)) { counts.excluded_by_user += 1; continue; }
        const mapped = mapSpreadsheetRow(source.values, mapping);
        if (looksLikeBalanceRow(source.values)) { counts.balance_total += 1; continue; }
        if (!mapped.date || mapped.amount === null || !mapped.description) {
          // Unresolved financial rows must be explicitly acknowledged, not
          // silently dropped. The first confirmation tells the user exactly
          // which source rows still require an exclusion decision.
          res.status(400).json({ error: `Row ${source.rowNumber} in ${sheet.displayName} has an unresolved date, amount, or description. Exclude it explicitly or correct the mapping.` });
          return;
        }
        const taxYear = ukTaxYear(mapped.date);
        if (!taxYear) {
          res.status(400).json({ error: `Row ${source.rowNumber} in ${sheet.displayName} has an unresolved date. Exclude it explicitly or correct the mapping.` });
          return;
        }
        const businessStartDate = (profile as typeof profile & { businessStartDate?: string | null }).businessStartDate;
        const isPreTrading = Boolean(businessStartDate && mapped.date < businessStartDate);
        const inFilingScope = body.data.filingScope.includes(taxYear);
        if (isPreTrading && body.data.preTradingStartMode === "exclude") { counts.excluded_by_user += 1; continue; }
        if (!inFilingScope && body.data.outsideScopeMode === "exclude") { counts.excluded_by_user += 1; continue; }
        const fingerprint = `${mapped.date}|${Math.round(mapped.amount * 100)}|${normaliseCell(mapped.description).toLowerCase()}`;
        if (fingerprints.has(fingerprint)) { counts.duplicate += 1; continue; }
        fingerprints.add(fingerprint);
        const disposition: RowDisposition = isPreTrading ? "pre_trading_start" : !inFilingScope ? "outside_scope" : "imported";
        counts[disposition] += 1;
        rowsToWrite.push({
          // Excel has up to 1,048,576 rows. Leave a larger fixed namespace
          // per worksheet so a last-row reference can never collide with the
          // first row of the following sheet.
          sourceRowIndex: sheet.index * 1_100_000 + source.rowNumber,
          row: source.values, sheetId: sheet.sheetId, displayName: sheet.displayName, sourceRow: source.rowNumber,
          date: mapped.date, amount: mapped.amount, description: mapped.description, taxYear,
          filingScope: inFilingScope, disposition,
        });
      }
    }

    const mappingRevision = createHash("sha256").update(JSON.stringify({
      selectedSheetIds: body.data.selectedSheetIds, sheetMappings: mappingsForAudit, filingScope: body.data.filingScope,
      excludedRowRefs: body.data.excludedRowRefs, preTradingStartMode: body.data.preTradingStartMode, outsideScopeMode: body.data.outsideScopeMode,
    })).digest("hex");
    const state = (evidenceItem.mappingSchema as Record<string, unknown> | null) ?? {};
    if (evidenceItem.importStatus === "done") {
      if (state.confirmedMappingRevision === mappingRevision) {
        res.json({ evidence: evidenceItem, dispositionCounts: state.finalDispositions ?? counts, taxYears: [...new Set(rowsToWrite.map((row) => row.taxYear))], importedRows: rowsToWrite.length });
      } else {
        res.status(409).json({ error: "This workbook is already imported. Upload a replacement to apply a different confirmed mapping." });
      }
      return;
    }
    const now = new Date();
    processingToken = randomUUID();
    const [claimed] = await db.update(evidenceItemsTable).set({
      importStatus: "processing", processingToken,
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      // The workbook is parsed before this lease is acquired. Bind the claim
      // to the object that was parsed so a concurrent replacement cannot let
      // stale in-memory rows commit against the replacement evidence record.
      eq(evidenceItemsTable.objectPath, evidenceItem.objectPath),
      or(
        inArray(evidenceItemsTable.importStatus, ["idle", "mapping", "error"]),
        and(eq(evidenceItemsTable.importStatus, "processing"), or(isNull(evidenceItemsTable.processingLeaseExpiresAt), lt(evidenceItemsTable.processingLeaseExpiresAt, now))),
      ),
    )).returning();
    if (!claimed) { res.status(409).json({ error: "This spreadsheet was replaced or is already being processed. Reload the review before trying again." }); return; }

    userDecision = {
      selectedSheetIds: body.data.selectedSheetIds, sheetMappings: mappingsForAudit, filingScope: body.data.filingScope,
      excludedRowRefs: body.data.excludedRowRefs, preTradingStartMode: body.data.preTradingStartMode,
      outsideScopeMode: body.data.outsideScopeMode, confirmedAt: now.toISOString(), actorUserId: req.user.id, mappingRevision,
    };

    const [updated] = await db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.id, confirmedEvidence.id), eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.importStatus, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
      )).for("update");
      if (!owned) return [];
      for (const item of rowsToWrite) {
        const [inserted] = await tx.insert(transactionsTable).values({
          profileId: profile.id, evidenceId: confirmedEvidence.id,
          sourceRowIndex: item.sourceRowIndex, rawRowData: {
            sheetId: item.sheetId, displayName: item.displayName, sourceRow: item.sourceRow, values: item.row,
            taxYear: item.taxYear, filingScope: item.filingScope, disposition: item.disposition,
          },
          date: item.date, description: item.description, amount: item.amount,
          recordType: "unknown", category: "expense", taxTreatment: "unclear", source: "extracted",
          evidenceTier: confirmedEvidence.evidenceType === "bank_csv" ? 2 : 3,
          accountingCategory: "other", allowablePercentage: 0, allowableAmount: 0,
          accountingClassification: "unknown", classificationConfidence: 0,
        }).onConflictDoNothing().returning({ id: transactionsTable.id });
        if (!inserted) {
          throw new SpreadsheetSourceRowConflictError({
            sheetId: item.sheetId,
            worksheet: item.displayName,
            rowNumber: item.sourceRow,
          });
        }
      }
      const [saved] = await tx.update(evidenceItemsTable).set({
        evidenceType: "ledger", status: "needs_review", importStatus: "done",
        mappingSchema: (() => {
          const { lastImportError: _lastImportError, ...stateWithoutLastError } = state;
          return {
            ...stateWithoutLastError, userDecision, confirmedMappingRevision: mappingRevision, finalDispositions: counts,
          };
        })() as Record<string, unknown>,
        totalRows: workbook.totalParserRows, processedRows: rowsToWrite.length, autoPostedRows: 0, inboxRows: 0,
        skippedRows: workbook.totalParserRows - rowsToWrite.length,
        processingLeaseExpiresAt: null, processingToken: null,
      }).where(and(eq(evidenceItemsTable.id, confirmedEvidence.id), eq(evidenceItemsTable.processingToken, processingToken))).returning();
      if (!saved) return [];
      await tx.insert(evidenceAuditEventsTable).values({
        profileId: profile.id, evidenceId: confirmedEvidence.id, actorUserId: req.user.id, eventType: "spreadsheet_import_confirmed",
        details: {
          contentHash: workbook.contentHash, parserVersion: "spreadsheet-parser.v2", mappingRevision,
          userDecision, dispositionCounts: counts, importableRows: rowsToWrite.length,
        },
      });
      return [saved];
    });
    if (!updated) { res.status(409).json({ error: "This spreadsheet was reclaimed by another request" }); return; }
    res.json({ evidence: updated, dispositionCounts: counts, taxYears: [...new Set(rowsToWrite.map((row) => row.taxYear))], importedRows: rowsToWrite.length });
    void scanProfile(profile.id).catch((error) => req.log.warn({ error }, "Post-spreadsheet reconciliation scan failed"));
  } catch (err) {
    const conflict = err instanceof SpreadsheetSourceRowConflictError ? err.conflict : undefined;
    const errorCode = conflict ? SPREADSHEET_SOURCE_ROW_CONFLICT_CODE : SPREADSHEET_IMPORT_FAILURE_CODE;
    const safeMessage = conflict
      ? err instanceof SpreadsheetSourceRowConflictError ? err.message : "This import was not completed."
      : "The spreadsheet import could not be completed. No rows from this confirmation were added. You can retry safely.";
    req.log.error(err, conflict ? "Spreadsheet source-row conflict rolled back" : "Failed to confirm spreadsheet import");
    const currentState = (evidenceItem?.mappingSchema as Record<string, unknown> | null) ?? {};
    await db.update(evidenceItemsTable).set({
      importStatus: "error",
      processingLeaseExpiresAt: null,
      processingToken: null,
      mappingSchema: {
        ...currentState,
        ...(userDecision ? { userDecision } : {}),
        lastImportError: {
          code: errorCode,
          message: safeMessage,
          ...(conflict ? { conflict } : {}),
        },
      } as Record<string, unknown>,
    }).where(and(
      eq(evidenceItemsTable.id, req.params.evidenceId), eq(evidenceItemsTable.profileId, req.params.profileId),
      eq(evidenceItemsTable.importStatus, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
    )).catch(() => undefined);
    if (conflict) {
      res.status(409).json({ error: safeMessage, code: errorCode, conflict, rolledBack: true });
      return;
    }
    res.status(500).json({ error: safeMessage, code: errorCode, rolledBack: true });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/process-batch — retired legacy importer
router.post("/profiles/:profileId/evidence/:evidenceId/process-batch", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Kept as an explicit failure rather than a compatibility alias: the old
  // endpoint could not express sheet selection, filing scope, or unresolved
  // row acknowledgements, so it must not bypass the confirmation gate.
  res.status(410).json({ error: "Use the confirmed spreadsheet review flow before importing." });
  return;
  /*
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
    if (evidenceItem.workflowVersion >= 2) {
      res.status(422).json({ error: "Original documents use the review workflow, not spreadsheet import." }); return;
    }
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
  */
});

// PATCH /profiles/:profileId/evidence/:evidenceId/review — retain corrections
// to a document candidate without changing any financial record.
router.patch("/profiles/:profileId/evidence/:evidenceId/review", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    extractedData: z.record(z.string(), z.unknown()).optional(),
    category: z.string().min(1).optional(),
  }).strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid review" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidence = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidence || evidence.workflowVersion < 2 || evidence.documentLifecycle !== "active") {
      res.status(404).json({ error: "Active reviewable document not found" }); return;
    }
    const [updated] = await db.transaction(async (tx) => {
      const [item] = await tx.update(evidenceItemsTable).set({
        ...(body.data.extractedData ? { extractedData: body.data.extractedData } : {}),
        ...(body.data.category ? { category: body.data.category } : {}),
        status: "needs_review",
        reviewState: "reviewed",
      }).where(and(
        eq(evidenceItemsTable.id, evidence.id),
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.workflowVersion, 2),
        eq(evidenceItemsTable.documentLifecycle, "active"),
      )).returning();
      if (!item) return [];
      await tx.insert(evidenceAuditEventsTable).values({
        profileId: profile.id, evidenceId: evidence.id, actorUserId: req.user.id,
        eventType: "review_saved", details: { correctedCandidate: Boolean(body.data.extractedData) },
      });
      return [item];
    });
    if (!updated) { res.status(409).json({ error: "This document is no longer active" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to save evidence review");
    res.status(500).json({ error: "Failed to save evidence review" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/confirm-transaction
// The only M9 path that writes Financial Memory. A request ID makes retries
// idempotent while the evidence review itself remains purely supporting data.
router.post("/profiles/:profileId/evidence/:evidenceId/confirm-transaction", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    idempotencyKey: z.string().uuid(),
    date: z.string().min(1),
    description: z.string().trim().min(1),
    amount: z.number().refine((value) => value !== 0, "Amount must be non-zero"),
    category: z.string().trim().min(1).default("other"),
    taxTreatment: z.string().trim().min(1),
    allowablePercentage: z.number().min(0).max(100).default(100),
  }).strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid financial confirmation" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidence = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidence || evidence.workflowVersion < 2 || evidence.documentLifecycle !== "active") {
      res.status(404).json({ error: "Active reviewable document not found" }); return;
    }
    const isIncome = body.data.taxTreatment === "income";
    const canonicalAmount = isIncome ? Math.abs(body.data.amount) : -Math.abs(body.data.amount);
    const deductible = body.data.taxTreatment !== "non_deductible" && !isIncome;
    const allowableAmount = isIncome
      ? canonicalAmount
      : deductible ? -Math.abs(canonicalAmount) * (body.data.allowablePercentage / 100) : 0;
    const matchesConfirmation = (candidate: typeof transactionsTable.$inferSelect) =>
      candidate.date === body.data.date
      && candidate.description === body.data.description
      && Number(candidate.amount) === canonicalAmount
      && candidate.recordType === (isIncome ? "income" : "expense")
      && candidate.category === body.data.category
      && candidate.taxTreatment === body.data.taxTreatment
      && candidate.accountingCategory === body.data.category
      && Number(candidate.allowablePercentage) === (isIncome ? 100 : body.data.allowablePercentage)
      && Number(candidate.allowableAmount) === allowableAmount
      && candidate.source === "manual"
      && candidate.evidenceId === null
      && candidate.evidenceTier === 1
      && candidate.userOverride === true;
    const hasConfirmationBridge = async (transactionId: string) => {
      const [confirmation] = await db.select({ id: evidenceTransactionLinksTable.id })
        .from(evidenceTransactionLinksTable).where(and(
          eq(evidenceTransactionLinksTable.profileId, profile.id),
          eq(evidenceTransactionLinksTable.evidenceId, evidence.id),
          eq(evidenceTransactionLinksTable.transactionId, transactionId),
          eq(evidenceTransactionLinksTable.linkReason, "explicit_financial_confirmation"),
        )).limit(1);
      return Boolean(confirmation);
    };
    const [existing] = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.id, body.data.idempotencyKey),
      eq(transactionsTable.profileId, profile.id),
    )).limit(1);
    if (existing) {
      if (!await hasConfirmationBridge(existing.id) || !matchesConfirmation(existing)) {
        res.status(409).json({ error: "This confirmation key belongs to a different financial outcome" });
        return;
      }
      res.json(existing);
      return;
    }

    const [transaction] = await db.transaction(async (tx) => {
      const [owned] = await tx.select().from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.id, evidence.id),
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.documentLifecycle, "active"),
      )).for("update");
      if (!owned) return [];
      // The explicit treatment determines direction for a document candidate.
      // People naturally type “12.34” for a £12.34 receipt; keeping it positive
      // must not turn a deductible expense into income.
      const [created] = await tx.insert(transactionsTable).values({
        id: body.data.idempotencyKey,
        profileId: profile.id,
        date: body.data.date,
        description: body.data.description,
        amount: canonicalAmount,
        recordType: isIncome ? "income" : "expense",
        category: body.data.category,
        taxTreatment: body.data.taxTreatment,
        source: "manual",
        // M9 uses the bridge table as its sole relationship. The singular
        // legacy column stays reserved for workflow-1 compatibility rows.
        evidenceId: null,
        evidenceTier: 1,
        userOverride: true,
        accountingCategory: body.data.category,
        allowablePercentage: isIncome ? 100 : body.data.allowablePercentage,
        allowableAmount,
      }).returning();
      await tx.insert(evidenceTransactionLinksTable).values({
        profileId: profile.id, evidenceId: evidence.id, transactionId: created.id,
        linkReason: "explicit_financial_confirmation",
      }).onConflictDoNothing();
      // A confirmed document is no longer review work. Keep this terminal
      // state alongside the active bridge link so a fresh client load cannot
      // mistake a saved review for a document that still needs confirming.
      await tx.update(evidenceItemsTable).set({
        status: "processed",
        reviewState: "confirmed",
      }).where(eq(evidenceItemsTable.id, evidence.id));
      await tx.insert(evidenceAuditEventsTable).values({
        profileId: profile.id, evidenceId: evidence.id, actorUserId: req.user.id,
        eventType: "financial_confirmation_created",
        details: { transactionId: created.id, idempotencyKey: body.data.idempotencyKey },
      });
      return [created];
    });
    if (!transaction) { res.status(409).json({ error: "This document is no longer available" }); return; }
    res.status(201).json(transaction);
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-evidence reconciliation scan failed"));
  } catch (err) {
    const dbError = err as { cause?: { code?: string } };
    if (dbError.cause?.code === "23505") {
      const [existing] = await db.select().from(transactionsTable).where(and(
        eq(transactionsTable.id, body.data.idempotencyKey),
        eq(transactionsTable.profileId, req.params.profileId),
      ));
       const isIncome = body.data.taxTreatment === "income";
       const canonicalAmount = isIncome ? Math.abs(body.data.amount) : -Math.abs(body.data.amount);
       const deductible = body.data.taxTreatment !== "non_deductible" && !isIncome;
       const allowableAmount = isIncome
         ? canonicalAmount
         : deductible ? -Math.abs(canonicalAmount) * (body.data.allowablePercentage / 100) : 0;
       const [confirmation] = existing ? await db.select({ id: evidenceTransactionLinksTable.id })
         .from(evidenceTransactionLinksTable).where(and(
           eq(evidenceTransactionLinksTable.profileId, req.params.profileId),
           eq(evidenceTransactionLinksTable.evidenceId, req.params.evidenceId),
           eq(evidenceTransactionLinksTable.transactionId, existing.id),
           eq(evidenceTransactionLinksTable.linkReason, "explicit_financial_confirmation"),
         )).limit(1) : [];
       if (existing && confirmation
         && existing.date === body.data.date
         && existing.description === body.data.description
         && Number(existing.amount) === canonicalAmount
         && existing.recordType === (isIncome ? "income" : "expense")
         && existing.category === body.data.category
         && existing.taxTreatment === body.data.taxTreatment
         && existing.accountingCategory === body.data.category
         && Number(existing.allowablePercentage) === (isIncome ? 100 : body.data.allowablePercentage)
         && Number(existing.allowableAmount) === allowableAmount
         && existing.source === "manual"
         && existing.evidenceId === null
         && existing.evidenceTier === 1
         && existing.userOverride === true) { res.json(existing); return; }
       if (existing) { res.status(409).json({ error: "This confirmation key belongs to a different financial outcome" }); return; }
    }
    req.log.error(err, "Failed to confirm evidence transaction");
    res.status(500).json({ error: "Failed to confirm financial record" });
  }
});

router.delete("/profiles/:profileId/evidence/:evidenceId/links/:transactionId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [link] = await db.update(evidenceTransactionLinksTable).set({
      linkStatus: "detached", detachedAt: new Date(),
    }).where(and(
      eq(evidenceTransactionLinksTable.profileId, profile.id),
      eq(evidenceTransactionLinksTable.evidenceId, req.params.evidenceId),
      eq(evidenceTransactionLinksTable.transactionId, req.params.transactionId),
      eq(evidenceTransactionLinksTable.linkStatus, "active"),
    )).returning();
    if (!link) { res.status(404).json({ error: "Active evidence link not found" }); return; }
    await addEvidenceAudit(profile.id, link.evidenceId, req.user.id, "transaction_link_detached", { transactionId: link.transactionId });
    res.status(204).end();
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-evidence reconciliation scan failed"));
  } catch (err) {
    req.log.error(err, "Failed to detach evidence");
    res.status(500).json({ error: "Failed to detach evidence" });
  }
});

router.get("/profiles/:profileId/transactions/:transactionId/evidence-links", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [transaction] = await db.select({ id: transactionsTable.id }).from(transactionsTable).where(and(
      eq(transactionsTable.id, req.params.transactionId),
      eq(transactionsTable.profileId, profile.id),
    )).limit(1);
    if (!transaction) { res.status(404).json({ error: "Transaction not found" }); return; }
    const links = await db.select({
      id: evidenceTransactionLinksTable.id,
      evidenceId: evidenceTransactionLinksTable.evidenceId,
      linkedAt: evidenceTransactionLinksTable.createdAt,
      filename: evidenceItemsTable.filename,
      mimeType: evidenceItemsTable.mimeType,
      documentLifecycle: evidenceItemsTable.documentLifecycle,
    }).from(evidenceTransactionLinksTable)
      .innerJoin(evidenceItemsTable, eq(evidenceTransactionLinksTable.evidenceId, evidenceItemsTable.id))
      .where(and(
        eq(evidenceTransactionLinksTable.profileId, profile.id),
        eq(evidenceTransactionLinksTable.transactionId, transaction.id),
        eq(evidenceTransactionLinksTable.linkStatus, "active"),
      ))
      .orderBy(desc(evidenceTransactionLinksTable.createdAt));
    res.json(links);
  } catch (err) {
    req.log.error(err, "Failed to list transaction evidence links");
    res.status(500).json({ error: "Failed to list linked documents" });
  }
});

router.post("/profiles/:profileId/evidence/:evidenceId/tombstone", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [updated] = await db.update(evidenceItemsTable).set({
      documentLifecycle: "tombstoned",
    }).where(and(
      eq(evidenceItemsTable.id, req.params.evidenceId),
      eq(evidenceItemsTable.profileId, profile.id),
      eq(evidenceItemsTable.workflowVersion, 2),
      eq(evidenceItemsTable.documentLifecycle, "active"),
    )).returning();
    if (!updated) { res.status(404).json({ error: "Active document not found" }); return; }
    await addEvidenceAudit(profile.id, updated.id, req.user.id, "document_tombstoned", {});
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to tombstone evidence");
    res.status(500).json({ error: "Failed to tombstone document" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/replace-spreadsheet
// A failed spreadsheet keeps its identity during replacement. Existing source
// rows therefore remain fenced, so a corrected file cannot silently duplicate
// a row that was already associated with the failed upload.
router.post("/profiles/:profileId/evidence/:evidenceId/replace-spreadsheet", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    objectPath: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1),
  }).strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid replacement spreadsheet" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [upload] = await db.select().from(privateUploadObjectsTable).where(and(
      eq(privateUploadObjectsTable.objectPath, body.data.objectPath),
      eq(privateUploadObjectsTable.userId, req.user.id),
    )).limit(1);
    const [anyBinding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(eq(privateUploadBindingsTable.objectId, upload.id)).limit(1) : [];
    if (upload && !anyBinding) {
      await db.insert(privateUploadBindingsTable).values({
        profileId: profile.id, objectId: upload.id, userId: req.user.id,
      }).onConflictDoNothing();
    }
    const [binding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(and(
        eq(privateUploadBindingsTable.objectId, upload.id),
        eq(privateUploadBindingsTable.profileId, profile.id),
        eq(privateUploadBindingsTable.userId, req.user.id),
      )).limit(1) : [];
    if (!upload || !binding) { res.status(404).json({ error: "Uploaded replacement not found" }); return; }

    const [replacement] = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.id, req.params.evidenceId),
        eq(evidenceItemsTable.profileId, profile.id),
      )).for("update");
      if (!current) return [];
      const now = new Date();
      const activeLease = current.importStatus === "processing"
        && (!current.processingLeaseExpiresAt || current.processingLeaseExpiresAt > now);
      if (
        activeLease
        || current.workflowVersion >= 2
        || current.evidenceType === "document"
        || current.importStatus !== "error"
      ) return [];
      const [updated] = await tx.update(evidenceItemsTable).set({
        filename: body.data.filename,
        objectPath: body.data.objectPath,
        mimeType: body.data.mimeType,
        contentHash: upload.contentHash,
        objectSize: upload.objectSize,
        status: "received",
        importStatus: "idle",
        mappingSchema: null,
        totalRows: 0,
        processedRows: 0,
        autoPostedRows: 0,
        inboxRows: 0,
        skippedRows: 0,
        processingLeaseExpiresAt: null,
        processingToken: null,
      }).where(eq(evidenceItemsTable.id, current.id)).returning();
      await tx.insert(evidenceAuditEventsTable).values({
        profileId: profile.id,
        evidenceId: current.id,
        actorUserId: req.user.id,
        eventType: "spreadsheet_replaced",
        details: { previousFilename: current.filename, replacementFilename: body.data.filename },
      });
      return [updated];
    });
    if (!replacement) {
      res.status(409).json({ error: "This spreadsheet cannot be replaced while it is processing or after it has been completed." });
      return;
    }
    res.json(replacement);
  } catch (err) {
    req.log.error(err, "Failed to replace spreadsheet");
    res.status(500).json({ error: "Failed to replace spreadsheet" });
  }
});

router.post("/profiles/:profileId/evidence/:evidenceId/replace", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    objectPath: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1),
  }).strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid replacement document" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [upload] = await db.select().from(privateUploadObjectsTable).where(and(
      eq(privateUploadObjectsTable.objectPath, body.data.objectPath),
      eq(privateUploadObjectsTable.userId, req.user.id),
    )).limit(1);
    const [anyBinding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(eq(privateUploadBindingsTable.objectId, upload.id)).limit(1) : [];
    if (upload && upload.userId === req.user.id && !anyBinding) {
      await db.insert(privateUploadBindingsTable).values({
        profileId: profile.id, objectId: upload.id, userId: req.user.id,
      }).onConflictDoNothing();
    }
    const [binding] = upload ? await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(and(
        eq(privateUploadBindingsTable.objectId, upload.id),
        eq(privateUploadBindingsTable.profileId, profile.id),
        eq(privateUploadBindingsTable.userId, req.user.id),
      )).limit(1) : [];
    if (!upload || !binding) { res.status(404).json({ error: "Uploaded replacement not found" }); return; }
    const [replacement] = await db.transaction(async (tx) => {
      const [original] = await tx.update(evidenceItemsTable).set({
        documentLifecycle: "replaced",
      }).where(and(
        eq(evidenceItemsTable.id, req.params.evidenceId),
        eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.workflowVersion, 2),
        eq(evidenceItemsTable.documentLifecycle, "active"),
      )).returning();
      if (!original) return [];
      const [created] = await tx.insert(evidenceItemsTable).values({
        profileId: profile.id, filename: body.data.filename, objectPath: body.data.objectPath,
        mimeType: body.data.mimeType, category: original.category, evidenceType: "document",
        workflowVersion: 2, reviewState: "pending", status: "received",
        contentHash: upload.contentHash, objectSize: upload.objectSize, replacementOfEvidenceId: original.id,
      }).returning();
      await tx.insert(evidenceAuditEventsTable).values([
        { profileId: profile.id, evidenceId: original.id, actorUserId: req.user.id, eventType: "document_replaced", details: { replacementEvidenceId: created.id } },
        { profileId: profile.id, evidenceId: created.id, actorUserId: req.user.id, eventType: "replacement_registered", details: { replacedEvidenceId: original.id } },
      ]);
      return [created];
    });
    if (!replacement) { res.status(404).json({ error: "Active document not found" }); return; }
    res.status(201).json(replacement);
  } catch (err) {
    req.log.error(err, "Failed to replace evidence");
    res.status(500).json({ error: "Failed to replace document" });
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
    if (evidenceItem.workflowVersion >= 2 && evidenceItem.documentLifecycle === "active") {
      const attached = await db.transaction(async (tx) => {
        const [activeEvidence] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.profileId, profile.id),
          eq(evidenceItemsTable.workflowVersion, 2),
          eq(evidenceItemsTable.documentLifecycle, "active"),
        )).for("update");
        if (!activeEvidence) return false;
        const [existingLink] = await tx.select().from(evidenceTransactionLinksTable).where(and(
          eq(evidenceTransactionLinksTable.profileId, profile.id),
          eq(evidenceTransactionLinksTable.evidenceId, evidenceItem.id),
          eq(evidenceTransactionLinksTable.transactionId, transaction.id),
        )).limit(1);
        if (existingLink) {
          await tx.update(evidenceTransactionLinksTable).set({ linkStatus: "active", detachedAt: null })
            .where(eq(evidenceTransactionLinksTable.id, existingLink.id));
        } else {
          await tx.insert(evidenceTransactionLinksTable).values({
            profileId: profile.id, evidenceId: evidenceItem.id, transactionId: transaction.id,
          });
        }
        await tx.insert(evidenceAuditEventsTable).values({
          profileId: profile.id, evidenceId: evidenceItem.id, actorUserId: req.user.id,
          eventType: "transaction_linked", details: { transactionId: transaction.id },
        });
        return true;
      });
      if (!attached) { res.status(409).json({ error: "This document is no longer active" }); return; }
      res.json(transaction);
      void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-evidence reconciliation scan failed"));
      return;
    }
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
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-evidence reconciliation scan failed"));
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

async function addEvidenceAudit(
  profileId: string,
  evidenceId: string,
  actorUserId: string,
  eventType: string,
  details: Record<string, unknown>,
) {
  await db.insert(evidenceAuditEventsTable).values({
    profileId, evidenceId, actorUserId, eventType, details,
  });
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
