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
  inboxItemsTable, transactionsTable, profilesTable, spreadsheetRowOutcomesTable, spreadsheetSemanticSessionsTable,
  spreadsheetSemanticProviderAttemptsTable, spreadsheetSemanticExecutionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireProfile } from "./profiles.js";
import { scanProfile } from "./reconciliation.js";
import {
  analyseSpreadsheetWithAI, extractFromImageFile, extractFromText, isConfigured, isSpreadsheetDirectProviderConfigured, detectColumnSchema, invalidateSpreadsheetAICache,
  type SpreadsheetSemanticSession,
  type ExtractionContext, type ExtractedData, type MappingSchema,
} from "../lib/ai.js";
import { spreadsheetImportPlanSchema } from "../lib/spreadsheet-semantic-contract.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { analyseSpreadsheet, analyseSpreadsheetStructure, inspectSpreadsheet, parseSpreadsheet, normaliseCell, mapSpreadsheetRow, ukTaxYear, looksLikeBalanceRow, type RowDisposition } from "../lib/spreadsheet.js";

const router = Router();
const storageService = new ObjectStorageService();
const PROCESSING_LEASE_MS = 10 * 60 * 1000;
const SEMANTIC_SESSION_LEASE_MS = 2 * 60 * 1000;
const MAX_AUTOMATIC_RETRY_EXECUTIONS = 2;
const SPREADSHEET_SOURCE_ROW_CONFLICT_CODE = "source_row_conflict";
const SPREADSHEET_IMPORT_FAILURE_CODE = "spreadsheet_import_failed";
const spreadsheetDetectionModeInput = z.object({
  mode: z.enum(["retry_automatic", "manual_recovery"]).optional(),
}).strict();

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

function semanticSessionForAI(record: typeof spreadsheetSemanticSessionsTable.$inferSelect): SpreadsheetSemanticSession {
  const providerAttempts = Array.isArray(record.providerAttempts)
    ? record.providerAttempts as SpreadsheetSemanticSession["providerAttempts"]
    : [];
  return {
    schemaVersion: record.schemaVersion as SpreadsheetSemanticSession["schemaVersion"],
    contentHash: record.sourceContentHash,
    stage: record.stage as SpreadsheetSemanticSession["stage"],
    continuationToken: record.continuationToken,
    payload: record.requestPayload,
    contextHistory: Array.isArray(record.contextHistory) ? record.contextHistory as SpreadsheetSemanticSession["contextHistory"] : [],
    providerCalls: record.providerCalls,
    providerAttempts,
    currentPlan: spreadsheetImportPlanSchema.safeParse(record.currentPlan).success
      ? spreadsheetImportPlanSchema.parse(record.currentPlan)
      : null,
    executionId: record.currentExecutionId,
    executionNumber: record.executionNumber,
    attemptOffset: providerAttempts.length,
  };
}

function semanticExecutionToken(sourceContentHash: string, executionNumber: number) {
  return createHash("sha256")
    .update(`${sourceContentHash}:spreadsheet-semantic.v2:execution:${executionNumber}`)
    .digest("hex")
    .slice(0, 32);
}

async function ensureSemanticExecution(
  record: typeof spreadsheetSemanticSessionsTable.$inferSelect,
) {
  if (record.currentExecutionId) return record;
  const executionNumber = Math.max(1, record.executionNumber);
  const [created] = await db.insert(spreadsheetSemanticExecutionsTable).values({
    semanticSessionId: record.id,
    profileId: record.profileId,
    evidenceId: record.evidenceId,
    workIdentity: record.workIdentity,
    executionNumber,
    sourceContentHash: record.sourceContentHash,
    sourceObjectPath: record.sourceObjectPath,
    schemaVersion: record.schemaVersion,
    status: record.status,
    stage: record.stage,
    continuationToken: record.continuationToken,
    requestPayload: record.requestPayload,
    contextHistory: record.contextHistory,
    providerCalls: record.providerCalls,
    currentPlan: record.currentPlan,
    claimToken: record.claimToken,
    leaseExpiresAt: record.leaseExpiresAt,
    completedAt: ["complete", "incomplete", "invalidated"].includes(record.status) ? new Date() : null,
  }).onConflictDoNothing().returning();
  const execution = created ?? (await db.select().from(spreadsheetSemanticExecutionsTable).where(and(
    eq(spreadsheetSemanticExecutionsTable.semanticSessionId, record.id),
    eq(spreadsheetSemanticExecutionsTable.executionNumber, executionNumber),
  )).limit(1))[0];
  if (!execution) throw new Error("semantic_execution_missing");
  const [bound] = await db.update(spreadsheetSemanticSessionsTable).set({
    currentExecutionId: execution.id,
    updatedAt: new Date(),
  }).where(and(
    eq(spreadsheetSemanticSessionsTable.id, record.id),
    eq(spreadsheetSemanticSessionsTable.workIdentity, record.workIdentity),
    isNull(spreadsheetSemanticSessionsTable.currentExecutionId),
  )).returning();
  return bound ?? record;
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
}).strict();

const confirmedSpreadsheetInput = z.object({
  confirmation: z.literal(true),
  reviewRevision: z.string().regex(/^[a-f0-9]{64}$/),
  semanticPlanIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  selectedSheetIds: z.array(z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/)).min(1).max(100),
  sheetMappings: z.record(mappingSchemaInput),
  sheetRoleOverrides: z.record(z.enum(["transactional", "non_transactional", "mixed", "unknown"])).default({}),
  sheetResolutions: z.record(z.enum(["include_income", "include_expense", "reference_only", "duplicate_sheet", "leave_out"])).default({}),
  filingScope: z.array(z.string().regex(/^\d{4}-\d{4}$/)).min(1).max(20),
  excludedRowRefs: z.array(z.object({
    sheetId: z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/),
    rowNumber: z.number().int().positive(),
  }).strict()).max(100_000).default([]),
  preTradingStartMode: z.enum(["retain", "exclude"]).default("exclude"),
  outsideScopeMode: z.enum(["retain", "exclude"]).default("exclude"),
}).strict();

const spreadsheetDraftInput = confirmedSpreadsheetInput.omit({
  confirmation: true,
  reviewRevision: true,
  semanticPlanIdentity: true,
});

type SpreadsheetReviewDraft = z.infer<typeof spreadsheetDraftInput>;

type SpreadsheetReviewIssue = {
  sheetId?: string;
  worksheet?: string;
  rowNumber?: number;
  field?: "date" | "amount" | "description" | "tax_year" | "selection";
  message: string;
};

function inputReviewIssues(issues: Array<{ path: PropertyKey[]; message: string }>): SpreadsheetReviewIssue[] {
  const result = new Map<string, SpreadsheetReviewIssue>();
  for (const issue of issues) {
    const [section, sheetId, columnSection, columnName] = issue.path;
    const missingNamedColumn = issue.message === "A date column is required" ? "date"
      : issue.message === "A description column is required" ? "description"
        : issue.message === "An amount, debit, or credit column is required" ? "amount"
          : null;
    const mappedField = section === "sheetMappings" && missingNamedColumn
      ? missingNamedColumn
      : section === "sheetMappings" && columnSection === "columns"
        ? columnName === "date" ? "date" : columnName === "description" || columnName === "category" ? "description" : "amount"
      : section === "filingScope" ? "tax_year"
        : "selection";
    const key = `${String(sheetId ?? "")}:${mappedField}`;
    if (!result.has(key)) {
      result.set(key, {
        ...(typeof sheetId === "string" && sheetId.startsWith("sheet_") ? { sheetId } : {}),
        field: mappedField,
        message: mappedField === "tax_year"
          ? "Choose at least one tax year based on the dates in this spreadsheet."
          : mappedField === "date"
            ? "Tell us which column is the date for this sheet."
            : mappedField === "amount"
              ? "Tell us which column contains the money amount for this sheet."
              : mappedField === "description"
                ? "Tell us which column says what each entry is for."
                : "Answer the remaining sheet questions before importing.",
      });
    }
  }
  return [...result.values()];
}

function requiredMappingIssues(mapping: z.infer<typeof mappingSchemaInput>, sheetId: string, worksheet?: string): SpreadsheetReviewIssue[] {
  const result: SpreadsheetReviewIssue[] = [];
  if (mapping.columns.date === undefined) result.push({ sheetId, worksheet, field: "date", message: "Tell us which column is the date for this sheet." });
  if (mapping.columns.description === undefined && mapping.columns.category === undefined) result.push({ sheetId, worksheet, field: "description", message: "Tell us which column says what each entry is for." });
  if (mapping.columns.amount === undefined && mapping.columns.debit === undefined && mapping.columns.credit === undefined) {
    result.push({ sheetId, worksheet, field: "amount", message: "Tell us which column contains the money amount for this sheet." });
  }
  return result;
}

function spreadsheetSourceRowIndex(sheetIndex: number, rowNumber: number) {
  return sheetIndex * 1_100_000 + rowNumber;
}

function spreadsheetMovementFingerprint(date: string, amount: number, description: string) {
  return `${date}|${Math.round(amount * 100)}|${normaliseCell(description).toLowerCase()}`;
}

function semanticPlanIdentity(contentHash: string | null | undefined, plan: unknown) {
  return createHash("sha256").update(JSON.stringify({
    contentHash: contentHash ?? "no-hash",
    plan: plan ?? null,
  })).digest("hex");
}

function sameConfirmedReview(
  draft: Record<string, unknown>,
  submitted: z.infer<typeof confirmedSpreadsheetInput>,
) {
  const actual = {
    selectedSheetIds: draft.selectedSheetIds,
    sheetMappings: draft.sheetMappings,
    sheetRoleOverrides: draft.sheetRoleOverrides ?? {},
    sheetResolutions: draft.sheetResolutions ?? {},
    filingScope: draft.filingScope,
    excludedRowRefs: draft.excludedRowRefs ?? [],
    preTradingStartMode: draft.preTradingStartMode ?? "exclude",
    outsideScopeMode: draft.outsideScopeMode ?? "exclude",
  };
  const expected = {
    selectedSheetIds: submitted.selectedSheetIds,
    sheetMappings: submitted.sheetMappings,
    sheetRoleOverrides: submitted.sheetRoleOverrides,
    sheetResolutions: submitted.sheetResolutions,
    filingScope: submitted.filingScope,
    excludedRowRefs: submitted.excludedRowRefs,
    preTradingStartMode: submitted.preTradingStartMode,
    outsideScopeMode: submitted.outsideScopeMode,
  };
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return canonical(actual) === canonical(expected);
}

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
    if (!isSpreadsheetDirectProviderConfigured() && evidenceItem.workflowVersion >= 2) {
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

// PATCH /profiles/:profileId/evidence/:evidenceId/spreadsheet-review — persist
// a user-owned draft mapping before confirmation. AI suggestions are never
// allowed to replace this state on a later inspection.
router.patch("/profiles/:profileId/evidence/:evidenceId/spreadsheet-review", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = spreadsheetDraftInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "We could not save this choice yet.",
      issues: inputReviewIssues(body.error.issues),
    });
    return;
  }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const evidenceItem = await getEvidenceItem(profile.id, req.params.evidenceId);
    if (!evidenceItem) { res.status(404).json({ error: "Evidence item not found" }); return; }
    if (evidenceItem.workflowVersion >= 2 || evidenceItem.importStatus === "done") {
      res.status(409).json({ error: "This spreadsheet review can no longer be edited." }); return;
    }
    const state = (evidenceItem.mappingSchema as Record<string, unknown> | null) ?? {};
    const savedPlan = spreadsheetImportPlanSchema.safeParse(state.aiProposal);
    const savedRecoveryState = (state.aiStatus as { recoveryState?: unknown } | undefined)?.recoveryState;
    if ((savedRecoveryState === "automatic_unavailable"
      || (savedPlan.success && savedPlan.data.status !== "complete"))
      && savedRecoveryState !== "manual_recovery") {
      res.status(409).json({
        error: "Choose manual recovery or retry automatic review before saving sheet choices.",
        issues: [{ field: "selection", message: "Automatic review is unavailable. Select “Start manual recovery” before choosing worksheet mappings." }],
      });
      return;
    }
    const file = await storageService.getObjectEntityFile(evidenceItem.objectPath);
    const [buffer] = await file.download();
    const workbook = inspectSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    const sourceContentHash = workbook.contentHash ?? createHash("sha256").update(buffer).digest("hex");
    const knownSheets = new Map(workbook.sheets.map((sheet) => [sheet.sheetId, sheet]));
    for (const sheetId of body.data.selectedSheetIds) {
      const sheet = knownSheets.get(sheetId);
      const mapping = body.data.sheetMappings[sheetId];
      if (!sheet || !mapping) {
        res.status(400).json({
          error: "We need one more choice before saving.",
          issues: [{ sheetId, worksheet: sheet?.displayName, field: "selection", message: "Tell us how to read this sheet before including it." }],
        });
        return;
      }
        const missing = requiredMappingIssues(mapping, sheetId);
        if (missing.length) {
          res.status(400).json({ error: "We need one more choice before saving.", issues: missing });
          return;
        }
      const indices = Object.values(mapping.columns).filter((value): value is number => value !== undefined);
      if (mapping.headerRow >= sheet.rowCount || indices.some((index) => index >= sheet.columnCount)) {
        res.status(400).json({
          error: "A saved column choice no longer matches this sheet.",
          issues: [{ sheetId, worksheet: sheet.displayName, field: "selection", message: "Check the named columns for this sheet and choose them again." }],
        });
        return;
      }
    }
    const [semanticSession] = await db.select().from(spreadsheetSemanticSessionsTable).where(and(
      eq(spreadsheetSemanticSessionsTable.evidenceId, evidenceItem.id),
      eq(spreadsheetSemanticSessionsTable.profileId, profile.id),
    ));
    const planIdentity = semanticPlanIdentity(sourceContentHash, savedPlan.success ? savedPlan.data : null);
    const plannedSheets = new Map((savedPlan.success ? savedPlan.data.sheets : []).map((sheet) => [sheet.sheetId, sheet]));
    for (const sheetId of body.data.selectedSheetIds) {
      const planned = plannedSheets.get(sheetId);
      const resolution = body.data.sheetResolutions[sheetId];
      const mapping = body.data.sheetMappings[sheetId];
      if (planned && ['reference', 'summary', 'duplicate', 'excluded'].includes(planned.disposition)
        && mapping && requiredMappingIssues(mapping, sheetId).length === 0
        && resolution !== 'include_income' && resolution !== 'include_expense') {
        res.status(400).json({
          error: "This sheet was not identified as individual money records.",
          issues: [{ sheetId, field: "selection", message: "Choose “include as income” or “include as expense” as an explicit manual recovery decision before assigning transaction columns." }],
        });
        return;
      }
    }
    const semanticRoleOverrides: Record<string, "transactional" | "non_transactional" | "mixed" | "unknown"> = Object.fromEntries((savedPlan.success ? savedPlan.data.sheets : []).map((sheet) => [
      sheet.sheetId,
      sheet.disposition === "transactional" ? "transactional"
        : sheet.disposition === "unresolved" || sheet.disposition === "not_analysed" ? "unknown" : "non_transactional",
    ]));
    const semanticDispositions = Object.fromEntries((savedPlan.success ? savedPlan.data.sheets : []).map((sheet) => [sheet.sheetId, sheet.disposition]));
    const effectiveAnalysis = analyseSpreadsheet(workbook, {
      selectedSheetIds: body.data.selectedSheetIds,
      roleOverrides: { ...semanticRoleOverrides, ...body.data.sheetRoleOverrides },
      sheetMappings: body.data.sheetMappings,
      tradingStartDate: profile.businessStartDate ?? null,
      decisionSource: "user",
      finalDispositions: semanticDispositions,
      semanticMode: "structural",
    });
    const effectiveInvalidRows = new Set(
      effectiveAnalysis.sheets
        .filter((sheet) => sheet.selected)
        .flatMap((sheet) => sheet.rows)
        .filter((row) => row.primaryDisposition === "invalid")
        .map((row) => `${row.sheetId}:${row.sourceRow}`),
    );
    const effectiveDraft = {
      ...body.data,
      filingScope: body.data.filingScope.length ? body.data.filingScope : effectiveAnalysis.taxYears,
      excludedRowRefs: body.data.excludedRowRefs.filter((row) => effectiveInvalidRows.has(`${row.sheetId}:${row.rowNumber}`)),
    };
    const revision = createHash("sha256").update(JSON.stringify({
      ...effectiveDraft, businessStartDate: profile.businessStartDate ?? null,
    })).digest("hex");
    const history = Array.isArray(state.reviewRevisionHistory) ? state.reviewRevisionHistory.slice(-19) : [];
    const reviewDraft = {
      ...effectiveDraft,
      decisionSources: {
        sheetRoleOverrides: Object.fromEntries(
          Object.keys(body.data.sheetRoleOverrides ?? {}).map((sheetId) => [sheetId, "user"]),
        ),
        selectedSheetIds: "user",
        sheetMappings: "user",
        filingScope: "user",
        sheetResolutions: "user",
        manualOverrides: Object.fromEntries(body.data.selectedSheetIds
          .filter((sheetId) => {
            const disposition = plannedSheets.get(sheetId)?.disposition;
            return disposition && ['reference', 'summary', 'duplicate', 'excluded'].includes(disposition);
          })
          .map((sheetId) => [sheetId, {
            source: "manual_recovery",
            acknowledgement: body.data.sheetResolutions[sheetId],
            reason: "The reviewer explicitly included a sheet outside the AI transaction plan.",
          }])),
      },
      semanticPlanIdentity: planIdentity,
      sourceContentHash,
      sourceObjectPath: evidenceItem.objectPath,
      semanticSchemaVersion: savedPlan.success && savedPlan.data.status === "complete"
        ? savedPlan.data.schemaVersion
        : "manual-recovery",
      semanticSessionId: semanticSession?.id ?? null,
      semanticWorkIdentity: semanticSession?.workIdentity ?? null,
      mappingRevision: revision,
      savedAt: new Date().toISOString(),
      actorUserId: req.user.id,
    };
    const [saved] = await db.update(evidenceItemsTable).set({
      mappingSchema: {
        ...state,
        deterministicFindings: effectiveAnalysis,
        reviewDraft,
        reviewRevisionHistory: [...history, {
          mappingRevision: revision,
          semanticPlanIdentity: planIdentity,
          sourceContentHash,
          sourceObjectPath: evidenceItem.objectPath,
          semanticSchemaVersion: reviewDraft.semanticSchemaVersion,
          semanticSessionId: reviewDraft.semanticSessionId,
          semanticWorkIdentity: reviewDraft.semanticWorkIdentity,
          savedAt: reviewDraft.savedAt,
          actorUserId: req.user.id,
        }],
        semanticSession: semanticSession ? {
          id: semanticSession.id,
          workIdentity: semanticSession.workIdentity,
          status: "invalidated_by_review",
        } : null,
      } as Record<string, unknown>,
      importStatus: "mapping",
    }).where(and(
      eq(evidenceItemsTable.id, evidenceItem.id),
      eq(evidenceItemsTable.profileId, profile.id),
      inArray(evidenceItemsTable.importStatus, ["idle", "mapping", "error"]),
    )).returning();
    if (!saved) { res.status(409).json({ error: "This spreadsheet is currently being processed. Reload before editing." }); return; }
    invalidateSpreadsheetAICache(sourceContentHash);
    if (semanticSession) {
      await db.update(spreadsheetSemanticSessionsTable).set({
        status: "invalidated",
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticSession.id),
        eq(spreadsheetSemanticSessionsTable.profileId, profile.id),
        inArray(spreadsheetSemanticSessionsTable.status, ["ready", "complete", "incomplete", "invalidated"]),
      ));
    }
    await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_review_saved", {
      mappingRevision: revision,
      semanticPlanIdentity: planIdentity,
      sourceContentHash,
      sourceObjectPath: evidenceItem.objectPath,
      semanticSchemaVersion: reviewDraft.semanticSchemaVersion,
      semanticSessionId: reviewDraft.semanticSessionId,
      semanticWorkIdentity: reviewDraft.semanticWorkIdentity,
    });
    res.json({
      reviewDraft,
      analysis: effectiveAnalysis,
      reviewRevisionHistory: (saved.mappingSchema as Record<string, unknown>)?.reviewRevisionHistory ?? [],
    });
  } catch (err) {
    req.log.error(err, "Failed to save spreadsheet review");
    res.status(500).json({ error: "Failed to save spreadsheet review" });
  }
});

// POST /profiles/:profileId/evidence/:evidenceId/detect-schema — CSV/XLSX column proposal
router.post("/profiles/:profileId/evidence/:evidenceId/detect-schema", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const detectionRequest = spreadsheetDetectionModeInput.safeParse(req.body ?? {});
  if (!detectionRequest.success) { res.status(400).json({ error: "Invalid spreadsheet review action" }); return; }
  const detectionMode = detectionRequest.data.mode;
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
      reviewDraft?: unknown;
      reviewRevisionHistory?: unknown;
      lastImportError?: unknown;
      semanticSession?: SpreadsheetSemanticSession;
    } | null;
    // A user decision is durable and must never be overwritten by a later
    // analysis request. Return the persisted review state instead.
    if (savedState?.deterministicFindings && savedState.mappingSchema && (savedState.userDecision || savedState.reviewDraft)) {
      if (detectionMode === "retry_automatic") {
        res.status(409).json({ error: "Automatic review cannot replace saved manual choices. Continue the saved review instead." });
        return;
      }
      res.json({
        mappingSchema: savedState.mappingSchema,
        previewRows: [],
        analysis: savedState.deterministicFindings,
        aiProposal: savedState.aiProposal ?? null,
        aiStatus: savedState.aiStatus ?? { status: "not_requested" },
        userDecision: savedState.userDecision,
        reviewDraft: savedState.reviewDraft ?? null,
        reviewRevisionHistory: savedState.reviewRevisionHistory ?? [],
        lastImportError: savedState.lastImportError ?? null,
      });
      return;
    }
    const savedAiStatus = savedState?.aiStatus as { status?: unknown; recoveryState?: unknown } | null | undefined;
    if (savedState?.deterministicFindings && savedState.mappingSchema
      && savedAiStatus?.recoveryState === "automatic_unavailable" && !detectionMode) {
      res.json({
        mappingSchema: savedState.mappingSchema,
        previewRows: [],
        analysis: savedState.deterministicFindings,
        aiProposal: savedState.aiProposal ?? null,
        aiStatus: savedState.aiStatus,
        userDecision: savedState.userDecision ?? null,
        reviewDraft: savedState.reviewDraft ?? null,
        reviewRevisionHistory: savedState.reviewRevisionHistory ?? [],
        lastImportError: savedState.lastImportError ?? null,
      });
      return;
    }
    const workbook = inspectSpreadsheet(buffer, evidenceItem.mimeType, evidenceItem.filename);
    const savedDraft = savedState?.reviewDraft as {
      selectedSheetIds?: string[];
      sheetRoleOverrides?: Record<string, "transactional" | "non_transactional" | "mixed" | "unknown">;
      sheetMappings?: Record<string, MappingSchema>;
    } | null | undefined;
    // No local heuristic is allowed to select a sheet or establish its role in
    // the normal path. This is a complete, all-sheet structural audit only.
    const structuralAnalysis = analyseSpreadsheetStructure(workbook);
    if (workbook.totalParserRows === 0) { res.status(400).json({ error: "The spreadsheet contains no rows" }); return; }
    const sourceContentHash = workbook.contentHash ?? createHash("sha256").update(buffer).digest("hex");
    const nowForSession = new Date();
    await db.insert(spreadsheetSemanticSessionsTable).values({
      profileId: profile.id,
      evidenceId: evidenceItem.id,
      sourceContentHash,
      sourceObjectPath: evidenceItem.objectPath,
      schemaVersion: "spreadsheet-semantic.v2",
      status: "ready",
      stage: "workbook_overview",
      continuationToken: semanticExecutionToken(sourceContentHash, 1),
      requestPayload: {},
      contextHistory: [],
      providerCalls: 0,
      providerAttempts: [],
      workIdentity: randomUUID(),
    }).onConflictDoNothing();
    let [semanticRecord] = await db.select().from(spreadsheetSemanticSessionsTable).where(and(
      eq(spreadsheetSemanticSessionsTable.evidenceId, evidenceItem.id),
      eq(spreadsheetSemanticSessionsTable.profileId, profile.id),
    ));
    if (!semanticRecord) throw new Error("semantic_session_missing");
    // Legacy non-ready sessions need an archival execution before a transition
    // can replace their active state. A brand-new ready session creates its
    // first execution only after it has successfully claimed the review.
    if (!semanticRecord.currentExecutionId && semanticRecord.status !== "ready") {
      semanticRecord = await ensureSemanticExecution(semanticRecord);
    }
    let semanticClaimToken: string | null = null;
    let reclaimed = false;
    const sourceChanged = semanticRecord.sourceContentHash !== sourceContentHash
      || semanticRecord.sourceObjectPath !== evidenceItem.objectPath
      || semanticRecord.schemaVersion !== "spreadsheet-semantic.v2";
    if (sourceChanged) {
      const resetToken = randomUUID();
      const nextExecutionNumber = semanticRecord.executionNumber + 1;
      const reset = await db.transaction(async (tx) => {
        const [resetSession] = await tx.update(spreadsheetSemanticSessionsTable).set({
          sourceContentHash,
          sourceObjectPath: evidenceItem.objectPath,
          schemaVersion: "spreadsheet-semantic.v2",
          status: "working",
          stage: "workbook_overview",
          continuationToken: semanticExecutionToken(sourceContentHash, nextExecutionNumber),
          requestPayload: {},
          contextHistory: [],
          providerCalls: 0,
          providerAttempts: [],
          currentPlan: null,
          workIdentity: randomUUID(),
          currentExecutionId: null,
          executionNumber: nextExecutionNumber,
          automaticRetryCount: 0,
          claimToken: resetToken,
          leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
          updatedAt: nowForSession,
        }).where(and(
          eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
          eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
          or(
            inArray(spreadsheetSemanticSessionsTable.status, ["ready", "complete", "incomplete", "invalidated"]),
            and(eq(spreadsheetSemanticSessionsTable.status, "working"), or(
              isNull(spreadsheetSemanticSessionsTable.leaseExpiresAt),
              lt(spreadsheetSemanticSessionsTable.leaseExpiresAt, nowForSession),
            )),
          ),
        )).returning();
        if (!resetSession) return null;
        if (semanticRecord.currentExecutionId) {
          await tx.update(spreadsheetSemanticExecutionsTable).set({
            status: "invalidated",
            claimToken: null,
            leaseExpiresAt: null,
            completedAt: nowForSession,
            updatedAt: nowForSession,
          }).where(and(
            eq(spreadsheetSemanticExecutionsTable.id, semanticRecord.currentExecutionId),
            eq(spreadsheetSemanticExecutionsTable.semanticSessionId, semanticRecord.id),
            eq(spreadsheetSemanticExecutionsTable.workIdentity, semanticRecord.workIdentity),
            inArray(spreadsheetSemanticExecutionsTable.status, ["ready", "working"]),
          ));
        }
        return resetSession;
      });
      if (!reset) {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_conflict", {
          reason: "source_changed_while_active",
          sourceContentHash,
          sourceObjectPath: evidenceItem.objectPath,
        });
        res.status(409).json({ error: "This spreadsheet semantic review is still being processed." }); return;
      }
      semanticRecord = reset;
      semanticClaimToken = resetToken;
      reclaimed = true;
    } else if (semanticRecord.status === "working") {
      const claimToken = randomUUID();
      const [claimedSession] = await db.update(spreadsheetSemanticSessionsTable).set({
        claimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
        eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
        eq(spreadsheetSemanticSessionsTable.status, "working"),
        or(isNull(spreadsheetSemanticSessionsTable.leaseExpiresAt), lt(spreadsheetSemanticSessionsTable.leaseExpiresAt, nowForSession)),
      )).returning();
      if (!claimedSession) {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_conflict", {
          reason: "active_lease",
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
        });
        res.status(409).json({ error: "This spreadsheet semantic review is still being processed." }); return;
      }
      semanticRecord = claimedSession;
      semanticClaimToken = claimToken;
      reclaimed = true;
    } else if (detectionMode === "retry_automatic" && semanticRecord.status === "incomplete") {
      if (semanticRecord.automaticRetryCount >= MAX_AUTOMATIC_RETRY_EXECUTIONS) {
        const previousAiStatus = savedState?.aiStatus;
        const safePreviousAiStatus = previousAiStatus && typeof previousAiStatus === "object" && !Array.isArray(previousAiStatus)
          ? previousAiStatus as Record<string, unknown>
          : {};
        await db.update(evidenceItemsTable).set({
          mappingSchema: {
            ...(savedState ?? {}),
            aiStatus: {
              ...safePreviousAiStatus,
              recoveryState: "automatic_unavailable",
              automaticRetryExhausted: true,
            },
          } as Record<string, unknown>,
        }).where(and(
          eq(evidenceItemsTable.id, evidenceItem.id),
          eq(evidenceItemsTable.profileId, profile.id),
        ));
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_retry_limit_reached", {
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
          automaticRetryCount: semanticRecord.automaticRetryCount,
          maximumAutomaticRetries: MAX_AUTOMATIC_RETRY_EXECUTIONS,
          sourceContentHash,
          sourceObjectPath: evidenceItem.objectPath,
        });
        res.status(409).json({
          error: "Automatic review has reached its safe retry limit for this unchanged workbook. Start manual recovery to choose sheets and columns yourself.",
          code: "automatic_retry_limit_reached",
          recoveryState: "manual_recovery_required",
        });
        return;
      }
      const claimToken = randomUUID();
      const nextExecutionNumber = semanticRecord.executionNumber + 1;
      const [claimedSession] = await db.update(spreadsheetSemanticSessionsTable).set({
        status: "working",
        stage: "workbook_overview",
        continuationToken: semanticExecutionToken(sourceContentHash, nextExecutionNumber),
        requestPayload: {},
        contextHistory: [],
        providerCalls: 0,
        currentPlan: null,
        currentExecutionId: null,
        executionNumber: nextExecutionNumber,
        automaticRetryCount: semanticRecord.automaticRetryCount + 1,
        claimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
        eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
        eq(spreadsheetSemanticSessionsTable.status, "incomplete"),
      )).returning();
      if (!claimedSession) {
        res.status(409).json({ error: "This spreadsheet automatic review changed. Reload the workbook review." }); return;
      }
      semanticRecord = claimedSession;
      semanticClaimToken = claimToken;
    } else if (semanticRecord.status === "invalidated") {
      const claimToken = randomUUID();
      const nextExecutionNumber = semanticRecord.executionNumber + 1;
      const [claimedSession] = await db.update(spreadsheetSemanticSessionsTable).set({
        status: "working",
        stage: "workbook_overview",
        continuationToken: semanticExecutionToken(sourceContentHash, nextExecutionNumber),
        requestPayload: {},
        contextHistory: [],
        providerCalls: 0,
        currentPlan: null,
        currentExecutionId: null,
        executionNumber: nextExecutionNumber,
        claimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
        eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
        eq(spreadsheetSemanticSessionsTable.status, "invalidated"),
      )).returning();
      if (!claimedSession) {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_conflict", {
          reason: "invalidated_claim_race",
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
        });
        res.status(409).json({ error: "This spreadsheet review changed. Reload the workbook review." }); return;
      }
      semanticRecord = claimedSession;
      semanticClaimToken = claimToken;
    } else if (semanticRecord.status === "ready" && semanticRecord.currentExecutionId) {
      const claimToken = randomUUID();
      const nextExecutionNumber = semanticRecord.executionNumber + 1;
      const [claimedSession] = await db.update(spreadsheetSemanticSessionsTable).set({
        status: "working",
        stage: "workbook_overview",
        continuationToken: semanticExecutionToken(sourceContentHash, nextExecutionNumber),
        requestPayload: {},
        contextHistory: [],
        providerCalls: 0,
        currentPlan: null,
        currentExecutionId: null,
        executionNumber: nextExecutionNumber,
        claimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
        eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
        eq(spreadsheetSemanticSessionsTable.status, "ready"),
        eq(spreadsheetSemanticSessionsTable.currentExecutionId, semanticRecord.currentExecutionId),
      )).returning();
      if (!claimedSession) {
        res.status(409).json({ error: "This spreadsheet review changed. Reload the workbook review." }); return;
      }
      semanticRecord = claimedSession;
      semanticClaimToken = claimToken;
    } else if (semanticRecord.status === "ready") {
      const claimToken = randomUUID();
      const [claimedSession] = await db.update(spreadsheetSemanticSessionsTable).set({
        status: "working",
        claimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
        eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
        inArray(spreadsheetSemanticSessionsTable.status, ["ready", "invalidated"]),
      )).returning();
      if (!claimedSession) {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_conflict", {
          reason: "claim_race",
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
        });
        res.status(409).json({ error: "This spreadsheet semantic review is still being processed." }); return;
      }
      semanticRecord = claimedSession;
      semanticClaimToken = claimToken;
    }
    semanticRecord = await ensureSemanticExecution(semanticRecord);
    if (semanticClaimToken) {
      const [execution] = await db.update(spreadsheetSemanticExecutionsTable).set({
        status: "working",
        stage: semanticRecord.stage,
        claimToken: semanticClaimToken,
        leaseExpiresAt: new Date(nowForSession.getTime() + SEMANTIC_SESSION_LEASE_MS),
        updatedAt: nowForSession,
      }).where(and(
        eq(spreadsheetSemanticExecutionsTable.id, semanticRecord.currentExecutionId!),
        eq(spreadsheetSemanticExecutionsTable.semanticSessionId, semanticRecord.id),
        eq(spreadsheetSemanticExecutionsTable.workIdentity, semanticRecord.workIdentity),
        inArray(spreadsheetSemanticExecutionsTable.status, ["ready", "working"]),
      )).returning();
      if (!execution) {
        res.status(409).json({ error: "This spreadsheet semantic execution was reclaimed. Reload the workbook review." });
        return;
      }
    }
    if (semanticClaimToken) {
      await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, reclaimed ? "spreadsheet_semantic_session_reclaimed" : "spreadsheet_semantic_session_claimed", {
        semanticSessionId: semanticRecord.id,
        semanticWorkIdentity: semanticRecord.workIdentity,
        sourceContentHash,
        sourceObjectPath: evidenceItem.objectPath,
      });
    }
    let persistedSemanticSession = semanticSessionForAI(semanticRecord);
    const persistSemanticSession = async (session: SpreadsheetSemanticSession) => {
      if (!semanticClaimToken) return;
      const status = session.stage === "complete" ? "complete" : session.stage === "incomplete" ? "incomplete" : "working";
      let checkpoint: typeof spreadsheetSemanticSessionsTable.$inferSelect;
      try {
        checkpoint = await db.transaction(async (tx) => {
          const now = new Date();
          const [execution] = await tx.update(spreadsheetSemanticExecutionsTable).set({
            status,
            stage: session.stage,
            continuationToken: session.continuationToken,
            requestPayload: session.payload as Record<string, unknown>,
            contextHistory: session.contextHistory,
            providerCalls: session.providerCalls,
            currentPlan: session.currentPlan,
            leaseExpiresAt: status === "working" ? new Date(now.getTime() + SEMANTIC_SESSION_LEASE_MS) : null,
            completedAt: status === "working" ? null : now,
            updatedAt: now,
          }).where(and(
            eq(spreadsheetSemanticExecutionsTable.id, semanticRecord.currentExecutionId!),
            eq(spreadsheetSemanticExecutionsTable.semanticSessionId, semanticRecord.id),
            eq(spreadsheetSemanticExecutionsTable.workIdentity, semanticRecord.workIdentity),
            eq(spreadsheetSemanticExecutionsTable.claimToken, semanticClaimToken),
            eq(spreadsheetSemanticExecutionsTable.status, "working"),
          )).returning();
          if (!execution) throw new Error("semantic_execution_fenced");
          const [sessionCheckpoint] = await tx.update(spreadsheetSemanticSessionsTable).set({
            status,
            stage: session.stage,
            continuationToken: session.continuationToken,
            requestPayload: session.payload as Record<string, unknown>,
            contextHistory: session.contextHistory,
            providerCalls: session.providerCalls,
            providerAttempts: session.providerAttempts,
            currentPlan: session.currentPlan,
            leaseExpiresAt: status === "working" ? new Date(now.getTime() + SEMANTIC_SESSION_LEASE_MS) : null,
            updatedAt: now,
          }).where(and(
            eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
            eq(spreadsheetSemanticSessionsTable.currentExecutionId, semanticRecord.currentExecutionId!),
            eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
            eq(spreadsheetSemanticSessionsTable.claimToken, semanticClaimToken),
            eq(spreadsheetSemanticSessionsTable.status, "working"),
          )).returning();
          if (!sessionCheckpoint) throw new Error("semantic_session_fenced");
          return sessionCheckpoint;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message !== "semantic_execution_fenced" && message !== "semantic_session_fenced") throw error;
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_fenced", {
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
          semanticExecutionId: semanticRecord.currentExecutionId,
          attemptedClaimToken: semanticClaimToken,
          fence: message,
        });
        throw new Error("semantic_session_fenced");
      }
      if (!checkpoint) {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_semantic_session_fenced", {
          semanticSessionId: semanticRecord.id,
          semanticWorkIdentity: semanticRecord.workIdentity,
          attemptedClaimToken: semanticClaimToken,
        });
        throw new Error("semantic_session_fenced");
      }
      semanticRecord = checkpoint;
      persistedSemanticSession = semanticSessionForAI(checkpoint);
      if (status !== "working") {
        await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, status === "complete" ? "spreadsheet_semantic_session_completed" : "spreadsheet_semantic_session_incomplete", {
          semanticSessionId: checkpoint.id,
          semanticWorkIdentity: checkpoint.workIdentity,
          continuationToken: checkpoint.continuationToken,
          providerCalls: checkpoint.providerCalls,
        });
      }
    };
    const persistProviderAttempts = async (
      attempts: NonNullable<SpreadsheetSemanticSession["providerAttempts"]>,
      executionProviderCalls: number,
    ) => {
      if (!semanticClaimToken) return;
      const attempt = attempts.at(-1);
      if (!attempt) return;
      await db.transaction(async (tx) => {
        const [checkpoint] = await tx.update(spreadsheetSemanticSessionsTable).set({
          providerCalls: executionProviderCalls,
          providerAttempts: attempts,
          leaseExpiresAt: new Date(Date.now() + SEMANTIC_SESSION_LEASE_MS),
          updatedAt: new Date(),
        }).where(and(
          eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
          eq(spreadsheetSemanticSessionsTable.currentExecutionId, semanticRecord.currentExecutionId!),
          eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
          eq(spreadsheetSemanticSessionsTable.claimToken, semanticClaimToken),
          eq(spreadsheetSemanticSessionsTable.status, "working"),
        )).returning();
        if (!checkpoint) throw new Error("semantic_session_fenced");
        const [execution] = await tx.update(spreadsheetSemanticExecutionsTable).set({
          providerCalls: executionProviderCalls,
          leaseExpiresAt: new Date(Date.now() + SEMANTIC_SESSION_LEASE_MS),
          updatedAt: new Date(),
        }).where(and(
          eq(spreadsheetSemanticExecutionsTable.id, semanticRecord.currentExecutionId!),
          eq(spreadsheetSemanticExecutionsTable.semanticSessionId, semanticRecord.id),
          eq(spreadsheetSemanticExecutionsTable.workIdentity, semanticRecord.workIdentity),
          eq(spreadsheetSemanticExecutionsTable.claimToken, semanticClaimToken),
          eq(spreadsheetSemanticExecutionsTable.status, "working"),
        )).returning();
        if (!execution) throw new Error("semantic_execution_fenced");
        await tx.insert(spreadsheetSemanticProviderAttemptsTable).values({
          profileId: profile.id,
          evidenceId: evidenceItem.id,
          semanticSessionId: checkpoint.id,
          executionId: checkpoint.currentExecutionId,
          workIdentity: checkpoint.workIdentity,
          attemptNumber: attempt.attemptNumber,
          executionAttemptNumber: executionProviderCalls,
          telemetryVersion: attempt.telemetryVersion,
          routeClass: attempt.routeClass,
          requestedModel: attempt.requestedModel,
          resolvedModel: attempt.resolvedModel,
          model: attempt.model,
          responseMode: attempt.responseMode,
          startedAt: new Date(attempt.startedAt),
          durationMs: attempt.durationMs,
          outcomeCategory: attempt.outcomeCategory,
          safeStatus: attempt.safeStatus,
          statusCode: attempt.statusCode,
          retryable: attempt.retryable,
          failurePhase: attempt.failurePhase,
          diagnostic: attempt.diagnostic ?? null,
        }).onConflictDoNothing();
        await tx.insert(evidenceAuditEventsTable).values({
          profileId: profile.id,
          evidenceId: evidenceItem.id,
          actorUserId: req.user.id,
          eventType: "spreadsheet_provider_attempt",
          details: {
            semanticSessionId: checkpoint.id,
            semanticWorkIdentity: checkpoint.workIdentity,
            semanticExecutionId: checkpoint.currentExecutionId,
            semanticExecutionNumber: checkpoint.executionNumber,
            executionAttemptNumber: executionProviderCalls,
            ...attempt,
          },
        });
        semanticRecord = checkpoint;
        persistedSemanticSession = semanticSessionForAI(checkpoint);
      });
    };
    const ai = await analyseSpreadsheetWithAI(workbook, structuralAnalysis, {
      session: persistedSemanticSession,
      resetProviderState: detectionMode === "retry_automatic",
      persistSession: persistSemanticSession,
      persistProviderAttempts,
      inFlightKey: semanticClaimToken ? `${semanticRecord.id}:${semanticClaimToken}` : undefined,
    });
    // Operational limits and missing configuration return before the AI runner
    // starts. Persist those unavailable states through the same fenced session
    // path so a later explicit retry has an unambiguous durable starting point.
    if (semanticClaimToken && semanticRecord.status === "working" && ai.status !== "success" && ai.semanticPlan) {
      await persistSemanticSession({
        ...persistedSemanticSession,
        stage: "incomplete",
        providerCalls: ai.providerCalls,
        providerAttempts: ai.providerAttempts ?? persistedSemanticSession.providerAttempts,
        currentPlan: spreadsheetImportPlanSchema.parse(ai.semanticPlan),
      });
    }
    if (semanticClaimToken) {
      const [currentSession] = await db.select({
        id: spreadsheetSemanticSessionsTable.id,
        workIdentity: spreadsheetSemanticSessionsTable.workIdentity,
        claimToken: spreadsheetSemanticSessionsTable.claimToken,
      }).from(spreadsheetSemanticSessionsTable).where(eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id));
      if (!currentSession || currentSession.workIdentity !== semanticRecord.workIdentity || currentSession.claimToken !== semanticClaimToken) {
        res.status(409).json({ error: "This semantic review was reclaimed by another request. Reload the workbook review." }); return;
      }
    }
    // A saved explicit user choice is durable recovery input. It must win over
    // a later provider outage, but we never manufacture a replacement choice
    // from worksheet-name/header heuristics.
    const savedRoleOverrides: Record<string, "transactional" | "non_transactional" | "mixed" | "unknown"> = Object.fromEntries(
      (savedDraft?.selectedSheetIds ?? []).map((sheetId) => [sheetId, "transactional"]),
    );
    const analysis = savedDraft?.selectedSheetIds?.length
      ? analyseSpreadsheet(workbook, {
        selectedSheetIds: savedDraft.selectedSheetIds,
        roleOverrides: { ...savedRoleOverrides, ...(savedDraft.sheetRoleOverrides ?? {}) },
        sheetMappings: savedDraft.sheetMappings,
        tradingStartDate: profile.businessStartDate ?? null,
        decisionSource: "user",
        semanticMode: "structural",
      })
      : (ai.analysis ?? structuralAnalysis);
    const primarySheet = analysis.sheets.find((sheet) => sheet.selected) ?? analysis.sheets[0];
    const mappingSchema: MappingSchema = primarySheet ? {
      headerRow: primarySheet.mapping.headerRow ?? 0,
      columns: primarySheet.mapping.columns,
      dateFormat: null,
      currency: "GBP",
      confidence: 0.35,
      notes: ai.status === "success"
        ? ["AI semantic plan; confirm the selected sheet and columns before import."]
        : ["Automatic understanding is incomplete. Choose a specific sheet and its columns before import."],
    } : {
      headerRow: 0, columns: {}, dateFormat: null, currency: "GBP", confidence: 0, notes: ["No transaction sheet was inferred."],
    };
    const previewRows = primarySheet?.previewRows.map((row) => row.values) ?? [];
    const state = {
      schemaVersion: "spreadsheet-review.v1",
      mappingSchema,
      deterministicFindings: analysis,
      semanticWorkbookOverview: ai.semanticOverview ?? null,
      aiProposal: ai.semanticPlan ?? null,
      semanticSession: {
        id: semanticRecord.id,
        workIdentity: semanticRecord.workIdentity,
        status: semanticRecord.status,
        stage: semanticRecord.stage,
        continuationToken: semanticRecord.continuationToken,
      },
      semanticPlanIdentity: semanticPlanIdentity(workbook.contentHash, ai.semanticPlan),
      aiStatus: {
        status: ai.status,
        reason: ai.reason ?? null,
        failureCategory: ai.failureCategory ?? null,
        sampledSheetIds: ai.sampledSheetIds,
        providerCalls: ai.providerCalls,
        providerAttempts: ai.providerAttempts ?? [],
        limits: ai.limits,
        continuationToken: ai.continuationToken ?? null,
        recoveryState: ai.status === "success"
          ? "automatic_ready"
          : detectionMode === "manual_recovery"
            ? "manual_recovery"
            : "automatic_unavailable",
      },
      userDecision: savedState?.userDecision ?? null,
      reviewDraft: savedState?.reviewDraft ?? null,
      reviewRevisionHistory: savedState?.reviewRevisionHistory ?? [],
      lastImportError: savedState?.lastImportError ?? null,
    };
    const [reopened] = await db.transaction(async (tx) => {
      if (semanticClaimToken) {
        const [fencedSession] = await tx.select({ id: spreadsheetSemanticSessionsTable.id })
          .from(spreadsheetSemanticSessionsTable)
          .where(and(
            eq(spreadsheetSemanticSessionsTable.id, semanticRecord.id),
            eq(spreadsheetSemanticSessionsTable.workIdentity, semanticRecord.workIdentity),
            eq(spreadsheetSemanticSessionsTable.claimToken, semanticClaimToken),
          ))
          .for("update");
        if (!fencedSession) return [];
      }
      return tx.update(evidenceItemsTable).set({
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
    });
    if (!reopened) { res.status(409).json({ error: "This spreadsheet is still being processed" }); return; }
    await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_inspected", {
      contentHash: workbook.contentHash, parserVersion: analysis.parserVersion, sheetCount: workbook.sheets.length,
      totalParserRows: workbook.totalParserRows, aiStatus: ai.status, fallbackReason: ai.reason ?? null,
      recoveryState: state.aiStatus.recoveryState,
      providerAttemptCount: state.aiStatus.providerAttempts.length,
    });
    if (detectionMode === "manual_recovery") {
      await addEvidenceAudit(profile.id, evidenceItem.id, req.user.id, "spreadsheet_manual_recovery_selected", {
        semanticSessionId: semanticRecord.id,
        semanticWorkIdentity: semanticRecord.workIdentity,
      });
    }
    res.json({
      mappingSchema, previewRows, analysis, semanticWorkbookOverview: state.semanticWorkbookOverview, aiProposal: ai.semanticPlan,
      aiStatus: state.aiStatus, userDecision: state.userDecision, reviewDraft: state.reviewDraft,
      reviewRevisionHistory: state.reviewRevisionHistory, lastImportError: state.lastImportError,
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
  if (!body.success) {
    res.status(400).json({
      error: "A few answers are still needed before importing.",
      issues: inputReviewIssues(body.error.issues),
    });
    return;
  }
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
    const sourceContentHash = workbook.contentHash ?? createHash("sha256").update(buffer).digest("hex");
    const selected = new Set(body.data.selectedSheetIds);
    const importState = (evidenceItem.mappingSchema as Record<string, unknown> | null) ?? {};
    const persistedDraft = (importState.reviewDraft as Record<string, unknown> | null) ?? null;
    if (!persistedDraft
      || persistedDraft.mappingRevision !== body.data.reviewRevision
      || persistedDraft.semanticPlanIdentity !== body.data.semanticPlanIdentity
      || persistedDraft.sourceContentHash !== sourceContentHash
      || persistedDraft.sourceObjectPath !== evidenceItem.objectPath
      || !["spreadsheet-semantic.v2", "manual-recovery"].includes(String(persistedDraft.semanticSchemaVersion))
      || !sameConfirmedReview(persistedDraft, body.data)) {
      res.status(409).json({
        error: "This confirmation is not the latest saved spreadsheet review.",
        issues: [{ field: "selection", message: "Save your current review choices, then confirm that saved version." }],
      });
      return;
    }
    const persistedPlan = spreadsheetImportPlanSchema.safeParse(importState.aiProposal);
    const semanticPlan = persistedPlan.success && persistedPlan.data.status === "complete"
      ? persistedPlan.data
      : null;
    const recoveryState = (importState.aiStatus as { recoveryState?: unknown } | undefined)?.recoveryState;
    if (!semanticPlan && recoveryState !== "manual_recovery") {
      res.status(409).json({
        error: "Choose manual recovery or retry automatic review before importing.",
        issues: [{ field: "selection", message: "Automatic review is unavailable. Start manual recovery and save your choices before importing." }],
      });
      return;
    }
    const currentPlanIdentity = semanticPlanIdentity(sourceContentHash, persistedPlan.success ? persistedPlan.data : null);
    if (body.data.semanticPlanIdentity !== currentPlanIdentity
      || persistedDraft.semanticPlanIdentity !== currentPlanIdentity) {
      res.status(409).json({
        error: "This semantic plan no longer matches the saved review.",
        issues: [{ field: "selection", message: "Re-open the spreadsheet review and save the current plan before importing." }],
      });
      return;
    }
    const semanticRules = new Map(semanticPlan?.sheets.map((sheet) => [sheet.sheetId, sheet.rowRules]) ?? []);
    const semanticSheets = new Map(semanticPlan?.sheets.map((sheet) => [sheet.sheetId, sheet]) ?? []);
    for (const sheetId of selected) {
      const planned = semanticSheets.get(sheetId);
      const resolution = body.data.sheetResolutions[sheetId];
      if (!semanticPlan && resolution !== "include_income" && resolution !== "include_expense") {
        res.status(400).json({
          error: "This import needs an explicit manual recovery decision.",
          issues: [{ sheetId, field: "selection", message: "AI review is incomplete. Choose “include as income” or “include as expense” for this saved manual recovery before importing." }],
        });
        return;
      }
      if (planned && ['reference', 'summary', 'duplicate', 'excluded'].includes(planned.disposition)
        && resolution !== 'include_income' && resolution !== 'include_expense') {
        res.status(400).json({
          error: "This sheet needs an explicit manual recovery decision.",
          issues: [{ sheetId, field: "selection", message: "This sheet was identified as reference material. Explicitly choose to include it before assigning transaction columns." }],
        });
        return;
      }
    }
    const knownSheetIds = new Set(workbook.sheets.map((sheet) => sheet.sheetId));
    if ([...selected].some((sheetId) => !knownSheetIds.has(sheetId))) {
      res.status(400).json({
        error: "This workbook changed after it was reviewed.",
        issues: [{ field: "selection", message: "Review the sheet choices again before importing." }],
      });
      return;
    }
    const excluded = new Set(body.data.excludedRowRefs.map((row) => `${row.sheetId}:${row.rowNumber}`));
    const counts = Object.fromEntries([
      "imported", "duplicate", "invalid", "header", "blank", "balance_total", "non_transactional",
      "excluded_by_user", "excluded_by_rule", "unmapped", "outside_scope", "pre_trading_start", "unselected_sheet",
    ].map((key) => [key, 0])) as Record<RowDisposition, number>;
    type RowOutcome = {
      sheetId: string; worksheet: string; sourceRowIndex: number; sourceRowNumber: number;
      physicalLineStart: number | null; physicalLineEnd: number | null; primaryDisposition: RowDisposition;
      secondaryFindings: string[]; reason: string; rawValueReference: Record<string, unknown>;
      normalizedValueReference: { date: string | null; amount: number | null; description: string | null };
      duplicateFingerprint: string | null; decisionSource: string; taxYear: string | null;
    };
    const rowOutcomes: RowOutcome[] = [];
    const rowsToWrite: Array<{
      sourceRowIndex: number; row: string[]; sheetId: string; displayName: string; sourceRow: number;
      date: string; amount: number; description: string; taxYear: string; filingScope: boolean; disposition: RowDisposition;
    }> = [];
    const fingerprints = new Set<string>();
    const mappingsForAudit: Record<string, MappingSchema> = {};
    const existingTransactions = await db.select({
      evidenceId: transactionsTable.evidenceId, sourceRowIndex: transactionsTable.sourceRowIndex,
      date: transactionsTable.date, amount: transactionsTable.amount, description: transactionsTable.description,
    }).from(transactionsTable).where(eq(transactionsTable.profileId, profile.id));
    const priorFingerprints = new Set(existingTransactions
      .filter((transaction) => transaction.evidenceId !== confirmedEvidence.id)
      .map((transaction) => spreadsheetMovementFingerprint(transaction.date, transaction.amount, transaction.description)));
    const businessStartDate = profile.businessStartDate ?? null;
    // Selection is an AI-plan or explicit user/manual-recovery decision. Do
    // not re-classify it through local worksheet-name or header heuristics.
    const sheetRoles = new Map(workbook.sheets.map((sheet) => [
      sheet.sheetId,
      body.data.sheetRoleOverrides[sheet.sheetId] ?? (selected.has(sheet.sheetId) ? "transactional" : "non_transactional"),
    ]));
    const unresolvedRows: Array<{ sheetId: string; worksheet: string; rowNumber: number }> = [];

    for (const sheet of workbook.sheets) {
      if (!selected.has(sheet.sheetId)) {
        for (const source of sheet.rows) {
          rowOutcomes.push({
            sheetId: sheet.sheetId, worksheet: sheet.displayName, sourceRowIndex: spreadsheetSourceRowIndex(sheet.index, source.rowNumber),
            sourceRowNumber: source.rowNumber, physicalLineStart: source.physicalLineStart ?? null, physicalLineEnd: source.physicalLineEnd ?? null,
            primaryDisposition: "unselected_sheet", secondaryFindings: [], reason: "Sheet was not selected for this import.",
            rawValueReference: { sheetId: sheet.sheetId, worksheet: sheet.displayName, rowNumber: source.rowNumber, values: source.values },
            normalizedValueReference: { date: null, amount: null, description: null }, duplicateFingerprint: null, decisionSource: "user_selection", taxYear: null,
          });
          counts.unselected_sheet += 1;
        }
        continue;
      }
      if (sheetRoles.get(sheet.sheetId) === "non_transactional") {
        for (const source of sheet.rows) {
          rowOutcomes.push({
            sheetId: sheet.sheetId, worksheet: sheet.displayName, sourceRowIndex: spreadsheetSourceRowIndex(sheet.index, source.rowNumber),
            sourceRowNumber: source.rowNumber, physicalLineStart: source.physicalLineStart ?? null, physicalLineEnd: source.physicalLineEnd ?? null,
            primaryDisposition: "non_transactional", secondaryFindings: [], reason: "Sheet is classified as non-transactional.",
            rawValueReference: { sheetId: sheet.sheetId, worksheet: sheet.displayName, rowNumber: source.rowNumber, values: source.values },
            normalizedValueReference: { date: null, amount: null, description: null }, duplicateFingerprint: null, decisionSource: "deterministic", taxYear: null,
          });
          counts.non_transactional += 1;
        }
        continue;
      }
      const mapping = body.data.sheetMappings[sheet.sheetId] as MappingSchema | undefined;
      if (!mapping) {
        res.status(400).json({
          error: "We still need to know how to read one sheet.",
          issues: [{ sheetId: sheet.sheetId, worksheet: sheet.displayName, field: "selection", message: `Choose how to read “${sheet.displayName}”, or leave it out for now.` }],
        });
        return;
      }
      const missing = requiredMappingIssues(mapping, sheet.sheetId);
      if (missing.length) {
        res.status(400).json({ error: "We still need to know how to read one sheet.", issues: missing });
        return;
      }
      mappingsForAudit[sheet.sheetId] = mapping;
      const maxColumn = sheet.columnCount;
      const indices = Object.values(mapping.columns).filter((value): value is number => value !== undefined);
      if (mapping.headerRow < 0 || mapping.headerRow >= sheet.rowCount || indices.some((index) => index < 0 || index >= maxColumn)) {
        res.status(400).json({
          error: "One of the saved column choices no longer fits this sheet.",
          issues: [{ sheetId: sheet.sheetId, worksheet: sheet.displayName, field: "selection", message: `Check the named columns for “${sheet.displayName}” and choose them again.` }],
        });
        return;
      }
      for (const source of sheet.rows) {
        const outcomeBase = {
          sheetId: sheet.sheetId, worksheet: sheet.displayName, sourceRowIndex: spreadsheetSourceRowIndex(sheet.index, source.rowNumber),
          sourceRowNumber: source.rowNumber, physicalLineStart: source.physicalLineStart ?? null, physicalLineEnd: source.physicalLineEnd ?? null,
          rawValueReference: { sheetId: sheet.sheetId, worksheet: sheet.displayName, rowNumber: source.rowNumber, values: source.values },
        };
        const saveOutcome = (primaryDisposition: RowDisposition, reason: string, normalizedValueReference: RowOutcome["normalizedValueReference"], extras: Partial<Pick<RowOutcome, "secondaryFindings" | "duplicateFingerprint" | "decisionSource" | "taxYear">> = {}) => {
          rowOutcomes.push({
            ...outcomeBase, primaryDisposition, reason, normalizedValueReference,
            secondaryFindings: extras.secondaryFindings ?? [], duplicateFingerprint: extras.duplicateFingerprint ?? null,
            decisionSource: extras.decisionSource ?? "deterministic", taxYear: extras.taxYear ?? null,
          });
          counts[primaryDisposition] += 1;
        };
        if (source.rowNumber <= mapping.headerRow + 1) {
          saveOutcome("header", "Header or title row retained outside the transaction range.", { date: null, amount: null, description: null });
          continue;
        }
        const rowKey = `${sheet.sheetId}:${source.rowNumber}`;
        if (source.values.every((cell) => !normaliseCell(cell))) {
          saveOutcome("blank", "Blank source row.", { date: null, amount: null, description: null }); continue;
        }
        if (excluded.has(rowKey)) {
          saveOutcome("excluded_by_user", "Explicitly excluded by the reviewer.", { date: null, amount: null, description: null }, { secondaryFindings: ["explicit_user_exclusion"], decisionSource: "user_exclusion" }); continue;
        }
        const planRules = semanticRules.get(sheet.sheetId);
        if (planRules) {
          const explicitlyExcluded = planRules.exclude.some((rule) => source.rowNumber >= rule.startRow && source.rowNumber <= rule.endRow);
          const included = planRules.include.some((rule) => source.rowNumber >= rule.startRow && source.rowNumber <= rule.endRow);
          if (explicitlyExcluded || !included) {
            saveOutcome("excluded_by_rule", "Excluded by the validated AI semantic plan.", { date: null, amount: null, description: null }, { secondaryFindings: ["semantic_plan_exclusion"], decisionSource: "ai_semantic_plan" });
            continue;
          }
        }
        const mapped = mapSpreadsheetRow(source.values, mapping);
        const normalized = { date: mapped.date, amount: mapped.amount, description: mapped.description };
        if (looksLikeBalanceRow(source.values)) {
          saveOutcome("balance_total", "A balance, subtotal, opening, closing, or total row cannot be imported as a transaction.", normalized, {
            secondaryFindings: ["balance_total"],
            decisionSource: semanticPlan ? "deterministic_safety" : "manual_recovery_safety",
          });
          continue;
        }
        if (!mapped.date || mapped.amount === null || !mapped.description) {
          saveOutcome("invalid", "Required date, amount, or description could not be normalized.", normalized, { secondaryFindings: ["unresolved_value"] });
          unresolvedRows.push({ sheetId: sheet.sheetId, worksheet: sheet.displayName, rowNumber: source.rowNumber });
          continue;
        }
        const taxYear = ukTaxYear(mapped.date);
        if (!taxYear) {
          saveOutcome("invalid", "Date could not be assigned to a UK tax year.", normalized, { secondaryFindings: ["unresolved_date"] });
          unresolvedRows.push({ sheetId: sheet.sheetId, worksheet: sheet.displayName, rowNumber: source.rowNumber });
          continue;
        }
        const isPreTrading = Boolean(businessStartDate && mapped.date < businessStartDate);
        const inFilingScope = body.data.filingScope.includes(taxYear);
        if (isPreTrading && body.data.preTradingStartMode === "exclude") {
          saveOutcome("excluded_by_user", "Pre-trading record was explicitly excluded.", normalized, { secondaryFindings: ["pre_trading_start"], decisionSource: "user_scope", taxYear }); continue;
        }
        if (!inFilingScope && body.data.outsideScopeMode === "exclude") {
          saveOutcome("excluded_by_user", "Record outside the selected filing scope was explicitly excluded.", normalized, { secondaryFindings: ["outside_scope"], decisionSource: "user_scope", taxYear }); continue;
        }
        const fingerprint = spreadsheetMovementFingerprint(mapped.date, mapped.amount, mapped.description);
        if (fingerprints.has(fingerprint)) {
          saveOutcome("duplicate", "Duplicate normalized source movement detected in this workbook.", normalized, { duplicateFingerprint: fingerprint, secondaryFindings: ["same_workbook_duplicate"], taxYear }); continue;
        }
        fingerprints.add(fingerprint);
        if (priorFingerprints.has(fingerprint)) {
          saveOutcome("duplicate", "A matching movement already exists in this profile's financial records.", normalized, { duplicateFingerprint: fingerprint, secondaryFindings: ["prior_profile_record"], decisionSource: "existing_ledger", taxYear }); continue;
        }
        const disposition: RowDisposition = isPreTrading ? "pre_trading_start" : !inFilingScope ? "outside_scope" : "imported";
        saveOutcome(disposition, disposition === "pre_trading_start" ? "Record pre-dates the saved business/trading start date." : disposition === "outside_scope" ? "Record is retained outside the selected filing scope." : "Mapped row is ready for deterministic review.", normalized, { taxYear });
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
    if (unresolvedRows.length) {
      const first = unresolvedRows[0]!;
      const outcome = rowOutcomes.find((row) => row.sheetId === first.sheetId && row.sourceRowNumber === first.rowNumber);
      const field = !outcome?.normalizedValueReference.date
        ? "date"
        : outcome.normalizedValueReference.amount === null
          ? "amount"
          : "description";
      const missing = field === "date" ? "a usable date" : field === "amount" ? "a usable money amount" : "a description of what the entry is for";
      res.status(400).json({
        error: "A sheet still has entries we cannot read safely.",
        issues: [{
          sheetId: first.sheetId,
          worksheet: first.worksheet,
          rowNumber: first.rowNumber,
          field,
          message: `In “${first.worksheet}”, row ${first.rowNumber} is missing ${missing}. Choose another named column, or leave this sheet out for now.`,
        }],
      });
      return;
    }
    if (rowOutcomes.length !== workbook.totalParserRows) {
      throw new Error("Spreadsheet source-row reconciliation failed before confirmation.");
    }

    const mappingRevision = createHash("sha256").update(JSON.stringify({
      selectedSheetIds: body.data.selectedSheetIds, sheetMappings: mappingsForAudit,
      sheetRoleOverrides: body.data.sheetRoleOverrides, sheetResolutions: body.data.sheetResolutions, filingScope: body.data.filingScope,
      excludedRowRefs: body.data.excludedRowRefs, preTradingStartMode: body.data.preTradingStartMode, outsideScopeMode: body.data.outsideScopeMode,
      businessStartDate,
    })).digest("hex");
    const state = importState;
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
    const confirmedSourceObjectPath = confirmedEvidence.objectPath;
    const confirmedSemanticSessionId = typeof persistedDraft.semanticSessionId === "string"
      ? persistedDraft.semanticSessionId
      : null;
    const confirmedSemanticWorkIdentity = typeof persistedDraft.semanticWorkIdentity === "string"
      ? persistedDraft.semanticWorkIdentity
      : null;

    userDecision = {
      selectedSheetIds: body.data.selectedSheetIds, sheetMappings: mappingsForAudit,
      sheetRoleOverrides: body.data.sheetRoleOverrides, filingScope: body.data.filingScope,
      sheetResolutions: body.data.sheetResolutions, excludedRowRefs: body.data.excludedRowRefs, preTradingStartMode: body.data.preTradingStartMode,
      outsideScopeMode: body.data.outsideScopeMode,
      semanticPlanIdentity: body.data.semanticPlanIdentity,
      semanticSchemaVersion: semanticPlan?.schemaVersion ?? "manual-recovery",
      sourceContentHash,
      sourceObjectPath: confirmedSourceObjectPath,
      semanticSessionId: confirmedSemanticSessionId,
      semanticWorkIdentity: confirmedSemanticWorkIdentity,
      manualOverrides: (persistedDraft.decisionSources as Record<string, unknown> | undefined)?.manualOverrides ?? {},
      decisionSources: {
        sheetRoleOverrides: "user", selectedSheetIds: "user", sheetMappings: "user",
        filingScope: "user", excludedRowRefs: "user", sheetResolutions: "user",
      },
      confirmedAt: now.toISOString(), actorUserId: req.user.id, mappingRevision,
    };
    const sheetFinalDispositions = workbook.sheets.map((sheet) => {
      const sheetRows = rowOutcomes.filter((row) => row.sheetId === sheet.sheetId);
      const semantic = semanticSheets.get(sheet.sheetId);
      return {
        sheetId: sheet.sheetId, worksheet: sheet.displayName,
        disposition: selected.has(sheet.sheetId) ? (sheetRoles.get(sheet.sheetId) === "non_transactional" ? "non_transactional" : "processed") : "unselected_sheet",
        semanticDisposition: semantic?.disposition ?? "manual_recovery",
        semanticDecisionSource: semantic?.decisionSource ?? (selected.has(sheet.sheetId) ? "manual_recovery" : "user"),
        semanticValidationReason: semantic?.validationReason ?? "Confirmed user review decision.",
        userResolution: body.data.sheetResolutions[sheet.sheetId] ?? null,
        overrideReason: ((persistedDraft.decisionSources as Record<string, unknown> | undefined)?.manualOverrides as Record<string, { reason?: string }> | undefined)?.[sheet.sheetId]?.reason ?? null,
        finalOperationalOutcome: selected.has(sheet.sheetId)
          ? (sheetRoles.get(sheet.sheetId) === "non_transactional" ? "non_transactional" : "processed")
          : "unselected_sheet",
        sourceRows: sheetRows.length,
        dispositionCounts: sheetRows.reduce<Record<string, number>>((summary, row) => {
          summary[row.primaryDisposition] = (summary[row.primaryDisposition] ?? 0) + 1;
          return summary;
        }, {}),
      };
    });

    const [updated] = await db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: evidenceItemsTable.id }).from(evidenceItemsTable).where(and(
        eq(evidenceItemsTable.id, confirmedEvidence.id), eq(evidenceItemsTable.profileId, profile.id),
        eq(evidenceItemsTable.importStatus, "processing"), eq(evidenceItemsTable.processingToken, processingToken),
      )).for("update");
      if (!owned) return [];
      await tx.delete(spreadsheetRowOutcomesTable).where(and(
        eq(spreadsheetRowOutcomesTable.profileId, profile.id),
        eq(spreadsheetRowOutcomesTable.evidenceId, confirmedEvidence.id),
      ));
      if (rowOutcomes.length) {
        await tx.insert(spreadsheetRowOutcomesTable).values(rowOutcomes.map((row) => ({
          profileId: profile.id, evidenceId: confirmedEvidence.id,
          sheetId: row.sheetId, worksheet: row.worksheet, sourceRowIndex: row.sourceRowIndex, sourceRowNumber: row.sourceRowNumber,
          physicalLineStart: row.physicalLineStart, physicalLineEnd: row.physicalLineEnd,
          primaryDisposition: row.primaryDisposition, secondaryFindings: row.secondaryFindings,
          reason: row.reason, rawValueReference: row.rawValueReference, normalizedValueReference: row.normalizedValueReference,
           duplicateFingerprint: row.duplicateFingerprint, decisionSource: row.decisionSource, mappingRevision: mappingRevision,
           semanticPlanIdentity: body.data.semanticPlanIdentity,
           semanticSchemaVersion: semanticPlan?.schemaVersion ?? "manual-recovery",
            semanticSessionId: confirmedSemanticSessionId,
           sourceContentHash,
            sourceObjectPath: confirmedSourceObjectPath,
           semanticDisposition: semanticSheets.get(row.sheetId)?.disposition ?? "manual_recovery",
           semanticValidationReason: semanticSheets.get(row.sheetId)?.validationReason ?? "Confirmed user review decision.",
           userResolution: body.data.sheetResolutions[row.sheetId] ?? null,
           overrideReason: ((persistedDraft.decisionSources as Record<string, unknown> | undefined)?.manualOverrides as Record<string, { reason?: string }> | undefined)?.[row.sheetId]?.reason ?? null,
           finalOperationalOutcome: row.primaryDisposition,
           taxYear: row.taxYear,
        })));
      }
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
            ...stateWithoutLastError, userDecision, reviewDraft: { ...userDecision, savedAt: now.toISOString() },
            confirmedMappingRevision: mappingRevision, finalDispositions: counts,
            finalSheetDispositions: sheetFinalDispositions,
            finalSourceRowCount: rowOutcomes.length,
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
          contentHash: sourceContentHash,
          sourceObjectPath: confirmedSourceObjectPath,
          parserVersion: "spreadsheet-parser.v2",
          mappingRevision,
          semanticPlanIdentity: body.data.semanticPlanIdentity,
          semanticSchemaVersion: semanticPlan?.schemaVersion ?? "manual-recovery",
          semanticSessionId: confirmedSemanticSessionId,
          semanticWorkIdentity: confirmedSemanticWorkIdentity,
          userDecision, dispositionCounts: counts, sheetDispositions: sheetFinalDispositions,
          auditedSourceRows: rowOutcomes.length, importableRows: rowsToWrite.length,
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
    if (evidenceItem) {
      await db.insert(evidenceAuditEventsTable).values({
        profileId: evidenceItem.profileId,
        evidenceId: evidenceItem.id,
        actorUserId: req.user?.id ?? null,
        eventType: "spreadsheet_import_failed",
        details: {
          code: errorCode,
          rolledBack: true,
          processingToken,
          ...(conflict ? { conflict } : {}),
          ...(userDecision ? {
            mappingRevision: userDecision.mappingRevision,
            semanticPlanIdentity: userDecision.semanticPlanIdentity,
            sourceContentHash: userDecision.sourceContentHash,
            sourceObjectPath: userDecision.sourceObjectPath,
            semanticSessionId: userDecision.semanticSessionId,
          } : {}),
        },
      }).catch(() => undefined);
    }
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
    await db.update(spreadsheetSemanticSessionsTable).set({
      status: "ready",
      stage: "workbook_overview",
      continuationToken: "",
      requestPayload: {},
      contextHistory: [],
      providerCalls: 0,
      currentPlan: null,
      workIdentity: randomUUID(),
      claimToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(spreadsheetSemanticSessionsTable.evidenceId, replacement.id),
      eq(spreadsheetSemanticSessionsTable.profileId, profile.id),
    ));
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
