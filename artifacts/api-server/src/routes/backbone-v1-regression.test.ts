import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  bankImportBatchesTable,
  bankImportRowsTable,
  db,
  evidenceTransactionLinksTable,
  financialAccountsTable,
  pool,
  profilesTable,
  sessionsTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';
import { ObjectStorageService } from '../lib/objectStorage.js';

// This is the single product-level regression for Backbone V1's supported
// simple path (issue #117): simple input -> AI-proposed record -> user
// confirmation -> Financial Memory -> P&L/tax/readiness -> a later update.
// It walks the same routes a real user session would call, in one profile,
// so a break anywhere in that chain fails exactly this test.
if (process.env.BACKBONE_V1_TEST_DATABASE !== '1') {
  throw new Error('The Backbone V1 regression requires an explicitly marked disposable test database.');
}
const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  throw new Error('The Backbone V1 regression requires DATABASE_URL to point to a dedicated test database.');
}

type ResponseBody = Record<string, any>;
let testPort = 0;

async function request(
  sid: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ResponseBody }> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${sid}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as ResponseBody : {} };
}

async function upload(
  sid: string,
  profileId: string,
  content: string,
): Promise<{ status: number; body: ResponseBody }> {
  return request(sid, '/api/storage/uploads/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-content-type': 'text/plain',
      'x-profile-id': profileId,
    },
    body: content,
  });
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function loadDownstream(sid: string, profileId: string) {
  const [position, incomeTaxEstimate, readiness] = await Promise.all([
    request(sid, `/api/profiles/${profileId}/position`),
    request(sid, `/api/profiles/${profileId}/income-tax-estimate`),
    request(sid, `/api/profiles/${profileId}/self-assessment/readiness`),
  ]);
  assert.equal(position.status, 200, 'position must be computable at every step of the supported path');
  assert.equal(incomeTaxEstimate.status, 200, 'income-tax-estimate must be computable at every step of the supported path');
  assert.equal(readiness.status, 200, 'self-assessment readiness must be computable at every step of the supported path');
  return {
    profit: position.body.plBreakdown.profit,
    revenues: position.body.plBreakdown.revenues,
    taxableBusinessProfit: incomeTaxEstimate.body.profitLoss.taxableBusinessProfit,
    recordCount: incomeTaxEstimate.body.profitLoss.recordCount,
    readinessTurnover: readiness.body.readiness.financialCoverage.turnover,
    readinessProfit: readiness.body.readiness.financialCoverage.taxableBusinessProfit,
    readinessRecordCount: readiness.body.readiness.financialCoverage.recordCount,
  };
}

test('Backbone V1 supported simple path: proposal -> confirmation -> Financial Memory -> P&L/tax/readiness -> refreshed update', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const userId = `backbone-v1-${suffix}`;
  const profileIds: string[] = [];
  const sessionIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  const originalGetFile = ObjectStorageService.prototype.getObjectEntityFile;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    delete: async () => undefined,
    download: async () => [Buffer.from('backbone v1 evidence bytes')],
  }) as never;

  try {
    await db.insert(usersTable).values({
      id: userId, email: `${userId}@example.test`, firstName: 'Backbone', lastName: 'V1',
    });
    const [profile] = await db.insert(profilesTable).values({
      userId, name: 'Backbone V1 profile', type: 'sole_trader', taxYear: '2025/26', accountingBasis: 'cash',
    }).returning({ id: profilesTable.id });
    profileIds.push(profile.id);
    const sid = await createSession({
      user: { id: userId, email: `${userId}@example.test`, firstName: 'Backbone', lastName: 'V1', profileImageUrl: null },
      access_token: `test-access-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionIds.push(sid);

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    testPort = (server.address() as AddressInfo).port;

    // Baseline: a brand-new profile has nothing confirmed yet.
    const baseline = await loadDownstream(sid, profile.id);
    assert.deepEqual(baseline, {
      profit: 0, revenues: 0, taxableBusinessProfit: 0, recordCount: 0,
      readinessTurnover: 0, readinessProfit: 0, readinessRecordCount: 0,
    });
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))).length,
      0,
    );

    // Step 1 — a simple financial input (a document) is ingested and interpreted
    // into a proposal. With no AI configured, extraction deterministically stops
    // at needs_review rather than guessing a financial record.
    const uploaded = await upload(sid, profile.id, 'sales invoice bytes');
    assert.equal(uploaded.status, 200);
    const registered = await request(sid, `/api/profiles/${profile.id}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'invoice.txt', objectPath: uploaded.body.objectPath, mimeType: 'text/plain',
        category: 'sales', evidenceType: 'document',
      }),
    });
    assert.equal(registered.status, 201);
    const evidenceId = registered.body.id as string;
    const processed = await request(sid, `/api/profiles/${profile.id}/evidence/${evidenceId}/process`, { method: 'POST' });
    assert.equal(processed.status, 200);
    assert.equal(processed.body.status, 'needs_review', 'a simple document proposal stops for user review, it never auto-posts');

    // Step 2 — nothing enters confirmed Financial Memory before explicit confirmation.
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))).length,
      0,
      'an unconfirmed proposal must not write Financial Memory',
    );
    assert.deepEqual(await loadDownstream(sid, profile.id), baseline);

    const reviewed = await request(sid, `/api/profiles/${profile.id}/evidence/${evidenceId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({
        category: 'sales',
        extractedData: { description: 'June sales invoice', amount: 500, date: '2025-06-01' },
      }),
    });
    assert.equal(reviewed.status, 200);
    assert.deepEqual(
      await loadDownstream(sid, profile.id),
      baseline,
      'saving a user review is still supporting data, not a Financial Memory write',
    );

    // Step 3 — confirmation creates exactly the expected confirmed record, and
    // is idempotent under concurrent and repeated confirmation requests.
    const confirmationKey = randomUUID();
    const confirmationPayload = {
      idempotencyKey: confirmationKey,
      date: '2025-06-01',
      description: 'June sales invoice',
      amount: 500,
      category: 'sales',
      taxTreatment: 'income',
    };
    const concurrentConfirmations = await Promise.all([
      request(sid, `/api/profiles/${profile.id}/evidence/${evidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationPayload),
      }),
      request(sid, `/api/profiles/${profile.id}/evidence/${evidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationPayload),
      }),
    ]);
    assert.ok(concurrentConfirmations.every((response) => response.status === 200 || response.status === 201));
    const confirmedRows = await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id));
    assert.equal(confirmedRows.length, 1, 'confirmation creates exactly one confirmed Financial Memory record');
    assert.equal(confirmedRows[0].id, confirmationKey);
    assert.equal(confirmedRows[0].recordType, 'income');
    assert.equal(Number(confirmedRows[0].amount), 500);
    assert.equal(
      (await db.select().from(evidenceTransactionLinksTable).where(and(
        eq(evidenceTransactionLinksTable.evidenceId, evidenceId),
        eq(evidenceTransactionLinksTable.transactionId, confirmationKey),
      ))).length,
      1,
      'confirmation creates one idempotent evidence-to-record bridge link',
    );

    // Idempotent across reload and repeat: reload the record, then repeat the
    // same confirmation request as if the client retried after a reload.
    const reloadedTransactions = await request(sid, `/api/profiles/${profile.id}/transactions`);
    assert.equal(reloadedTransactions.status, 200);
    assert.equal(reloadedTransactions.body.length, 1);
    assert.equal(reloadedTransactions.body[0].id, confirmationKey);
    const repeatConfirmation = await request(sid, `/api/profiles/${profile.id}/evidence/${evidenceId}/confirm-transaction`, {
      method: 'POST', body: JSON.stringify(confirmationPayload),
    });
    assert.equal(repeatConfirmation.status, 200);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))).length,
      1,
      'repeating confirmation after reload must not duplicate the confirmed record',
    );

    // Step 4 — confirmed Financial Memory drives P&L / estimated tax / readiness.
    const afterConfirmation = await loadDownstream(sid, profile.id);
    assert.equal(afterConfirmation.profit, 500);
    assert.equal(afterConfirmation.revenues, 500);
    assert.equal(afterConfirmation.taxableBusinessProfit, 500);
    assert.equal(afterConfirmation.recordCount, 1);
    assert.equal(afterConfirmation.readinessTurnover, 500);
    assert.equal(afterConfirmation.readinessProfit, 500);
    assert.equal(afterConfirmation.readinessRecordCount, 1);

    // Step 5 — an unresolved bank movement stays outside totals but stays
    // visible in Financial Memory until it is explicitly classified.
    const [account] = await db.insert(financialAccountsTable).values({
      profileId: profile.id, displayName: 'Backbone V1 account', currency: 'GBP', accountType: 'current',
    }).returning();
    const [batch] = await db.insert(bankImportBatchesTable).values({
      profileId: profile.id,
      financialAccountId: account.id,
      taxYearSnapshot: '2025/26',
      accountingBasisSnapshot: 'cash',
      filename: 'statement.csv',
      objectPath: `/objects/uploads/${suffix}-statement`,
      fileHash: `statement-${suffix}`,
      status: 'preview_ready',
      previewVersion: 1,
      mappingVersion: 1,
      totalRows: 1,
      validRows: 1,
      selectedRows: 1,
      confirmedMapping: {},
    }).returning();
    const [unresolvedRow] = await db.insert(bankImportRowsTable).values({
      batchId: batch.id,
      sourceRowNumber: 2,
      sourceFingerprint: `unresolved-${suffix}`,
      occurrenceIdentity: 1,
      date: '2025-06-05',
      amount: -80,
      direction: 'money_out',
      description: 'Unreviewed card payment',
      reference: 'CARD-1',
      validationStatus: 'valid',
      duplicateStatus: 'none',
      selectedForCommit: true,
      validationErrors: [],
      rawRowData: [],
    }).returning();
    const committed = await request(sid, `/api/profiles/${profile.id}/bank-imports/${batch.id}/commit`, {
      method: 'POST', body: JSON.stringify({ previewVersion: 1 }),
    });
    assert.equal(committed.status, 200);
    const [unresolvedTransaction] = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.bankImportRowId, unresolvedRow.id));
    assert.equal(unresolvedTransaction.recordType, 'unknown');

    const visibleTransactions = await request(sid, `/api/profiles/${profile.id}/transactions`);
    assert.equal(visibleTransactions.status, 200);
    assert.ok(
      visibleTransactions.body.some((transaction: { id: string }) => transaction.id === unresolvedTransaction.id),
      'an unresolved row must remain visible in Financial Memory',
    );
    assert.deepEqual(
      await loadDownstream(sid, profile.id),
      afterConfirmation,
      'an unresolved unknown row must not change P&L / tax / readiness totals',
    );

    // Step 6 — a subsequent supported update, after confirmation, refreshes the
    // same Financial Memory record and downstream outputs without duplicating it.
    const updatedConfirmation = await request(sid, `/api/profiles/${profile.id}/transactions/${confirmationKey}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 750 }),
    });
    assert.equal(updatedConfirmation.status, 200);
    assert.equal(updatedConfirmation.body.id, confirmationKey, 'the update refreshes the same confirmed record');
    assert.equal(Number(updatedConfirmation.body.amount), 750);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))).length,
      2,
      'the update must not create a duplicate record (the confirmed income plus the still-unresolved bank row)',
    );
    const afterUpdate = await loadDownstream(sid, profile.id);
    assert.equal(afterUpdate.profit, 750);
    assert.equal(afterUpdate.revenues, 750);
    assert.equal(afterUpdate.taxableBusinessProfit, 750);
    assert.equal(afterUpdate.recordCount, 1);
    assert.equal(afterUpdate.readinessTurnover, 750);
    assert.equal(afterUpdate.readinessProfit, 750);
    assert.equal(afterUpdate.readinessRecordCount, 1);

    // Repeating the same update stays idempotent: no duplicate, no drift.
    const repeatedUpdate = await request(sid, `/api/profiles/${profile.id}/transactions/${confirmationKey}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 750 }),
    });
    assert.equal(repeatedUpdate.status, 200);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profile.id))).length,
      2,
      'repeating the update must not duplicate records',
    );
    assert.deepEqual(await loadDownstream(sid, profile.id), afterUpdate);
  } finally {
    ObjectStorageService.prototype.getObjectEntityFile = originalGetFile;
    if (server) await closeServer(server);
    if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    if (profileIds.length) await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
});
