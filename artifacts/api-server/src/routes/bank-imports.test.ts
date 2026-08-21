import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  bankImportBatchesTable,
  bankImportRowsTable,
  db,
  financialAccountsTable,
  pool,
  profilesTable,
  sessionsTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';
import { computeCashPosition, computePLBreakdown } from '../lib/finance.js';
import { summarizeTaxYearLedger } from '../lib/tax-year-ledger.js';
import {
  previewRowsForProfile,
  registerBankImportBatch,
} from './bank-imports.js';

if (process.env.BANK_IMPORT_TEST_DATABASE !== '1') {
  throw new Error(
    'Bank-import safety tests require an explicitly marked disposable test database.',
  );
}
const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  throw new Error(
    'Bank-import safety tests require DATABASE_URL to point to a dedicated test database.',
  );
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
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, {
    ...init,
    headers,
  });
  return {
    status: response.status,
    body: await response.json() as ResponseBody,
  };
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('bank CSV staging protects registrations, commits, retries, privacy, and downstream totals', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const userIds = {
    alice: `bank-test-alice-${suffix}`,
    bob: `bank-test-bob-${suffix}`,
  };
  const profileIds: string[] = [];
  const sessionIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  async function createUser(id: string) {
    await db.insert(usersTable).values({
      id,
      email: `${id}@example.test`,
      firstName: 'Bank',
      lastName: 'Test',
    });
  }

  async function createProfile(userId: string, name: string): Promise<string> {
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name,
      type: 'sole_trader',
      taxYear: '2025/26',
      accountingBasis: 'cash',
    }).returning({ id: profilesTable.id });
    profileIds.push(profile.id);
    return profile.id;
  }

  async function createSessionFor(userId: string): Promise<string> {
    const sid = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: 'Bank',
        lastName: 'Test',
        profileImageUrl: null,
      },
      access_token: `test-access-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionIds.push(sid);
    return sid;
  }

  try {
    await Promise.all(Object.values(userIds).map(createUser));
    const [aliceProfileId, bobProfileId] = await Promise.all([
      createProfile(userIds.alice, 'Alice import test'),
      createProfile(userIds.bob, 'Bob import test'),
    ]);
    const [account] = await db.insert(financialAccountsTable).values({
      profileId: aliceProfileId,
      displayName: 'Safety test account',
      currency: 'GBP',
      accountType: 'current',
    }).returning();
    const [bobAccount] = await db.insert(financialAccountsTable).values({
      profileId: bobProfileId,
      displayName: 'Bob account',
      currency: 'GBP',
      accountType: 'current',
    }).returning();
    const [aliceSession, bobSession] = await Promise.all([
      createSessionFor(userIds.alice),
      createSessionFor(userIds.bob),
    ]);

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    testPort = (server.address() as AddressInfo).port;

    const registrationValues = {
      profileId: aliceProfileId,
      financialAccountId: account.id,
      taxYearSnapshot: '2025/26',
      accountingBasisSnapshot: 'cash',
      filename: 'concurrent.csv',
      objectPath: `/objects/uploads/${suffix}-concurrent`,
      fileHash: `hash-${suffix}`,
      encoding: 'utf-8',
      delimiter: ',',
      status: 'mapping_required',
      lastError: null,
      processingLeaseExpiresAt: null,
      processingToken: null,
    } as const;
    const [firstRegistration, secondRegistration] = await Promise.all([
      registerBankImportBatch(registrationValues),
      registerBankImportBatch(registrationValues),
    ]);
    assert.ok(firstRegistration);
    assert.ok(secondRegistration);
    assert.equal(firstRegistration.batch.id, secondRegistration.batch.id);
    assert.equal(
      (await db.select().from(bankImportBatchesTable).where(and(
        eq(bankImportBatchesTable.profileId, aliceProfileId),
        eq(bankImportBatchesTable.fileHash, registrationValues.fileHash),
      ))).length,
      1,
      'concurrent registration must converge on one durable staging batch',
    );
    assert.equal(
      [firstRegistration.reused, secondRegistration.reused].filter(Boolean).length,
      1,
      'the losing registration must be a deterministic reuse, not an error',
    );

    const [batch] = await db.insert(bankImportBatchesTable).values({
      profileId: aliceProfileId,
      financialAccountId: account.id,
      taxYearSnapshot: '2025/26',
      accountingBasisSnapshot: 'cash',
      filename: 'commit.csv',
      objectPath: `/objects/uploads/${suffix}-commit`,
      fileHash: `commit-${suffix}`,
      status: 'preview_ready',
      previewVersion: 1,
      mappingVersion: 1,
      totalRows: 1,
      validRows: 1,
      selectedRows: 1,
      confirmedMapping: {},
    }).returning();
    const [row] = await db.insert(bankImportRowsTable).values({
      batchId: batch.id,
      sourceRowNumber: 2,
      sourceFingerprint: `movement-${suffix}`,
      occurrenceIdentity: 1,
      date: '2025-06-01',
      amount: 125,
      direction: 'money_in',
      description: 'Customer payment',
      reference: 'INV-100',
      balance: 1000,
      validationStatus: 'valid',
      duplicateStatus: 'none',
      selectedForCommit: true,
      validationErrors: [],
      rawRowData: ['2025-06-01', 'Customer payment', '125.00', 'INV-100', '1000.00'],
    }).returning();

    const stale = await request(aliceSession, `/api/profiles/${aliceProfileId}/bank-imports/${batch.id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ previewVersion: 2 }),
    });
    assert.equal(stale.status, 409);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.bankImportRowId, row.id))).length,
      0,
      'a stale preview must not write the ledger',
    );

    const concurrentCommit = () => request(
      aliceSession,
      `/api/profiles/${aliceProfileId}/bank-imports/${batch.id}/commit`,
      { method: 'POST', body: JSON.stringify({ previewVersion: 1 }) },
    );
    const commitResponses = await Promise.all([concurrentCommit(), concurrentCommit()]);
    assert.ok(commitResponses.every((response) => response.status === 200 || response.status === 409));
    const [committedBatch] = await db.select().from(bankImportBatchesTable)
      .where(eq(bankImportBatchesTable.id, batch.id));
    assert.equal(committedBatch.status, 'committed');
    const [imported] = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.bankImportRowId, row.id));
    assert.ok(imported);
    assert.equal(imported.recordType, 'unknown');
    assert.equal(imported.taxTreatment, 'unreviewed');
    assert.equal(imported.accountingClassification, 'unknown');
    assert.equal(
      (imported.originalImportSnapshot as Record<string, unknown> | null)?.balance,
      1000,
    );

    const replay = await concurrentCommit();
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.bankImportRowId, row.id))).length,
      1,
      'a committed replay must not add a second canonical record',
    );

    const pAndL = computePLBreakdown([imported], []);
    assert.equal(pAndL.profit, 0, 'unreviewed imports must not affect P&L');
    const taxLedger = summarizeTaxYearLedger([imported], '2025/26', '2026-01-10');
    assert.equal(taxLedger?.taxableBusinessProfit, 0, 'unreviewed imports must not affect tax readiness');
    assert.equal(computeCashPosition([], 0, []).netAvailable, 0, 'bank balance metadata is not a cash-position input');

    const voided = await request(
      aliceSession,
      `/api/profiles/${aliceProfileId}/transactions/${imported.id}`,
      { method: 'DELETE' },
    );
    assert.equal(voided.status, 204);
    const [voidedTransaction] = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.id, imported.id));
    assert.equal(voidedTransaction.ledgerStatus, 'voided');
    const reimportPreview = await previewRowsForProfile(aliceProfileId, account.id, [{
      sourceRowNumber: 2,
      sourceFingerprint: row.sourceFingerprint,
      date: row.date,
      amount: row.amount,
      direction: row.direction as "money_in" | "money_out" | null,
      description: row.description,
      reference: row.reference,
      balance: row.balance,
      validationStatus: 'valid',
      validationErrors: [],
      rawRowData: row.rawRowData as string[],
    }]);
    assert.equal(reimportPreview[0]?.duplicateStatus, 'already_imported');

    const [expiredBatch] = await db.insert(bankImportBatchesTable).values({
      profileId: aliceProfileId,
      financialAccountId: account.id,
      taxYearSnapshot: '2025/26',
      accountingBasisSnapshot: 'cash',
      filename: 'expired-lease.csv',
      objectPath: `/objects/uploads/${suffix}-expired`,
      fileHash: `expired-${suffix}`,
      status: 'committing',
      previewVersion: 1,
      mappingVersion: 1,
      processingToken: 'stale-worker',
      processingLeaseExpiresAt: new Date(Date.now() - 60_000),
    }).returning();
    await db.insert(bankImportRowsTable).values({
      batchId: expiredBatch.id,
      sourceRowNumber: 2,
      sourceFingerprint: `expired-movement-${suffix}`,
      occurrenceIdentity: 1,
      date: '2025-06-02',
      amount: -20,
      direction: 'money_out',
      description: 'Test expense',
      reference: 'EXP-1',
      validationStatus: 'valid',
      duplicateStatus: 'none',
      selectedForCommit: true,
      validationErrors: [],
      rawRowData: [],
    });
    const reclaimed = await request(
      aliceSession,
      `/api/profiles/${aliceProfileId}/bank-imports/${expiredBatch.id}/commit`,
      { method: 'POST', body: JSON.stringify({ previewVersion: 1 }) },
    );
    assert.equal(reclaimed.status, 200, 'an expired worker lease must be recoverable');
    assert.equal(reclaimed.body.batch.status, 'committed');

    const privatePath = `/objects/uploads/${suffix}-commit`;
    const privateDownload = await request(aliceSession, `/api/storage/objects/uploads/${suffix}-commit`);
    assert.equal(privateDownload.status, 404, 'bank CSVs must not be downloadable by object path');
    const crossUserFile = await request(
      bobSession,
      `/api/profiles/${bobProfileId}/bank-imports/${batch.id}/file`,
    );
    assert.equal(crossUserFile.status, 404, 'a different profile cannot download another profile’s CSV');
    assert.ok(privatePath);
    assert.ok(bobAccount.id);
  } finally {
    if (server) await closeServer(server);
    if (sessionIds.length) {
      await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    }
    if (profileIds.length) {
      await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(userIds)));
    await pool.end();
  }
});