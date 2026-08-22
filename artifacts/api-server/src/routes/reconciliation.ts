import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
} from "drizzle-orm";
import { z } from "zod";
import {
  bankImportBatchesTable,
  bankImportRowsTable,
  db,
  evidenceItemsTable,
  evidenceTransactionLinksTable,
  financialAccountsTable,
  reconciliationCoverageChecksTable,
  reconciliationEventsTable,
  reconciliationExceptionsTable,
  reconciliationSupportExpectationsTable,
  transactionsTable,
} from "@workspace/db";
import { requireProfile } from "./profiles.js";

const router = Router();
const DETECTOR_VERSION = 1;

const classification = z.enum([
  "income", "expense", "transfer", "owner_funds", "drawings", "loan", "tax_payment", "unknown",
]);

const resolutionInput = z.object({
  action: z.enum([
    "acknowledge",
    "dismiss",
    "classify_transaction",
    "attach_evidence",
    "detach_evidence",
    "audit_void",
    "retain_both",
    "return_to_staging",
    "confirm_coverage",
    "set_support_expectation",
  ]),
  expectedRevision: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
  transactionId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
  coverageCheckId: z.string().uuid().optional(),
  expectationState: z.enum(["required", "not_required", "unspecified"]).optional(),
  expectationSource: z.string().trim().max(120).optional(),
  fields: z.object({
    date: z.string().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    amount: z.number().refine(value => value !== 0, "Amount must be non-zero").optional(),
    category: z.string().trim().min(1).optional(),
    taxTreatment: z.string().trim().min(1).optional(),
    accountingClassification: classification.optional(),
  }).strict().optional(),
}).strict();

const coverageInput = z.object({
  accountId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completeExpectedCoverage: z.boolean(),
  statementClosingBalance: z.number().finite().optional().nullable(),
  statementSourceBatchId: z.string().uuid().optional().nullable(),
  statementEndpointRowId: z.string().uuid().optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.periodEnd < value.periodStart) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "The period end must be on or after the start." });
  }
  if (value.statementEndpointRowId && !value.statementSourceBatchId) {
    ctx.addIssue({ code: "custom", path: ["statementSourceBatchId"], message: "A statement source batch is required for an endpoint row." });
  }
});

type Observation = {
  ruleKey: string;
  exceptionType: string;
  severity: "low" | "medium" | "high" | "critical";
  sourceKind: string;
  sourceId: string;
  observedFacts: Record<string, unknown>;
};

function observationScope(observation: Pick<Observation, "ruleKey" | "sourceKind" | "sourceId">) {
  return `${observation.ruleKey}\u0000${observation.sourceKind}\u0000${observation.sourceId}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function fingerprint(observedFacts: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(observedFacts)).digest("hex");
}

function publicException(exception: typeof reconciliationExceptionsTable.$inferSelect) {
  return {
    ...exception,
    observedFacts: exception.observedFacts ?? {},
    source: {
      kind: exception.sourceKind,
      id: exception.sourceId,
    },
  };
}

function severityFor(ruleKey: string): Observation["severity"] {
  switch (ruleKey) {
    case "unclassified_bank_transaction": return "high";
    case "missing_required_support": return "medium";
    case "possible_duplicate_candidate": return "high";
    case "statement_balance_discrepancy": return "high";
    case "no_activity_in_declared_period": return "medium";
    default: return "low";
  }
}

async function materializeObservation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  profileId: string,
  observation: Observation,
  activeScopes: Set<string>,
) {
  activeScopes.add(observationScope(observation));
  const observedFingerprint = fingerprint(observation.observedFacts);
  const prior = await tx.select().from(reconciliationExceptionsTable).where(and(
    eq(reconciliationExceptionsTable.profileId, profileId),
    eq(reconciliationExceptionsTable.ruleKey, observation.ruleKey),
    eq(reconciliationExceptionsTable.sourceKind, observation.sourceKind),
    eq(reconciliationExceptionsTable.sourceId, observation.sourceId),
    eq(reconciliationExceptionsTable.observationFingerprint, observedFingerprint),
  )).limit(1);
  const [existing] = prior;

  // A changed source observation makes every prior revision non-current. A
  // resolved revision remains resolved for history; open/dismissed revisions
  // are explicitly superseded and can never suppress the new observation.
  await tx.update(reconciliationExceptionsTable).set({
    isCurrent: false,
    ...(existing ? {} : { status: "superseded", resolvedAt: new Date() }),
  }).where(and(
    eq(reconciliationExceptionsTable.profileId, profileId),
    eq(reconciliationExceptionsTable.ruleKey, observation.ruleKey),
    eq(reconciliationExceptionsTable.sourceKind, observation.sourceKind),
    eq(reconciliationExceptionsTable.sourceId, observation.sourceId),
    ne(reconciliationExceptionsTable.observationFingerprint, observedFingerprint),
    eq(reconciliationExceptionsTable.isCurrent, true),
  ));

  if (existing) {
    if (!existing.isCurrent || ["resolved", "superseded"].includes(existing.status)) {
      // Dismissals are deliberately revision-scoped: an identical reappearing
      // observation remains dismissed, while resolved/superseded observations
      // become a fresh open review item.
      const [current] = await tx.update(reconciliationExceptionsTable).set({
        isCurrent: true,
        ...(existing.status === "dismissed" ? {} : {
          status: "open",
          currentResolutionSummary: null,
          resolvedAt: null,
          claimToken: null,
          claimedByUserId: null,
          claimedAt: null,
        }),
      })
        .where(eq(reconciliationExceptionsTable.id, existing.id)).returning();
      return current ?? existing;
    }
    return existing;
  }

  const [created] = await tx.insert(reconciliationExceptionsTable).values({
    profileId,
    ruleKey: observation.ruleKey,
    exceptionType: observation.exceptionType,
    status: "open",
    severity: observation.severity,
    sourceKind: observation.sourceKind,
    sourceId: observation.sourceId,
    sourceRevision: observedFingerprint,
    observationFingerprint: observedFingerprint,
    observedFacts: observation.observedFacts,
    detectorVersion: DETECTOR_VERSION,
    isCurrent: true,
  }).onConflictDoNothing({
    target: [
      reconciliationExceptionsTable.profileId,
      reconciliationExceptionsTable.ruleKey,
      reconciliationExceptionsTable.sourceKind,
      reconciliationExceptionsTable.sourceId,
      reconciliationExceptionsTable.observationFingerprint,
    ],
  }).returning();
  if (created) return created;
  const [concurrent] = await tx.select().from(reconciliationExceptionsTable).where(and(
    eq(reconciliationExceptionsTable.profileId, profileId),
    eq(reconciliationExceptionsTable.ruleKey, observation.ruleKey),
    eq(reconciliationExceptionsTable.sourceKind, observation.sourceKind),
    eq(reconciliationExceptionsTable.sourceId, observation.sourceId),
    eq(reconciliationExceptionsTable.observationFingerprint, observedFingerprint),
  )).limit(1);
  if (!concurrent) throw new Error("Reconciliation observation could not be materialized");
  return concurrent;
}

async function calculateCoverage(
  profileId: string,
  check: typeof reconciliationCoverageChecksTable.$inferSelect,
  // Both the pooled DB client and a Drizzle transaction support the same
  // select chain. Keep the adapter narrow so coverage validation always runs
  // inside the caller's transaction when one is supplied.
  queryDb: { select: (...args: any[]) => any } = db,
) {
  const transactions: Array<{ id: string; date: string; amount: number; description: string }> = await queryDb.select({
    id: transactionsTable.id,
    date: transactionsTable.date,
    amount: transactionsTable.amount,
    description: transactionsTable.description,
  }).from(transactionsTable).where(and(
    eq(transactionsTable.profileId, profileId),
    eq(transactionsTable.financialAccountId, check.financialAccountId),
    eq(transactionsTable.ledgerStatus, "active"),
  ));
  const inPeriod = transactions.filter(transaction => transaction.date >= check.periodStart && transaction.date <= check.periodEnd);

  let endpointBalance: number | null = null;
  let endpointDate: string | null = null;
  let endpointValid = false;
  if (check.statementEndpointRowId) {
    const [endpoint] = await queryDb.select({
      balance: bankImportRowsTable.balance,
      date: bankImportRowsTable.date,
      batchId: bankImportRowsTable.batchId,
    }).from(bankImportRowsTable).where(eq(bankImportRowsTable.id, check.statementEndpointRowId)).limit(1);
    if (endpoint) {
      const [batch] = await queryDb.select({
        financialAccountId: bankImportBatchesTable.financialAccountId,
        profileId: bankImportBatchesTable.profileId,
        id: bankImportBatchesTable.id,
      }).from(bankImportBatchesTable).where(eq(bankImportBatchesTable.id, endpoint.batchId)).limit(1);
      endpointValid = batch?.profileId === profileId
        && batch.financialAccountId === check.financialAccountId
        && check.statementSourceBatchId === batch.id
        && endpoint.balance !== null
        && !!endpoint.date
        && endpoint.date >= check.periodStart
        && endpoint.date <= check.periodEnd;
      if (endpointValid) {
        endpointBalance = endpoint.balance;
        endpointDate = endpoint.date;
      }
    }
  }

  const difference = endpointValid && check.statementClosingBalance !== null
    ? Math.round((check.statementClosingBalance! - endpointBalance!) * 100) / 100
    : null;
  const facts = {
    accountId: check.financialAccountId,
    periodStart: check.periodStart,
    periodEnd: check.periodEnd,
    completeExpectedCoverage: check.completeExpectedCoverage,
    transactionCount: inPeriod.length,
    transactionIds: inPeriod.map(transaction => transaction.id),
    noActivityEligible: check.completeExpectedCoverage && inPeriod.length === 0,
    declaredClosingBalance: check.statementClosingBalance,
    statementEndpoint: endpointValid
      ? { rowId: check.statementEndpointRowId, date: endpointDate, balance: endpointBalance }
      : null,
    statementBalanceComparison: difference === null ? "not_available" : difference === 0 ? "matches" : "discrepancy",
    balanceDifference: difference,
  };
  return facts;
}

async function scanProfile(profileId: string) {
  const materialized: typeof reconciliationExceptionsTable.$inferSelect[] = [];
  const activeScopes = new Set<string>();
  await db.transaction(async (tx) => {
    const activeTransactions = await tx.select().from(transactionsTable).where(and(
      eq(transactionsTable.profileId, profileId),
      eq(transactionsTable.ledgerStatus, "active"),
    ));

    for (const transaction of activeTransactions) {
      if (
        transaction.source === "bank_csv"
        && (transaction.accountingClassification === null
          || transaction.accountingClassification === "unknown"
          || transaction.recordType === "unknown")
      ) {
        materialized.push(await materializeObservation(tx, profileId, {
          ruleKey: "unclassified_bank_transaction",
          exceptionType: "classification_review",
          severity: severityFor("unclassified_bank_transaction"),
          sourceKind: "canonical_transaction",
          sourceId: transaction.id,
          observedFacts: {
            transactionId: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            source: transaction.source,
            accountingClassification: transaction.accountingClassification,
            recordType: transaction.recordType,
            financialAccountId: transaction.financialAccountId,
            bankImportBatchId: transaction.bankImportBatchId,
            bankImportRowId: transaction.bankImportRowId,
          },
        }, activeScopes));
      }
    }

    const expectations = await tx.select().from(reconciliationSupportExpectationsTable).where(and(
      eq(reconciliationSupportExpectationsTable.profileId, profileId),
      eq(reconciliationSupportExpectationsTable.expectationState, "required"),
    ));
    for (const expectation of expectations) {
      const [activeLink] = await tx.select({ id: evidenceTransactionLinksTable.id }).from(evidenceTransactionLinksTable).where(and(
        eq(evidenceTransactionLinksTable.profileId, profileId),
        eq(evidenceTransactionLinksTable.transactionId, expectation.transactionId),
        eq(evidenceTransactionLinksTable.linkStatus, "active"),
      )).limit(1);
      if (!activeLink) {
        const [transaction] = await tx.select({
          id: transactionsTable.id,
          date: transactionsTable.date,
          description: transactionsTable.description,
          amount: transactionsTable.amount,
        }).from(transactionsTable).where(and(
          eq(transactionsTable.id, expectation.transactionId),
          eq(transactionsTable.profileId, profileId),
          eq(transactionsTable.ledgerStatus, "active"),
        )).limit(1);
        if (!transaction) continue;
        materialized.push(await materializeObservation(tx, profileId, {
          ruleKey: "missing_required_support",
          exceptionType: "missing_support",
          severity: severityFor("missing_required_support"),
          sourceKind: "canonical_transaction",
          sourceId: transaction.id,
          observedFacts: {
            transactionId: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            expectation: {
              id: expectation.id,
              state: expectation.expectationState,
              reason: expectation.reason,
              source: expectation.source,
              changedAt: expectation.changedAt,
            },
            activeSupportedRelationship: false,
          },
        }, activeScopes));
      }
    }

    const [batches, rows] = await Promise.all([
      tx.select().from(bankImportBatchesTable).where(eq(bankImportBatchesTable.profileId, profileId)),
      tx.select().from(bankImportRowsTable).innerJoin(
        bankImportBatchesTable,
        eq(bankImportRowsTable.batchId, bankImportBatchesTable.id),
      ).where(and(
        eq(bankImportBatchesTable.profileId, profileId),
        eq(bankImportRowsTable.duplicateStatus, "possible_duplicate"),
      )),
    ]);
    for (const joined of rows) {
      const row = joined.bank_import_rows;
      const batch = joined.bank_import_batches;
      materialized.push(await materializeObservation(tx, profileId, {
        ruleKey: "possible_duplicate_candidate",
        exceptionType: "possible_duplicate",
        severity: severityFor("possible_duplicate_candidate"),
        sourceKind: "bank_import_row",
        sourceId: row.id,
        observedFacts: {
          rowId: row.id,
          batchId: batch.id,
          filename: batch.filename,
          financialAccountId: batch.financialAccountId,
          sourceRowNumber: row.sourceRowNumber,
          sourceFingerprint: row.sourceFingerprint,
          date: row.date,
          amount: row.amount,
          direction: row.direction,
          description: row.description,
          reference: row.reference,
          duplicateStatus: row.duplicateStatus,
          previewVersion: batch.previewVersion,
        },
      }, activeScopes));
    }

    const checks = await tx.select().from(reconciliationCoverageChecksTable).where(eq(
      reconciliationCoverageChecksTable.profileId,
      profileId,
    ));
    for (const check of checks) {
      const facts = await calculateCoverage(profileId, check, tx);
      await tx.update(reconciliationCoverageChecksTable).set({ calculatedFacts: facts })
        .where(eq(reconciliationCoverageChecksTable.id, check.id));
      if (!check.completeExpectedCoverage) continue;
      if (facts.noActivityEligible) {
        materialized.push(await materializeObservation(tx, profileId, {
          ruleKey: "no_activity_in_declared_period",
          exceptionType: "coverage_gap",
          severity: severityFor("no_activity_in_declared_period"),
          sourceKind: "coverage_check",
          sourceId: check.id,
          observedFacts: facts,
        }, activeScopes));
      }
      if (facts.statementBalanceComparison === "discrepancy") {
        materialized.push(await materializeObservation(tx, profileId, {
          ruleKey: "statement_balance_discrepancy",
          exceptionType: "balance_review",
          severity: severityFor("statement_balance_discrepancy"),
          sourceKind: "coverage_check",
          sourceId: check.id,
          observedFacts: facts,
        }, activeScopes));
      }
    }

    const detectorRules = [
      "unclassified_bank_transaction",
      "missing_required_support",
      "possible_duplicate_candidate",
      "no_activity_in_declared_period",
      "statement_balance_discrepancy",
    ];
    const currentExceptions = await tx.select().from(reconciliationExceptionsTable).where(and(
      eq(reconciliationExceptionsTable.profileId, profileId),
      eq(reconciliationExceptionsTable.isCurrent, true),
      inArray(reconciliationExceptionsTable.ruleKey, detectorRules),
    ));
    for (const exception of currentExceptions) {
      if (activeScopes.has(observationScope(exception))) continue;
      await tx.update(reconciliationExceptionsTable).set({
        isCurrent: false,
        status: exception.status === "dismissed" ? "dismissed" : "superseded",
        resolvedAt: exception.resolvedAt ?? new Date(),
        claimToken: null,
        claimedByUserId: null,
        claimedAt: null,
      }).where(eq(reconciliationExceptionsTable.id, exception.id));
    }

    // Keep the scanner fact-only: workflow references are computed from the
    // staging owner and are never copied into reconciliation exception state.
    void batches;
  });

  const exceptions = await db.select().from(reconciliationExceptionsTable).where(and(
    eq(reconciliationExceptionsTable.profileId, profileId),
    eq(reconciliationExceptionsTable.isCurrent, true),
  )).orderBy(desc(reconciliationExceptionsTable.updatedAt));
  return exceptions.map(publicException);
}

async function workflowReferences(profileId: string) {
  const batches = await db.select({
    id: bankImportBatchesTable.id,
    filename: bankImportBatchesTable.filename,
    status: bankImportBatchesTable.status,
    financialAccountId: bankImportBatchesTable.financialAccountId,
    updatedAt: bankImportBatchesTable.updatedAt,
  }).from(bankImportBatchesTable).where(and(
    eq(bankImportBatchesTable.profileId, profileId),
    inArray(bankImportBatchesTable.status, ["mapping_required", "preview_ready", "committing", "failed"]),
  )).orderBy(desc(bankImportBatchesTable.updatedAt));
  return batches.map(batch => ({
    id: batch.id,
    kind: "staged_bank_import",
    title: batch.status === "mapping_required"
      ? `Map ${batch.filename}`
      : batch.status === "preview_ready"
        ? `Review duplicate choices for ${batch.filename}`
        : batch.status === "committing"
          ? `Resume ${batch.filename}`
          : `Review failed import ${batch.filename}`,
    status: batch.status,
    source: { batchId: batch.id, financialAccountId: batch.financialAccountId },
    href: `/ingest?batch=${encodeURIComponent(batch.id)}`,
    updatedAt: batch.updatedAt,
  }));
}

async function responseForProfile(profileId: string) {
  const [exceptions, workflows, coverageChecks] = await Promise.all([
    scanProfile(profileId),
    workflowReferences(profileId),
    db.select().from(reconciliationCoverageChecksTable)
      .where(eq(reconciliationCoverageChecksTable.profileId, profileId))
      .orderBy(desc(reconciliationCoverageChecksTable.updatedAt)),
  ]);
  return { exceptions, workflowTasks: workflows, coverageChecks };
}

// GET /profiles/:profileId/reconciliation
router.get("/profiles/:profileId/reconciliation", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const result = await responseForProfile(profile.id);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (status || type) {
      result.exceptions = result.exceptions.filter(item =>
        (!status || item.status === status) && (!type || item.exceptionType === type),
      );
    }
    res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to load reconciliation review");
    res.status(500).json({ error: "Could not load reconciliation review" });
  }
});

// GET /profiles/:profileId/reconciliation/exceptions/:exceptionId
router.get("/profiles/:profileId/reconciliation/exceptions/:exceptionId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const [exception] = await db.select().from(reconciliationExceptionsTable).where(and(
      eq(reconciliationExceptionsTable.id, req.params.exceptionId),
      eq(reconciliationExceptionsTable.profileId, profile.id),
    )).limit(1);
    if (!exception) { res.status(404).json({ error: "Reconciliation item not found" }); return; }
    const events = await db.select().from(reconciliationEventsTable).where(and(
      eq(reconciliationEventsTable.exceptionId, exception.id),
      eq(reconciliationEventsTable.profileId, profile.id),
    )).orderBy(desc(reconciliationEventsTable.createdAt));
    res.json({ exception: publicException(exception), events });
  } catch (err) {
    req.log.error(err, "Failed to load reconciliation item");
    res.status(500).json({ error: "Could not load reconciliation item" });
  }
});

// POST /profiles/:profileId/reconciliation/scan
router.post("/profiles/:profileId/reconciliation/scan", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    res.json(await responseForProfile(profile.id));
  } catch (err) {
    req.log.error(err, "Failed to scan reconciliation facts");
    res.status(500).json({ error: "Could not scan reconciliation facts" });
  }
});

async function saveCoverageCheck(profileId: string, userId: string, input: z.infer<typeof coverageInput>, id?: string) {
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(financialAccountsTable).where(and(
      eq(financialAccountsTable.id, input.accountId),
      eq(financialAccountsTable.profileId, profileId),
    )).limit(1);
    if (!account) throw Object.assign(new Error("Financial account not found"), { status: 404 });

    if (input.statementSourceBatchId) {
      const [batch] = await tx.select().from(bankImportBatchesTable).where(and(
        eq(bankImportBatchesTable.id, input.statementSourceBatchId),
        eq(bankImportBatchesTable.profileId, profileId),
        eq(bankImportBatchesTable.financialAccountId, input.accountId),
      )).limit(1);
      if (!batch) throw Object.assign(new Error("Statement source batch is not owned by this account"), { status: 422 });
    }

    if (input.statementEndpointRowId) {
      const [row] = await tx.select().from(bankImportRowsTable).where(and(
        eq(bankImportRowsTable.id, input.statementEndpointRowId),
        eq(bankImportRowsTable.batchId, input.statementSourceBatchId!),
      )).limit(1);
      if (!row) throw Object.assign(new Error("Statement endpoint row is not part of the selected source batch"), { status: 422 });
    }

    const values = {
      profileId,
      financialAccountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      completeExpectedCoverage: input.completeExpectedCoverage,
      statementClosingBalance: input.statementClosingBalance ?? null,
      statementSourceBatchId: input.statementSourceBatchId ?? null,
      statementEndpointRowId: input.statementEndpointRowId ?? null,
      state: id ? "amended" : "declared",
    } as const;
    let check: typeof reconciliationCoverageChecksTable.$inferSelect;
    if (id) {
      const [updated] = await tx.update(reconciliationCoverageChecksTable).set(values).where(and(
        eq(reconciliationCoverageChecksTable.id, id),
        eq(reconciliationCoverageChecksTable.profileId, profileId),
      )).returning();
      if (!updated) throw Object.assign(new Error("Coverage check not found"), { status: 404 });
      check = updated;
    } else {
      [check] = await tx.insert(reconciliationCoverageChecksTable).values(values).returning();
    }
    const facts = await calculateCoverage(profileId, check, tx);
    const [withFacts] = await tx.update(reconciliationCoverageChecksTable).set({ calculatedFacts: facts })
      .where(eq(reconciliationCoverageChecksTable.id, check.id)).returning();
    // The declaration itself is auditable through the coverage exception event
    // when it is later confirmed; this operation never changes Financial Memory.
    void userId;
    return withFacts;
  });
}

router.get("/profiles/:profileId/reconciliation/coverage-checks", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    res.json(await db.select().from(reconciliationCoverageChecksTable)
      .where(eq(reconciliationCoverageChecksTable.profileId, profile.id))
      .orderBy(desc(reconciliationCoverageChecksTable.updatedAt)));
  } catch (err) {
    req.log.error(err, "Failed to list coverage checks");
    res.status(500).json({ error: "Could not load coverage checks" });
  }
});

router.post("/profiles/:profileId/reconciliation/coverage-checks", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = coverageInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid account, complete period, and optional statement metadata." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const check = await saveCoverageCheck(profile.id, req.user.id, body.data);
    res.status(201).json({ coverageCheck: check, ...(await responseForProfile(profile.id)) });
  } catch (err) {
    const error = err as { status?: number; message?: string };
    req.log.error(err, "Failed to create coverage check");
    res.status(error.status ?? 500).json({ error: error.message ?? "Could not create coverage check" });
  }
});

router.patch("/profiles/:profileId/reconciliation/coverage-checks/:checkId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = coverageInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid account, complete period, and optional statement metadata." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const check = await saveCoverageCheck(profile.id, req.user.id, body.data, req.params.checkId);
    res.json({ coverageCheck: check, ...(await responseForProfile(profile.id)) });
  } catch (err) {
    const error = err as { status?: number; message?: string };
    req.log.error(err, "Failed to update coverage check");
    res.status(error.status ?? 500).json({ error: error.message ?? "Could not update coverage check" });
  }
});

router.post("/profiles/:profileId/reconciliation/exceptions/:exceptionId/resolve", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = resolutionInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A valid explicit reconciliation action is required." }); return; }
  try {
    const profile = await requireProfile(req.params.profileId, req.user.id);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    const result = await db.transaction(async (tx) => {
      const [existingEvent] = await tx.select().from(reconciliationEventsTable).where(and(
        eq(reconciliationEventsTable.exceptionId, req.params.exceptionId),
        eq(reconciliationEventsTable.profileId, profile.id),
        eq(reconciliationEventsTable.idempotencyKey, body.data.idempotencyKey),
      )).limit(1);
      if (existingEvent) {
        const [replayed] = await tx.select().from(reconciliationExceptionsTable)
          .where(eq(reconciliationExceptionsTable.id, req.params.exceptionId)).limit(1);
        return { exception: replayed!, replayed: true };
      }

      const [current] = await tx.select().from(reconciliationExceptionsTable).where(and(
        eq(reconciliationExceptionsTable.id, req.params.exceptionId),
        eq(reconciliationExceptionsTable.profileId, profile.id),
      )).for("update");
      if (!current) throw Object.assign(new Error("Reconciliation item not found"), { status: 404 });
      if (current.sourceRevision !== body.data.expectedRevision) {
        throw Object.assign(new Error("This reconciliation item has changed. Refresh before resolving it."), { status: 409 });
      }
      if (["resolved", "dismissed", "superseded"].includes(current.status)) {
        return { exception: current, replayed: true };
      }
      const [claimed] = await tx.update(reconciliationExceptionsTable).set({
        status: "resolving",
        claimToken: randomUUID(),
        claimedByUserId: req.user.id,
        claimedAt: new Date(),
      }).where(and(
        eq(reconciliationExceptionsTable.id, current.id),
        eq(reconciliationExceptionsTable.profileId, profile.id),
        eq(reconciliationExceptionsTable.status, "open"),
        eq(reconciliationExceptionsTable.isCurrent, true),
      )).returning();
      if (!claimed) throw Object.assign(new Error("This reconciliation item is already being resolved"), { status: 409 });

      const action = body.data.action;
      const transactionBoundActions = ["classify_transaction", "attach_evidence", "detach_evidence", "audit_void", "set_support_expectation"];
      if (transactionBoundActions.includes(action)) {
        if (current.sourceKind !== "canonical_transaction") {
          throw Object.assign(new Error("This action is only valid for the exact canonical transaction named by this exception"), { status: 422 });
        }
        if (body.data.transactionId && body.data.transactionId !== current.sourceId) {
          throw Object.assign(new Error("The supplied transaction does not match this reconciliation exception"), { status: 422 });
        }
      }
      const targetTransactionId = transactionBoundActions.includes(action) ? current.sourceId : undefined;
      let beforeSnapshot: unknown = current.observedFacts;
      let afterSnapshot: unknown = current.observedFacts;
      const relationshipRefs: Record<string, unknown> = {};

      if (transactionBoundActions.includes(action)) {
        if (!targetTransactionId) throw Object.assign(new Error("A canonical transaction is required for this action"), { status: 422 });
        const [transaction] = await tx.select().from(transactionsTable).where(and(
          eq(transactionsTable.id, targetTransactionId),
          eq(transactionsTable.profileId, profile.id),
        )).for("update");
        if (!transaction) throw Object.assign(new Error("Transaction not found"), { status: 404 });
        const facts = current.observedFacts as Record<string, unknown>;
        if (current.ruleKey === "unclassified_bank_transaction") {
          const currentFacts = {
            transactionId: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            source: transaction.source,
            accountingClassification: transaction.accountingClassification,
            recordType: transaction.recordType,
            financialAccountId: transaction.financialAccountId,
            bankImportBatchId: transaction.bankImportBatchId,
            bankImportRowId: transaction.bankImportRowId,
          };
          if (fingerprint(currentFacts) !== current.sourceRevision) {
            throw Object.assign(new Error("The source transaction changed. Refresh before resolving it."), { status: 409 });
          }
        } else if (current.ruleKey === "missing_required_support") {
          const [expectation] = await tx.select().from(reconciliationSupportExpectationsTable).where(and(
            eq(reconciliationSupportExpectationsTable.profileId, profile.id),
            eq(reconciliationSupportExpectationsTable.transactionId, transaction.id),
          )).limit(1);
          const [activeLink] = await tx.select({ id: evidenceTransactionLinksTable.id }).from(evidenceTransactionLinksTable).where(and(
            eq(evidenceTransactionLinksTable.profileId, profile.id),
            eq(evidenceTransactionLinksTable.transactionId, transaction.id),
            eq(evidenceTransactionLinksTable.linkStatus, "active"),
          )).limit(1);
          const currentFacts = {
            transactionId: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            expectation: expectation ? {
              id: expectation.id,
              state: expectation.expectationState,
              reason: expectation.reason,
              source: expectation.source,
              changedAt: expectation.changedAt,
            } : null,
            activeSupportedRelationship: Boolean(activeLink),
          };
          if (fingerprint(currentFacts) !== current.sourceRevision || facts.activeSupportedRelationship !== false) {
            throw Object.assign(new Error("The evidence relationship changed. Refresh before resolving it."), { status: 409 });
          }
        }
        beforeSnapshot = transaction;

        if (action === "classify_transaction") {
          if (transaction.ledgerStatus !== "active" || transaction.source !== "bank_csv") {
            throw Object.assign(new Error("Only active bank-imported records can be classified here"), { status: 422 });
          }
          const fields = body.data.fields;
          if (!fields?.accountingClassification) {
            throw Object.assign(new Error("A confirmed accounting classification is required"), { status: 422 });
          }
          const amount = fields.amount ?? transaction.amount;
          const updates: Record<string, unknown> = {
            userOverride: true,
            ...(fields.date !== undefined ? { date: fields.date } : {}),
            ...(fields.description !== undefined ? { description: fields.description } : {}),
            ...(fields.amount !== undefined ? { amount } : {}),
          };
          if (fields.accountingClassification === "income") {
            Object.assign(updates, {
              accountingClassification: "income",
              recordType: "income",
              category: fields.category ?? "income",
              taxTreatment: fields.taxTreatment ?? "income",
            });
          } else if (fields.accountingClassification === "expense") {
            Object.assign(updates, {
              accountingClassification: "expense",
              recordType: "expense",
              category: fields.category ?? "expense",
              taxTreatment: fields.taxTreatment ?? "deductible",
            });
          } else {
            Object.assign(updates, {
              accountingClassification: fields.accountingClassification,
              recordType: "unknown",
              category: fields.category ?? fields.accountingClassification,
              taxTreatment: "unreviewed",
            });
          }
          const [updated] = await tx.update(transactionsTable).set(updates).where(and(
            eq(transactionsTable.id, transaction.id),
            eq(transactionsTable.profileId, profile.id),
          )).returning();
          const [verified] = await tx.select().from(transactionsTable).where(eq(transactionsTable.id, transaction.id)).limit(1);
          if (!verified || verified.accountingClassification !== fields.accountingClassification) throw new Error("Transaction classification verification failed");
          afterSnapshot = verified;
        } else if (action === "audit_void") {
          if (transaction.source !== "bank_csv" || transaction.ledgerStatus !== "active") {
            throw Object.assign(new Error("Only active bank-imported records can be audit-voided"), { status: 422 });
          }
          await tx.update(transactionsTable).set({
            ledgerStatus: "voided",
            voidedAt: new Date(),
            voidReason: body.data.reason ?? "Audit-voided from reconciliation review",
          }).where(and(eq(transactionsTable.id, transaction.id), eq(transactionsTable.profileId, profile.id)));
          const [verified] = await tx.select().from(transactionsTable).where(eq(transactionsTable.id, transaction.id)).limit(1);
          if (!verified || verified.ledgerStatus !== "voided") throw new Error("Transaction void verification failed");
          afterSnapshot = verified;
        } else if (action === "set_support_expectation") {
          if (!body.data.expectationState) throw Object.assign(new Error("A support expectation state is required"), { status: 422 });
          const [previous] = await tx.select().from(reconciliationSupportExpectationsTable).where(and(
            eq(reconciliationSupportExpectationsTable.profileId, profile.id),
            eq(reconciliationSupportExpectationsTable.transactionId, transaction.id),
          )).limit(1);
          const values = {
            profileId: profile.id,
            transactionId: transaction.id,
            expectationState: body.data.expectationState,
            reason: body.data.reason ?? null,
            source: body.data.expectationSource ?? "user",
            changedByUserId: req.user.id,
            changedAt: new Date(),
          } as const;
          if (previous) {
            await tx.update(reconciliationSupportExpectationsTable).set(values)
              .where(eq(reconciliationSupportExpectationsTable.id, previous.id));
          } else {
            await tx.insert(reconciliationSupportExpectationsTable).values(values);
          }
          const [verified] = await tx.select().from(reconciliationSupportExpectationsTable).where(and(
            eq(reconciliationSupportExpectationsTable.profileId, profile.id),
            eq(reconciliationSupportExpectationsTable.transactionId, transaction.id),
          )).limit(1);
          if (!verified || verified.expectationState !== body.data.expectationState) throw new Error("Support expectation verification failed");
          afterSnapshot = verified;
        } else {
          if (!body.data.evidenceId) throw Object.assign(new Error("An evidence item is required"), { status: 422 });
          const [evidence] = await tx.select().from(evidenceItemsTable).where(and(
            eq(evidenceItemsTable.id, body.data.evidenceId),
            eq(evidenceItemsTable.profileId, profile.id),
          )).limit(1);
          if (!evidence || evidence.documentLifecycle !== "active") throw Object.assign(new Error("Evidence item not found or no longer active"), { status: 404 });
          const [link] = await tx.select().from(evidenceTransactionLinksTable).where(and(
            eq(evidenceTransactionLinksTable.profileId, profile.id),
            eq(evidenceTransactionLinksTable.evidenceId, evidence.id),
            eq(evidenceTransactionLinksTable.transactionId, transaction.id),
          )).limit(1);
          if (action === "attach_evidence") {
            if (link) {
              await tx.update(evidenceTransactionLinksTable).set({ linkStatus: "active", detachedAt: null })
                .where(eq(evidenceTransactionLinksTable.id, link.id));
            } else {
              await tx.insert(evidenceTransactionLinksTable).values({
                profileId: profile.id,
                evidenceId: evidence.id,
                transactionId: transaction.id,
                linkStatus: "active",
                linkReason: "reconciliation_support",
              });
            }
            const [verified] = await tx.select().from(evidenceTransactionLinksTable).where(and(
              eq(evidenceTransactionLinksTable.profileId, profile.id),
              eq(evidenceTransactionLinksTable.evidenceId, evidence.id),
              eq(evidenceTransactionLinksTable.transactionId, transaction.id),
              eq(evidenceTransactionLinksTable.linkStatus, "active"),
            )).limit(1);
            if (!verified) throw new Error("Evidence attachment verification failed");
            relationshipRefs.evidenceId = evidence.id;
            afterSnapshot = verified;
          } else {
            if (link) {
              await tx.update(evidenceTransactionLinksTable).set({ linkStatus: "detached", detachedAt: new Date() })
                .where(and(eq(evidenceTransactionLinksTable.id, link.id), eq(evidenceTransactionLinksTable.linkStatus, "active")));
            }
            const [verified] = await tx.select().from(evidenceTransactionLinksTable).where(and(
              eq(evidenceTransactionLinksTable.profileId, profile.id),
              eq(evidenceTransactionLinksTable.evidenceId, evidence.id),
              eq(evidenceTransactionLinksTable.transactionId, transaction.id),
              eq(evidenceTransactionLinksTable.linkStatus, "active"),
            )).limit(1);
            if (verified) throw new Error("Evidence detachment verification failed");
            relationshipRefs.evidenceId = evidence.id;
            afterSnapshot = { linkStatus: "detached" };
          }
        }
      } else if (action === "confirm_coverage") {
        if (current.sourceKind !== "coverage_check") {
          throw Object.assign(new Error("This action is only valid for the exact coverage check named by this exception"), { status: 422 });
        }
        if (body.data.coverageCheckId && body.data.coverageCheckId !== current.sourceId) {
          throw Object.assign(new Error("The supplied coverage check does not match this reconciliation exception"), { status: 422 });
        }
        const checkId = current.sourceId;
        const [check] = await tx.select().from(reconciliationCoverageChecksTable).where(and(
          eq(reconciliationCoverageChecksTable.id, checkId),
          eq(reconciliationCoverageChecksTable.profileId, profile.id),
        )).for("update");
        if (!check) throw Object.assign(new Error("Coverage check not found"), { status: 404 });
        if (fingerprint(await calculateCoverage(profile.id, check, tx)) !== current.sourceRevision) {
          throw Object.assign(new Error("The coverage facts changed. Refresh before resolving it."), { status: 409 });
        }
        await tx.update(reconciliationCoverageChecksTable).set({ state: "confirmed" }).where(eq(reconciliationCoverageChecksTable.id, check.id));
        const [verified] = await tx.select().from(reconciliationCoverageChecksTable).where(eq(reconciliationCoverageChecksTable.id, check.id)).limit(1);
        if (!verified || verified.state !== "confirmed") throw new Error("Coverage confirmation verification failed");
        afterSnapshot = verified;
        relationshipRefs.coverageCheckId = check.id;
      }

      const terminalStatus = action === "dismiss" ? "dismissed" : "resolved";
      const [event] = await tx.insert(reconciliationEventsTable).values({
        profileId: profile.id,
        exceptionId: current.id,
        actorUserId: req.user.id,
        action,
        idempotencyKey: body.data.idempotencyKey,
        reason: body.data.reason ?? null,
        observedFacts: current.observedFacts,
        beforeSnapshot,
        afterSnapshot,
        relationshipRefs,
      }).returning();
      if (!event) throw new Error("Reconciliation audit event was not written");
      const [finalized] = await tx.update(reconciliationExceptionsTable).set({
        status: terminalStatus,
        currentResolutionSummary: body.data.reason ?? action,
        dismissalRevision: action === "dismiss" ? current.sourceRevision : current.dismissalRevision,
        claimToken: null,
        claimedByUserId: null,
        claimedAt: null,
        resolvedAt: new Date(),
      }).where(and(
        eq(reconciliationExceptionsTable.id, current.id),
        eq(reconciliationExceptionsTable.claimToken, claimed.claimToken!),
        eq(reconciliationExceptionsTable.status, "resolving"),
      )).returning();
      if (!finalized) throw new Error("Reconciliation finalization failed");
      return { exception: finalized, replayed: false };
    });
    // Refreshing after the source mutation materializes the next fact revision
    // without placing scanner writes in the resolution transaction.
    void scanProfile(profile.id).catch(err => req.log.warn({ err }, "Post-resolution reconciliation scan failed"));
    res.json({ ...result, exception: publicException(result.exception) });
  } catch (err) {
    const error = err as { status?: number; message?: string };
    req.log.error(err, "Failed to resolve reconciliation item");
    res.status(error.status ?? 500).json({ error: error.message ?? "Could not resolve reconciliation item" });
  }
});

export { scanProfile };
export default router;