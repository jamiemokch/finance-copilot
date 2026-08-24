import { createHash, randomUUID } from "crypto";
import { Readable } from "stream";
import { Router } from "express";
import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import {
  bankImportBatchesTable,
  bankImportRowsTable,
  db,
  financialAccountsTable,
  privateUploadBindingsTable,
  privateUploadObjectsTable,
  transactionsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  BankCsvError,
  type BankMapping,
  parseBankCsv,
  parseMappedBankRows,
  suggestBankMapping,
  validateBankMapping,
} from "../lib/bank-csv.js";
import { requireProfile } from "./profiles.js";
import { scanProfile } from "./reconciliation.js";

const router = Router();
const storageService = new ObjectStorageService();
const PROCESSING_LEASE_MS = 10 * 60 * 1000;

const AccountInput = z.object({
  displayName: z.string().trim().min(1).max(120),
  lastFour: z.string().regex(/^\d{4}$/).optional().nullable(),
  currency: z.string().trim().length(3).optional().default("GBP"),
  accountType: z.enum(["current", "savings", "credit_card", "cash"]).optional().default("current"),
});

const MappingInput = z.object({
  headerRow: z.number().int().nonnegative(),
  columns: z.object({
    date: z.number().int().nonnegative(),
    amount: z.number().int().nonnegative().optional(),
    debit: z.number().int().nonnegative().optional(),
    credit: z.number().int().nonnegative().optional(),
    description: z.number().int().nonnegative(),
    reference: z.number().int().nonnegative().optional(),
    balance: z.number().int().nonnegative().optional(),
  }).strict(),
  dateFormat: z.enum(["dmy", "ymd"]),
  decimalConvention: z.enum(["dot", "comma"]),
}).strict().superRefine((mapping, context) => {
  const hasAmount = mapping.columns.amount !== undefined;
  const hasDebitCredit = mapping.columns.debit !== undefined && mapping.columns.credit !== undefined;
  if (!hasAmount && !hasDebitCredit) {
    context.addIssue({ code: "custom", message: "Choose a signed amount or both debit and credit columns." });
  }
  if (hasAmount && (mapping.columns.debit !== undefined || mapping.columns.credit !== undefined)) {
    context.addIssue({ code: "custom", message: "Do not combine signed amount with debit or credit columns." });
  }
});

type Batch = typeof bankImportBatchesTable.$inferSelect;
type BankRow = typeof bankImportRowsTable.$inferSelect;

/**
 * Atomically create (or recover) the one staging batch for a profile/file hash.
 * Keeping this as a small, storage-free primitive makes the idempotency fence
 * directly regression-testable without requiring an object-storage emulator.
 */
export async function registerBankImportBatch(
  batchValues: typeof bankImportBatchesTable.$inferInsert,
): Promise<{ batch: Batch; reused: boolean } | null> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(bankImportBatchesTable)
      .values(batchValues)
      .onConflictDoNothing({
        target: [bankImportBatchesTable.profileId, bankImportBatchesTable.fileHash],
      })
      .returning();
    if (inserted) return { batch: inserted, reused: false };

    // Another request won the unique insert race. Lock and return its batch
    // rather than exposing the expected conflict as a 500.
    const [winner] = await tx.select().from(bankImportBatchesTable).where(and(
      eq(bankImportBatchesTable.profileId, batchValues.profileId),
      eq(bankImportBatchesTable.fileHash, batchValues.fileHash),
    )).for("update");
    if (!winner) return null;
    if (winner.status !== "discarded") return { batch: winner, reused: true };

    // Preserve the prior behavior for a discarded same-file batch, but do it
    // under the same lock so concurrent retries cannot reset it inconsistently.
    const [reopened] = await tx.update(bankImportBatchesTable).set({
      ...batchValues,
      mappingVersion: 0,
      previewVersion: 0,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
      possibleDuplicateRows: 0,
      outOfScopeRows: 0,
      selectedRows: 0,
      committedRows: 0,
    }).where(eq(bankImportBatchesTable.id, winner.id)).returning();
    await tx.delete(bankImportRowsTable).where(eq(bankImportRowsTable.batchId, winner.id));
    return reopened ? { batch: reopened, reused: false } : null;
  });
}

// GET /profiles/:profileId/financial-accounts
router.get("/profiles/:profileId/financial-accounts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const accounts = await db.select().from(financialAccountsTable)
      .where(eq(financialAccountsTable.profileId, profile.id))
      .orderBy(desc(financialAccountsTable.createdAt));
    res.json(accounts);
  } catch (err) {
    req.log.error(err, "Failed to list financial accounts");
    res.status(500).json({ error: "Could not load financial accounts" });
  }
});

// POST /profiles/:profileId/financial-accounts
router.post("/profiles/:profileId/financial-accounts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = AccountInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid account name and optional last four digits." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [account] = await db.insert(financialAccountsTable).values({
      profileId: profile.id,
      ...body.data,
      currency: body.data.currency.toUpperCase(),
    }).returning();
    res.status(201).json(account);
  } catch (err) {
    req.log.error(err, "Failed to create financial account");
    res.status(500).json({ error: "Could not save this financial account" });
  }
});

// GET /profiles/:profileId/bank-imports
router.get("/profiles/:profileId/bank-imports", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batches = await db.select().from(bankImportBatchesTable)
      .where(eq(bankImportBatchesTable.profileId, profile.id))
      .orderBy(desc(bankImportBatchesTable.createdAt));
    res.json(batches.map(publicBatch));
  } catch (err) {
    req.log.error(err, "Failed to list bank imports");
    res.status(500).json({ error: "Could not load bank imports" });
  }
});

// POST /profiles/:profileId/bank-imports — register an uploaded bank CSV
router.post("/profiles/:profileId/bank-imports", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    filename: z.string().trim().min(1).max(255),
    objectPath: z.string().startsWith("/objects/"),
    accountId: z.string().uuid(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose a CSV file and a financial account." }); return; }
  if (!/\.csv$/i.test(body.data.filename)) {
    res.status(400).json({ error: "Bank import accepts CSV files only." });
    return;
  }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const taxYear = profile.taxYear;
    if (!taxYear) {
      res.status(422).json({ error: "Choose a tax year before starting a bank import." });
      return;
    }
    const [[account], [upload]] = await Promise.all([
      db.select().from(financialAccountsTable).where(and(
        eq(financialAccountsTable.id, body.data.accountId),
        eq(financialAccountsTable.profileId, profile.id),
      )).limit(1),
      db.select().from(privateUploadObjectsTable)
        .where(eq(privateUploadObjectsTable.objectPath, body.data.objectPath))
        .limit(1),
    ]);
    if (!account) { res.status(404).json({ error: "Financial account not found" }); return; }
    // Only unbound legacy uploads may be adopted. A present binding means the
    // object already belongs to a specific profile and must not cross over.
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
      res.status(404).json({ error: "The uploaded CSV was not found" });
      return;
    }

    const file = await storageService.getObjectEntityFile(body.data.objectPath);
    const [buffer] = await file.download();
    const parsed = parseBankCsv(buffer);
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const [existing] = await db.select().from(bankImportBatchesTable).where(and(
      eq(bankImportBatchesTable.profileId, profile.id),
      eq(bankImportBatchesTable.fileHash, fileHash),
    )).limit(1);
    const proposal = suggestBankMapping(parsed.rows);

    if (existing && existing.status !== "discarded") {
      const rows = await batchRows(existing.id);
      res.json({ batch: publicBatch(existing), rows, proposal, reused: true });
      return;
    }

    const batchValues = {
      profileId: profile.id,
      financialAccountId: account.id,
      taxYearSnapshot: taxYear,
      accountingBasisSnapshot: profile.accountingBasis,
      filename: body.data.filename,
      objectPath: body.data.objectPath,
      fileHash,
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      status: "mapping_required",
      lastError: null,
      processingLeaseExpiresAt: null,
      processingToken: null,
    } as const;
    const registration = await registerBankImportBatch(batchValues);
    if (!registration) {
      res.status(409).json({ error: "The bank import registration changed. Please try the same file again." });
      return;
    }
    const rows = registration.reused ? await batchRows(registration.batch.id) : [];
    res.status(registration.reused ? 200 : 201).json({
      batch: publicBatch(registration.batch),
      rows,
      proposal,
      reused: registration.reused,
    });
  } catch (err) {
    if (err instanceof BankCsvError) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err, "Failed to register bank CSV");
    res.status(500).json({ error: "Could not register this bank CSV" });
  }
});

// GET /profiles/:profileId/bank-imports/:batchId — resume owned batch and preview
router.get("/profiles/:profileId/bank-imports/:batchId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    let proposal: ReturnType<typeof suggestBankMapping> | undefined;
    if (batch.status === "mapping_required") {
      const file = await storageService.getObjectEntityFile(batch.objectPath);
      const [buffer] = await file.download();
      proposal = suggestBankMapping(parseBankCsv(buffer).rows);
    }
    res.json({ batch: publicBatch(batch), rows: await batchRows(batch.id), proposal });
  } catch (err) {
    req.log.error(err, "Failed to read bank import");
    res.status(500).json({ error: "Could not load this bank import" });
  }
});

// POST /profiles/:profileId/bank-imports/:batchId/preview — mapping is non-mutating
router.post("/profiles/:profileId/bank-imports/:batchId/preview", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ mapping: MappingInput }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Confirm a valid bank CSV mapping." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const taxYear = profile.taxYear;
    if (!taxYear) {
      res.status(422).json({ error: "Choose a tax year before previewing a bank import." });
      return;
    }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    if (batch.status === "committed") { res.status(409).json({ error: "This bank import has already been committed." }); return; }
    if (hasActiveLease(batch)) { res.status(409).json({ error: "This bank import is currently committing." }); return; }

    const file = await storageService.getObjectEntityFile(batch.objectPath);
    const [buffer] = await file.download();
    const parsed = parseBankCsv(buffer);
    const mapping = body.data.mapping as BankMapping;
    const mappingError = validateBankMapping(mapping, parsed.rows);
    if (mappingError) { res.status(400).json({ error: mappingError }); return; }
    const parsedRows = parseMappedBankRows(parsed.rows, mapping, taxYear);
    const stagedRows = await previewRowsForProfile(profile.id, batch.financialAccountId, parsedRows);
    const stats = previewStats(stagedRows);

    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(bankImportBatchesTable).where(and(
        eq(bankImportBatchesTable.id, batch.id),
        eq(bankImportBatchesTable.profileId, profile.id),
      )).for("update");
      if (!current || current.status === "committed") return null;
      if (hasActiveLease(current)) return "busy" as const;
      await tx.delete(bankImportRowsTable).where(eq(bankImportRowsTable.batchId, batch.id));
      const rowsToInsert = stagedRows.map((row) => ({
        batchId: batch.id,
        sourceRowNumber: row.sourceRowNumber,
        sourceFingerprint: row.sourceFingerprint ?? `invalid:${row.sourceRowNumber}`,
        occurrenceIdentity: row.occurrenceIdentity,
        date: row.date,
        amount: row.amount,
        direction: row.direction,
        description: row.description,
        reference: row.reference,
        balance: row.balance,
        validationStatus: row.validationStatus,
        duplicateStatus: row.duplicateStatus,
        validationErrors: row.validationErrors,
        selectedForCommit: row.selectedForCommit,
        rawRowData: row.rawRowData,
      }));
      if (rowsToInsert.length) await tx.insert(bankImportRowsTable).values(rowsToInsert);
      const [updated] = await tx.update(bankImportBatchesTable).set({
        taxYearSnapshot: taxYear,
        accountingBasisSnapshot: profile.accountingBasis,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
        confirmedMapping: mapping,
        mappingVersion: current.mappingVersion + 1,
        previewVersion: current.previewVersion + 1,
        status: "preview_ready",
        ...stats,
        lastError: null,
        processingToken: null,
        processingLeaseExpiresAt: null,
      }).where(eq(bankImportBatchesTable.id, batch.id)).returning();
      return updated;
    });
    if (result === "busy") { res.status(409).json({ error: "This bank import is currently committing." }); return; }
    if (!result) { res.status(409).json({ error: "This bank import can no longer be previewed." }); return; }
    res.json({ batch: publicBatch(result), rows: await batchRows(result.id) });
  } catch (err) {
    if (err instanceof BankCsvError) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err, "Failed to preview bank import");
    res.status(500).json({ error: "Could not build the bank import preview" });
  }
});

// PATCH /profiles/:profileId/bank-imports/:batchId/rows — explicit duplicate choices
router.patch("/profiles/:profileId/bank-imports/:batchId/rows", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({
    selections: z.array(z.object({ rowId: z.string().uuid(), selectedForCommit: z.boolean() })).min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose at least one preview row." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    if (batch.status !== "preview_ready" || hasActiveLease(batch)) {
      res.status(409).json({ error: "Create a fresh preview before changing selected rows." });
      return;
    }
    const outcome = await db.transaction(async (tx) => {
      const [lockedBatch] = await tx.select().from(bankImportBatchesTable).where(and(
        eq(bankImportBatchesTable.id, batch.id),
        eq(bankImportBatchesTable.profileId, profile.id),
      )).for("update");
      if (!lockedBatch || lockedBatch.status !== "preview_ready" || hasActiveLease(lockedBatch)) {
        return "stale" as const;
      }
      const rows = await tx.select().from(bankImportRowsTable)
        .where(eq(bankImportRowsTable.batchId, batch.id))
        .for("update");
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      for (const selection of body.data.selections) {
        const row = rowsById.get(selection.rowId);
        if (!row) return "missing" as const;
        if (row.validationStatus !== "valid" || row.duplicateStatus === "already_imported") {
          return "invalid" as const;
        }
      }
      for (const selection of body.data.selections) {
        await tx.update(bankImportRowsTable).set({ selectedForCommit: selection.selectedForCommit })
          .where(and(eq(bankImportRowsTable.id, selection.rowId), eq(bankImportRowsTable.batchId, batch.id)));
      }
      const updatedRows = await tx.select().from(bankImportRowsTable)
        .where(eq(bankImportRowsTable.batchId, batch.id));
      const [updatedBatch] = await tx.update(bankImportBatchesTable).set({
        selectedRows: updatedRows.filter((row) => row.selectedForCommit).length,
      }).where(eq(bankImportBatchesTable.id, batch.id)).returning();
      return { updatedBatch };
    });
    if (outcome === "stale") { res.status(409).json({ error: "This bank import is currently committing or has changed." }); return; }
    if (outcome === "missing") { res.status(404).json({ error: "Preview row not found" }); return; }
    if (outcome === "invalid") { res.status(422).json({ error: "Only valid non-imported rows can be selected." }); return; }
    const updated = await ownedBatch(profile.id, batch.id);
    res.json({ batch: publicBatch(updated!), rows: await batchRows(batch.id) });
  } catch (err) {
    req.log.error(err, "Failed to update bank import selections");
    res.status(500).json({ error: "Could not update preview selections" });
  }
});

// POST /profiles/:profileId/bank-imports/:batchId/commit — exactly-once canonical ledger commit
router.post("/profiles/:profileId/bank-imports/:batchId/commit", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = z.object({ previewVersion: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A current preview version is required." }); return; }
  let processingToken = "";
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    if (batch.status === "committed") {
      res.json({ batch: publicBatch(batch), rows: await batchRows(batch.id), replayed: true });
      return;
    }
    const expiredCommitLease = batch.status === "committing" && !hasActiveLease(batch);
    if (
      batch.previewVersion !== body.data.previewVersion
      || (batch.status !== "preview_ready" && !expiredCommitLease)
    ) {
      res.status(409).json({ error: "This preview is no longer current. Review the CSV again before importing." });
      return;
    }
    if (profile.taxYear !== batch.taxYearSnapshot || profile.accountingBasis !== batch.accountingBasisSnapshot) {
      res.status(409).json({ error: "Your profile tax year or accounting basis changed. Create a fresh preview before importing." });
      return;
    }
    processingToken = randomUUID();
    const now = new Date();
    const [claimed] = await db.update(bankImportBatchesTable).set({
      status: "committing",
      processingToken,
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    }).where(and(
      eq(bankImportBatchesTable.id, batch.id),
      eq(bankImportBatchesTable.profileId, profile.id),
      eq(bankImportBatchesTable.previewVersion, body.data.previewVersion),
      or(
        eq(bankImportBatchesTable.status, "preview_ready"),
        and(eq(bankImportBatchesTable.status, "committing"), or(
          isNull(bankImportBatchesTable.processingLeaseExpiresAt),
          lt(bankImportBatchesTable.processingLeaseExpiresAt, now),
        )),
      ),
    )).returning();
    if (!claimed) { res.status(409).json({ error: "This bank import is already being committed." }); return; }

    const committed = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(bankImportBatchesTable).where(and(
        eq(bankImportBatchesTable.id, batch.id),
        eq(bankImportBatchesTable.profileId, profile.id),
        eq(bankImportBatchesTable.processingToken, processingToken),
        eq(bankImportBatchesTable.status, "committing"),
      )).for("update");
      if (!locked) return null;
      const rows = await tx.select().from(bankImportRowsTable)
        .where(eq(bankImportRowsTable.batchId, locked.id))
        .for("update");
      const selected = rows.filter((row) =>
        row.selectedForCommit
        && row.validationStatus === "valid"
        && row.duplicateStatus !== "already_imported"
        && !row.canonicalTransactionId,
      );
      for (const row of selected) {
        const snapshot = {
          sourceRowNumber: row.sourceRowNumber,
          date: row.date,
          amount: row.amount,
          direction: row.direction,
          description: row.description,
          reference: row.reference,
          balance: row.balance,
          rawRowData: row.rawRowData,
          mapping: locked.confirmedMapping,
        };
        let transactionId: string | null = null;
        const bankMovementIdentity = `${row.sourceFingerprint}:${row.occurrenceIdentity}`;
        const [transaction] = await tx.insert(transactionsTable).values({
          profileId: profile.id,
          date: row.date!,
          description: row.reference ? `${row.description} · ${row.reference}` : row.description!,
          amount: row.amount!,
          // This is deliberately not derived from bank direction.
          recordType: "unknown",
          category: "unknown",
          taxTreatment: "unreviewed",
          source: "bank_csv",
          evidenceTier: 2,
          rawRowData: row.rawRowData,
          accountingClassification: "unknown",
          financialAccountId: locked.financialAccountId,
          bankImportBatchId: locked.id,
          bankImportRowId: row.id,
          bankMovementIdentity,
          originalImportSnapshot: snapshot,
          ledgerStatus: "active",
        }).returning({ id: transactionsTable.id });
        transactionId = transaction.id;
        await tx.update(bankImportRowsTable).set({ canonicalTransactionId: transactionId })
          .where(eq(bankImportRowsTable.id, row.id));
      }
      const completeRows = await tx.select().from(bankImportRowsTable)
        .where(eq(bankImportRowsTable.batchId, locked.id));
      const [updated] = await tx.update(bankImportBatchesTable).set({
        status: "committed",
        committedRows: completeRows.filter((row) => row.canonicalTransactionId).length,
        selectedRows: completeRows.filter((row) => row.selectedForCommit).length,
        processingToken: null,
        processingLeaseExpiresAt: null,
        lastError: null,
      }).where(and(
        eq(bankImportBatchesTable.id, locked.id),
        eq(bankImportBatchesTable.processingToken, processingToken),
      )).returning();
      return updated ?? null;
    });
    if (!committed) { res.status(409).json({ error: "This bank import was reclaimed by another request." }); return; }
    res.json({ batch: publicBatch(committed), rows: await batchRows(committed.id), replayed: false });
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-bank-import reconciliation scan failed"));
  } catch (err) {
    req.log.error(err, "Failed to commit bank import");
    const databaseCode = (err as { code?: string; cause?: { code?: string } }).code
      ?? (err as { cause?: { code?: string } }).cause?.code;
    if (databaseCode === "23505") {
      const message = "A matching bank movement was committed by another import. The preview was refreshed so you can decide what to include.";
      if (processingToken) {
        await db.update(bankImportBatchesTable).set({
          status: "preview_ready",
          processingToken: null,
          processingLeaseExpiresAt: null,
          lastError: message,
        }).where(and(
          eq(bankImportBatchesTable.id, req.params.batchId),
          eq(bankImportBatchesTable.processingToken, processingToken),
        ));
      }
      res.status(409).json({ error: message, refreshPreview: true });
      return;
    }
    if (processingToken) {
      await db.update(bankImportBatchesTable).set({
        status: "failed",
        lastError: "The commit stopped before completing. You can safely resume from the saved preview.",
        processingToken: null,
        processingLeaseExpiresAt: null,
      }).where(and(
        eq(bankImportBatchesTable.id, req.params.batchId),
        eq(bankImportBatchesTable.processingToken, processingToken),
      )).catch(() => undefined);
    }
    res.status(500).json({ error: "Could not commit this bank import" });
  }
});

// DELETE /profiles/:profileId/bank-imports/:batchId — discard only non-committed work
router.delete("/profiles/:profileId/bank-imports/:batchId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    if (batch.status === "committed") { res.status(409).json({ error: "Committed bank imports cannot be discarded." }); return; }
    if (hasActiveLease(batch)) { res.status(409).json({ error: "This bank import is currently committing." }); return; }
    const [discarded] = await db.update(bankImportBatchesTable).set({
      status: "discarded",
      processingToken: null,
      processingLeaseExpiresAt: null,
    }).where(and(
      eq(bankImportBatchesTable.id, batch.id),
      eq(bankImportBatchesTable.profileId, profile.id),
    )).returning();
    res.json({ batch: publicBatch(discarded) });
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-bank-import reconciliation scan failed"));
  } catch (err) {
    req.log.error(err, "Failed to discard bank import");
    res.status(500).json({ error: "Could not discard this bank import" });
  }
});

// GET /profiles/:profileId/bank-imports/:batchId/file — profile-owned private download
router.get("/profiles/:profileId/bank-imports/:batchId/file", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const batch = await ownedBatch(profile.id, req.params.batchId);
    if (!batch) { res.status(404).json({ error: "Bank import not found" }); return; }
    const file = await storageService.getObjectEntityFile(batch.objectPath);
    const response = await storageService.downloadObject(file, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${batch.filename.replace(/["\r\n]/g, "")}"`);
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (err) {
    req.log.error(err, "Failed to download bank import CSV");
    res.status(500).json({ error: "Could not download this bank CSV" });
  }
});

async function ownedBatch(profileId: string, batchId: string): Promise<Batch | null> {
  const [batch] = await db.select().from(bankImportBatchesTable).where(and(
    eq(bankImportBatchesTable.id, batchId),
    eq(bankImportBatchesTable.profileId, profileId),
  )).limit(1);
  return batch ?? null;
}

async function batchRows(batchId: string): Promise<BankRow[]> {
  return db.select().from(bankImportRowsTable)
    .where(eq(bankImportRowsTable.batchId, batchId))
    .orderBy(bankImportRowsTable.sourceRowNumber);
}

function hasActiveLease(batch: Batch): boolean {
  return batch.status === "committing"
    && (!batch.processingLeaseExpiresAt || batch.processingLeaseExpiresAt > new Date());
}

function publicBatch(batch: Batch) {
  // Object paths are never part of a browser-facing batch response.
  const { objectPath: _objectPath, processingToken: _processingToken, ...safe } = batch;
  return safe;
}

type PreviewRow = ReturnType<typeof parseMappedBankRows>[number] & {
  duplicateStatus: "none" | "already_imported" | "possible_duplicate";
  selectedForCommit: boolean;
  occurrenceIdentity: number;
};

export async function previewRowsForProfile(
  profileId: string,
  financialAccountId: string,
  parsedRows: ReturnType<typeof parseMappedBankRows>,
): Promise<PreviewRow[]> {
  const committed = await db.select({
    sourceFingerprint: bankImportRowsTable.sourceFingerprint,
    reference: bankImportRowsTable.reference,
  }).from(bankImportRowsTable)
    .innerJoin(bankImportBatchesTable, eq(bankImportRowsTable.batchId, bankImportBatchesTable.id))
    .where(and(
      eq(bankImportBatchesTable.profileId, profileId),
      eq(bankImportBatchesTable.financialAccountId, financialAccountId),
      eq(bankImportBatchesTable.status, "committed"),
      isNotNull(bankImportRowsTable.canonicalTransactionId),
    ));
  const importedByFingerprint = new Map(committed.map((row) => [
    row.sourceFingerprint,
    row.reference,
  ]));
  const occurrences = new Map<string, number>();
  const preview = parsedRows.map((row) => {
    const occurrenceIdentity = row.sourceFingerprint
      ? (occurrences.get(row.sourceFingerprint) ?? 0) + 1
      : 1;
    if (row.sourceFingerprint) occurrences.set(row.sourceFingerprint, occurrenceIdentity);
    const priorReference = row.sourceFingerprint ? importedByFingerprint.get(row.sourceFingerprint) : undefined;
    const hasStableReference = Boolean(row.reference?.trim());
    const hasPrior = priorReference !== undefined;
    const duplicateStatus = row.validationStatus !== "valid"
      ? "none"
      : hasPrior && hasStableReference && Boolean(priorReference?.trim())
        ? "already_imported"
        : hasPrior || (!hasStableReference && occurrenceIdentity > 1)
          ? "possible_duplicate"
          : "none";
    return {
      ...row,
      duplicateStatus,
      selectedForCommit: row.validationStatus === "valid" && duplicateStatus === "none",
      occurrenceIdentity,
    } satisfies PreviewRow;
  });
  // When no stable reference exists, every indistinguishable same-file movement
  // needs an explicit decision rather than silently retaining the first row.
  const unreferencedGroups = new Map<string, PreviewRow[]>();
  for (const row of preview) {
    if (row.validationStatus === "valid" && row.sourceFingerprint && !row.reference?.trim()) {
      const group = unreferencedGroups.get(row.sourceFingerprint) ?? [];
      group.push(row);
      unreferencedGroups.set(row.sourceFingerprint, group);
    }
  }
  for (const group of unreferencedGroups.values()) {
    if (group.length > 1) {
      for (const row of group) {
        row.duplicateStatus = "possible_duplicate";
        row.selectedForCommit = false;
      }
    }
  }
  return preview;
}

function previewStats(rows: PreviewRow[]) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.validationStatus === "valid").length,
    invalidRows: rows.filter((row) => row.validationStatus === "invalid").length,
    duplicateRows: rows.filter((row) => row.duplicateStatus === "already_imported").length,
    possibleDuplicateRows: rows.filter((row) => row.duplicateStatus === "possible_duplicate").length,
    outOfScopeRows: rows.filter((row) => row.validationStatus === "out_of_scope").length,
    selectedRows: rows.filter((row) => row.selectedForCommit).length,
  };
}

export default router;