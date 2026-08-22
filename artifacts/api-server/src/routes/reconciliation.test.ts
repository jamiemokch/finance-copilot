import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  bankImportBatchesTable, bankImportRowsTable, db, evidenceItemsTable,
  evidenceTransactionLinksTable,
  financialAccountsTable, pool, profilesTable, reconciliationCoverageChecksTable,
  reconciliationEventsTable, reconciliationExceptionsTable,
  reconciliationSupportExpectationsTable, transactionsTable, usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession } from "../lib/auth.js";
import { computePLBreakdown } from "../lib/finance.js";
import { scanProfile } from "./reconciliation.js";

if (process.env.RECONCILIATION_TEST_DATABASE !== "1") {
  throw new Error("Reconciliation safety tests require an explicitly marked disposable test database.");
}
if (!/(^|[-_])test($|[-_])/i.test(new URL(process.env.DATABASE_URL ?? "").pathname.slice(1))) {
  throw new Error("Reconciliation safety tests require a dedicated test database.");
}

let port = 0;
async function request(sid: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${sid}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function nonFinancialSnapshot(sid: string, profileId: string) {
  const [position, readiness] = await Promise.all([
    request(sid, `/profiles/${profileId}/position`),
    request(sid, `/profiles/${profileId}/self-assessment/readiness`),
  ]);
  assert.equal(position.status, 200);
  assert.equal(readiness.status, 200);
  const transactions = await db.select({
    id: transactionsTable.id,
    amount: transactionsTable.amount,
    recordType: transactionsTable.recordType,
    category: transactionsTable.category,
    taxTreatment: transactionsTable.taxTreatment,
    accountingClassification: transactionsTable.accountingClassification,
    allowableAmount: transactionsTable.allowableAmount,
    allowablePercentage: transactionsTable.allowablePercentage,
    ledgerStatus: transactionsTable.ledgerStatus,
  }).from(transactionsTable).where(eq(transactionsTable.profileId, profileId));
  const links = await db.select({
    evidenceId: evidenceTransactionLinksTable.evidenceId,
    transactionId: evidenceTransactionLinksTable.transactionId,
    linkStatus: evidenceTransactionLinksTable.linkStatus,
  }).from(evidenceTransactionLinksTable).where(eq(evidenceTransactionLinksTable.profileId, profileId));
  return { position: position.body, readiness: readiness.body, transactions, links };
}

test("M10 exceptions are deterministic, profile-bound, revision-safe and financially inert", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const aliceId = `m10-alice-${suffix}`;
  const bobId = `m10-bob-${suffix}`;
  let server: ReturnType<typeof app.listen> | undefined;
  let aliceProfileId = "";
  let bobProfileId = "";
  try {
    await db.insert(usersTable).values([
      { id: aliceId, email: `${aliceId}@example.test`, firstName: "Alice", lastName: "M10" },
      { id: bobId, email: `${bobId}@example.test`, firstName: "Bob", lastName: "M10" },
    ]);
    const profiles = await db.insert(profilesTable).values([
      { userId: aliceId, name: "Alice M10", type: "sole_trader", taxYear: "2025/26", accountingBasis: "cash" },
      { userId: bobId, name: "Bob M10", type: "sole_trader", taxYear: "2025/26", accountingBasis: "cash" },
    ]).returning();
    aliceProfileId = profiles[0]!.id;
    bobProfileId = profiles[1]!.id;
    const [account] = await db.insert(financialAccountsTable).values({
      profileId: aliceProfileId, displayName: "Alice current", accountType: "current", currency: "GBP",
    }).returning();
    const [bobAccount] = await db.insert(financialAccountsTable).values({
      profileId: bobProfileId, displayName: "Bob current", accountType: "current", currency: "GBP",
    }).returning();
    const [batch] = await db.insert(bankImportBatchesTable).values({
      profileId: aliceProfileId, financialAccountId: account.id, taxYearSnapshot: "2025/26",
      accountingBasisSnapshot: "cash", filename: "statement.csv", objectPath: `/m10/${suffix}`,
      fileHash: `m10-${suffix}`, status: "preview_ready", previewVersion: 1,
    }).returning();
    const [endpointRow, duplicateRow] = await db.insert(bankImportRowsTable).values([
      { batchId: batch.id, sourceRowNumber: 2, sourceFingerprint: `endpoint-${suffix}`, date: "2025-06-30", amount: 5, direction: "money_in", description: "Statement endpoint", balance: 80, validationStatus: "valid", rawRowData: [] },
      { batchId: batch.id, sourceRowNumber: 3, sourceFingerprint: `duplicate-${suffix}`, date: "2025-06-12", amount: -25, direction: "money_out", description: "Candidate duplicate", duplicateStatus: "possible_duplicate", validationStatus: "valid", rawRowData: [] },
    ]).returning();
    const [unclassified, supportedCandidate] = await db.insert(transactionsTable).values([
      {
        profileId: aliceProfileId, financialAccountId: account.id, bankImportBatchId: batch.id, bankImportRowId: endpointRow.id,
        bankMovementIdentity: `unknown-${suffix}`, date: "2025-06-01", description: "Unclassified bank movement", amount: -40,
        recordType: "unknown", category: "unknown", taxTreatment: "unreviewed", source: "bank_csv",
        accountingClassification: "unknown", evidenceTier: 2,
      },
      {
        profileId: aliceProfileId, date: "2025-06-02", description: "Receipt required", amount: -12,
        recordType: "expense", category: "supplies", taxTreatment: "deductible", source: "manual",
      },
    ]).returning();
    await db.insert(transactionsTable).values({
      profileId: bobProfileId, financialAccountId: bobAccount.id, date: "2025-06-01", description: "Bob only",
      amount: -4, recordType: "unknown", category: "unknown", taxTreatment: "unreviewed", source: "bank_csv", accountingClassification: "unknown",
    });
    await db.insert(reconciliationSupportExpectationsTable).values({
      profileId: aliceProfileId, transactionId: supportedCandidate.id, expectationState: "required",
      reason: "Receipt explicitly required", source: "test", changedByUserId: aliceId,
    });
    await db.insert(reconciliationCoverageChecksTable).values([
      {
        profileId: aliceProfileId, financialAccountId: account.id, periodStart: "2025-05-01", periodEnd: "2025-05-31",
        completeExpectedCoverage: true, state: "declared",
      },
      {
        profileId: aliceProfileId, financialAccountId: account.id, periodStart: "2025-06-01", periodEnd: "2025-06-30",
        completeExpectedCoverage: true, statementClosingBalance: 100, statementSourceBatchId: batch.id,
        statementEndpointRowId: endpointRow.id, state: "declared",
      },
    ]);

    const firstScan = await scanProfile(aliceProfileId);
    assert.equal(firstScan.filter(item => item.status === "open").length, 5, "all deterministic detectors should materialize");
    assert.equal(firstScan.find(item => item.ruleKey === "unclassified_bank_transaction")?.severity, "high");
    assert.equal(firstScan.find(item => item.sourceId === duplicateRow.id)?.severity, "high");
    assert.equal(firstScan.find(item => item.ruleKey === "missing_required_support")?.severity, "medium");
    assert.ok(firstScan.some(item => item.ruleKey === "no_activity_in_declared_period"));
    assert.ok(firstScan.some(item => item.ruleKey === "statement_balance_discrepancy"));
    assert.ok(!firstScan.some(item => JSON.stringify(item.observedFacts).includes(bobProfileId)), "another profile must not leak into observations");
    const secondScan = await scanProfile(aliceProfileId);
    assert.equal(secondScan.length, firstScan.length, "repeat scans are idempotent");

    const aliceSession = await createSession({ user: { id: aliceId, email: `${aliceId}@example.test`, firstName: "Alice", lastName: "M10", profileImageUrl: null }, access_token: `token-${suffix}`, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const bobSession = await createSession({ user: { id: bobId, email: `${bobId}@example.test`, firstName: "Bob", lastName: "M10", profileImageUrl: null }, access_token: `token-bob-${suffix}`, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    port = (server.address() as AddressInfo).port;

    const unclassifiedException = firstScan.find(item => item.ruleKey === "unclassified_bank_transaction")!;
    const duplicateException = firstScan.find(item => item.ruleKey === "possible_duplicate_candidate")!;
    const coverageException = firstScan.find(item => item.ruleKey === "no_activity_in_declared_period")!;
    const beforeScan = await nonFinancialSnapshot(aliceSession, aliceProfileId);
    await scanProfile(aliceProfileId);
    assert.deepEqual(await nonFinancialSnapshot(aliceSession, aliceProfileId), beforeScan, "a scan must not change financial, tax, cash, SA, transaction, or evidence facts");
    const acknowledged = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${duplicateException.id}/resolve`, {
      method: "POST", body: JSON.stringify({ action: "acknowledge", expectedRevision: duplicateException.sourceRevision, idempotencyKey: randomUUID(), reason: "Review only" }),
    });
    assert.equal(acknowledged.status, 200);
    assert.deepEqual(await nonFinancialSnapshot(aliceSession, aliceProfileId), beforeScan, "acknowledgement must not mutate financial facts");
    const wrongTarget = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${unclassifiedException.id}/resolve`, {
      method: "POST", body: JSON.stringify({
        action: "classify_transaction", expectedRevision: unclassifiedException.sourceRevision, idempotencyKey: randomUUID(),
        transactionId: supportedCandidate.id, fields: { accountingClassification: "expense" },
      }),
    });
    assert.equal(wrongTarget.status, 422, "a resolution must reject a different same-profile transaction");
    const [stillOpenAfterWrongTarget] = await db.select().from(reconciliationExceptionsTable).where(eq(reconciliationExceptionsTable.id, unclassifiedException.id));
    assert.equal(stillOpenAfterWrongTarget?.status, "open", "wrong-target rejection must leave the original exception open");
    const [otherCoverage] = await db.select().from(reconciliationCoverageChecksTable).where(and(
      eq(reconciliationCoverageChecksTable.profileId, aliceProfileId),
      eq(reconciliationCoverageChecksTable.id, firstScan.find(item => item.ruleKey === "statement_balance_discrepancy")!.sourceId),
    ));
    const wrongCoverage = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${coverageException.id}/resolve`, {
      method: "POST", body: JSON.stringify({
        action: "confirm_coverage", expectedRevision: coverageException.sourceRevision, idempotencyKey: randomUUID(),
        coverageCheckId: otherCoverage!.id,
      }),
    });
    assert.equal(wrongCoverage.status, 422, "a resolution must reject a different same-profile coverage check");
    const confirmedCoverage = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${coverageException.id}/resolve`, {
      method: "POST", body: JSON.stringify({
        action: "confirm_coverage", expectedRevision: coverageException.sourceRevision, idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(confirmedCoverage.status, 200);
    assert.deepEqual(await nonFinancialSnapshot(aliceSession, aliceProfileId), beforeScan, "coverage confirmation must not mutate financial facts");
    const afterCoverageConfirmation = await scanProfile(aliceProfileId);
    assert.ok(!afterCoverageConfirmation.some(item => item.id === coverageException.id && item.status === "open"), "a confirmed unchanged coverage observation must remain closed until its facts disappear and return");
    const financialRowsBefore = await db.select({
      amount: transactionsTable.amount,
      recordType: transactionsTable.recordType,
      ledgerStatus: transactionsTable.ledgerStatus,
      category: transactionsTable.category,
      taxTreatment: transactionsTable.taxTreatment,
      allowableAmount: transactionsTable.allowableAmount,
      allowablePercentage: transactionsTable.allowablePercentage,
    }).from(transactionsTable).where(eq(transactionsTable.profileId, aliceProfileId));
    const pAndLBefore = computePLBreakdown(financialRowsBefore, []);
    const ledgerBefore = financialRowsBefore.map(row => [row.amount, row.ledgerStatus]);
    const dismissKey = randomUUID();
    const dismissed = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${unclassifiedException.id}/resolve`, {
      method: "POST", body: JSON.stringify({ action: "dismiss", expectedRevision: unclassifiedException.sourceRevision, idempotencyKey: dismissKey, reason: "Known personal transfer" }),
    });
    assert.equal(dismissed.status, 200);
    const retry = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${unclassifiedException.id}/resolve`, {
      method: "POST", body: JSON.stringify({ action: "dismiss", expectedRevision: unclassifiedException.sourceRevision, idempotencyKey: dismissKey, reason: "Known personal transfer" }),
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true, "lost-response retry must be idempotent");
    const financialRowsAfterDismissal = await db.select({
      amount: transactionsTable.amount,
      recordType: transactionsTable.recordType,
      ledgerStatus: transactionsTable.ledgerStatus,
      category: transactionsTable.category,
      taxTreatment: transactionsTable.taxTreatment,
      allowableAmount: transactionsTable.allowableAmount,
      allowablePercentage: transactionsTable.allowablePercentage,
    }).from(transactionsTable).where(eq(transactionsTable.profileId, aliceProfileId));
    assert.deepEqual(computePLBreakdown(financialRowsAfterDismissal, []), pAndLBefore, "dismissal cannot change P&L");
    assert.deepEqual(financialRowsAfterDismissal.map(row => [row.amount, row.ledgerStatus]), ledgerBefore, "dismissal cannot change canonical cash movements");
    assert.deepEqual(await nonFinancialSnapshot(aliceSession, aliceProfileId), beforeScan, "dismissal must not change financial, tax, cash, SA, transaction, or evidence facts");
    const events = await db.select().from(reconciliationEventsTable).where(eq(reconciliationEventsTable.exceptionId, unclassifiedException.id));
    assert.equal(events.length, 1, "finalize must write one immutable event");
    const forbidden = await request(bobSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${unclassifiedException.id}`);
    assert.equal(forbidden.status, 404, "cross-profile exception detail must be hidden");

    await db.update(transactionsTable).set({ description: "Unclassified bank movement amended" })
      .where(eq(transactionsTable.id, unclassified.id));
    const changedScan = await scanProfile(aliceProfileId);
    const reopened = changedScan.find(item => item.ruleKey === "unclassified_bank_transaction" && item.status === "open");
    assert.ok(reopened && reopened.id !== unclassifiedException.id, "changed observed facts must create a new review revision");

    const classified = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${reopened!.id}/resolve`, {
      method: "POST", body: JSON.stringify({
        action: "classify_transaction", expectedRevision: reopened!.sourceRevision, idempotencyKey: randomUUID(),
        fields: { accountingClassification: "expense", category: "travel", taxTreatment: "deductible" },
      }),
    });
    assert.equal(classified.status, 200);
    const [verified] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, unclassified.id));
    assert.equal(verified?.accountingClassification, "expense", "source must be changed before resolution is finalized");
    const afterClassify = await scanProfile(aliceProfileId);
    assert.ok(!afterClassify.some(item => item.id === reopened!.id && item.status === "open"), "classification removes the exact fact condition");

    const missingSupport = firstScan.find(item => item.ruleKey === "missing_required_support")!;
    const [evidence] = await db.insert(evidenceItemsTable).values({
      profileId: aliceProfileId, filename: "receipt.pdf", objectPath: `/m10/receipt-${suffix}`, workflowVersion: 2,
      documentLifecycle: "active", reviewState: "reviewed", contentHash: `receipt-${suffix}`,
    }).returning();
    const attached = await request(aliceSession, `/profiles/${aliceProfileId}/reconciliation/exceptions/${missingSupport.id}/resolve`, {
      method: "POST", body: JSON.stringify({ action: "attach_evidence", expectedRevision: missingSupport.sourceRevision, idempotencyKey: randomUUID(), evidenceId: evidence.id }),
    });
    assert.equal(attached.status, 200);
    let afterClear = await scanProfile(aliceProfileId);
    assert.ok(!afterClear.some(item => item.id === missingSupport.id && item.status === "open"), "attaching active evidence must retire missing-support review");

    await db.insert(transactionsTable).values({
      profileId: aliceProfileId, financialAccountId: account.id, date: "2025-05-12", description: "Recorded in declared coverage",
      amount: -8, recordType: "expense", category: "supplies", taxTreatment: "deductible", source: "manual",
    });
    afterClear = await scanProfile(aliceProfileId);
    assert.ok(!afterClear.some(item => item.id === coverageException.id && item.status === "open"), "new in-period activity must retire a no-activity exception");

    await db.update(bankImportRowsTable).set({ duplicateStatus: "none" }).where(eq(bankImportRowsTable.id, duplicateRow.id));
    afterClear = await scanProfile(aliceProfileId);
    assert.ok(!afterClear.some(item => item.id === duplicateException.id && item.status === "open"), "cleared duplicate staging facts must retire their exception");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (aliceProfileId) await db.delete(profilesTable).where(eq(profilesTable.id, aliceProfileId));
    if (bobProfileId) await db.delete(profilesTable).where(eq(profilesTable.id, bobProfileId));
    await db.delete(usersTable).where(eq(usersTable.id, aliceId)).catch(() => undefined);
    await db.delete(usersTable).where(eq(usersTable.id, bobId)).catch(() => undefined);
    await pool.end();
  }
});