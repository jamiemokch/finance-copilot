import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import {
  db,
  evidenceItemsTable,
  evidenceTransactionLinksTable,
  pool,
  privateUploadBindingsTable,
  privateUploadObjectsTable,
  profilesTable,
  sessionsTable,
  spreadsheetRowOutcomesTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';
import { ObjectStorageService } from '../lib/objectStorage.js';

if (process.env.EVIDENCE_TEST_DATABASE !== '1') {
  throw new Error('M9 evidence safety tests require an explicitly marked disposable test database.');
}
const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  throw new Error('M9 evidence safety tests require DATABASE_URL to point to a dedicated test database.');
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

function immutableFinancialSnapshot(body: ResponseBody) {
  return {
    profit: body.plBreakdown.profit,
    tax: body.taxCalculation,
    cash: body.cashPosition,
    readiness: body.saReadiness,
  };
}

test('M9 evidence remains profile-bound, review-only, idempotent, and financially inert until confirmation', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const users = {
    alice: `m9-alice-${suffix}`,
    bob: `m9-bob-${suffix}`,
  };
  const profileIds: string[] = [];
  const sessionIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  const originalSaveContent = ObjectStorageService.prototype.saveContent;
  const originalGetFile = ObjectStorageService.prototype.getObjectEntityFile;
  const originalDownload = ObjectStorageService.prototype.downloadObject;
  const originalUploadUrl = ObjectStorageService.prototype.getObjectEntityUploadURL;
  let spreadsheetBuffer: Buffer | undefined;
  ObjectStorageService.prototype.saveContent = async () => `/objects/uploads/m9-${randomUUID()}`;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    delete: async () => undefined,
    download: async () => [spreadsheetBuffer ?? Buffer.from('test evidence bytes')],
  }) as never;
  ObjectStorageService.prototype.downloadObject = async () =>
    new Response('test evidence bytes', { headers: { 'content-type': 'text/plain' } });
  ObjectStorageService.prototype.getObjectEntityUploadURL = async () =>
    `https://storage.test/objects/uploads/m9-presigned-${randomUUID()}`;

  async function createProfile(userId: string, name: string) {
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
  async function createSessionFor(userId: string) {
    const sid = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: 'M9',
        lastName: 'Safety',
        profileImageUrl: null,
      },
      access_token: `test-access-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionIds.push(sid);
    return sid;
  }

  try {
    await Promise.all(Object.values(users).map((id) => db.insert(usersTable).values({
      id,
      email: `${id}@example.test`,
      firstName: 'M9',
      lastName: 'Safety',
    })));
    const [alicePrimary, aliceSecondary, bobProfile] = await Promise.all([
      createProfile(users.alice, 'Alice primary'),
      createProfile(users.alice, 'Alice secondary'),
      createProfile(users.bob, 'Bob profile'),
    ]);
    const [aliceSession, bobSession] = await Promise.all([
      createSessionFor(users.alice),
      createSessionFor(users.bob),
    ]);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    testPort = (server.address() as AddressInfo).port;
    const retiredPresigned = await request(aliceSession, '/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'x-profile-id': alicePrimary },
      body: JSON.stringify({ name: 'presigned.txt', size: 12, contentType: 'text/plain' }),
    });
    assert.equal(retiredPresigned.status, 410, 'the retired direct-to-storage endpoint cannot mint a reset-escaping write URL');

    const duplicateContent = 'same receipt bytes';
    const [firstUpload, retryUpload] = await Promise.all([
      upload(aliceSession, alicePrimary, duplicateContent),
      upload(aliceSession, alicePrimary, duplicateContent),
    ]);
    assert.equal(firstUpload.status, 200);
    assert.equal(retryUpload.status, 200);
    assert.equal(firstUpload.body.objectPath, retryUpload.body.objectPath, 'duplicate uploads reuse physical bytes');
    const objectPath = firstUpload.body.objectPath as string;
    const [physicalObject] = await db.select().from(privateUploadObjectsTable)
      .where(eq(privateUploadObjectsTable.objectPath, objectPath));
    assert.ok(physicalObject);
    assert.equal(
      (await db.select().from(privateUploadBindingsTable).where(and(
        eq(privateUploadBindingsTable.profileId, alicePrimary),
        eq(privateUploadBindingsTable.objectId, physicalObject.id),
      ))).length,
      1,
      'retries converge on one profile binding',
    );

    const primaryRegistration = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'receipt.txt',
        objectPath,
        mimeType: 'text/plain',
        category: 'receipt',
        evidenceType: 'document',
      }),
    });
    assert.equal(primaryRegistration.status, 201);
    const evidenceId = primaryRegistration.body.id as string;
    const duplicateRegistration = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'duplicate-receipt.txt',
        objectPath,
        mimeType: 'text/plain',
        category: 'receipt',
        evidenceType: 'document',
      }),
    });
    assert.equal(duplicateRegistration.status, 200);
    assert.equal(duplicateRegistration.body.id, evidenceId, 'same-profile document registration is idempotent');
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, alicePrimary))).length,
      0,
      'document registration never posts to Financial Memory',
    );

    const [positionBefore, taxBefore, readinessBefore] = await Promise.all([
      request(aliceSession, `/api/profiles/${alicePrimary}/position`),
      request(aliceSession, `/api/profiles/${alicePrimary}/income-tax-estimate`),
      request(aliceSession, `/api/profiles/${alicePrimary}/self-assessment/readiness`),
    ]);
    assert.equal(positionBefore.status, 200);
    const financialBefore = immutableFinancialSnapshot(positionBefore.body);

    const processed = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/process`, {
      method: 'POST',
    });
    assert.equal(processed.status, 200);
    assert.equal(processed.body.status, 'needs_review');
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, alicePrimary))).length,
      0,
      'workflow-2 extraction remains review-only when extraction is unavailable',
    );
    const reviewed = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({
        category: 'office',
        extractedData: { description: 'Paper and ink', amount: 18.5, date: '2025-06-01' },
      }),
    });
    assert.equal(reviewed.status, 200);

    const pendingUpload = await upload(aliceSession, alicePrimary, 'separate pending evidence bytes');
    assert.equal(pendingUpload.status, 200);
    const pendingRegistration = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'pending-receipt.txt',
        objectPath: pendingUpload.body.objectPath,
        mimeType: 'text/plain',
        category: 'receipt',
        evidenceType: 'document',
      }),
    });
    assert.equal(pendingRegistration.status, 201);
    const pendingEvidenceId = pendingRegistration.body.id as string;
    const pendingProcessed = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${pendingEvidenceId}/process`,
      { method: 'POST' },
    );
    assert.equal(pendingProcessed.status, 200);
    assert.equal(pendingProcessed.body.status, 'needs_review');

    const [positionAfterReview, taxAfterReview, readinessAfterReview] = await Promise.all([
      request(aliceSession, `/api/profiles/${alicePrimary}/position`),
      request(aliceSession, `/api/profiles/${alicePrimary}/income-tax-estimate`),
      request(aliceSession, `/api/profiles/${alicePrimary}/self-assessment/readiness`),
    ]);
    assert.deepEqual(immutableFinancialSnapshot(positionAfterReview.body), financialBefore);
    assert.deepEqual(taxAfterReview.body, taxBefore.body);
    assert.deepEqual(readinessAfterReview.body, readinessBefore.body);

    const download = await fetch(
      `http://127.0.0.1:${testPort}/api/profiles/${alicePrimary}/evidence/${evidenceId}/download`,
      { headers: { authorization: `Bearer ${aliceSession}` } },
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'test evidence bytes');
    const pathOnlyDownload = await request(aliceSession, objectPath.replace('/objects/', '/api/storage/objects/'));
    assert.equal(pathOnlyDownload.status, 404, 'private evidence cannot be downloaded by an object path');
    await db.delete(privateUploadBindingsTable).where(and(
      eq(privateUploadBindingsTable.objectId, physicalObject.id),
      eq(privateUploadBindingsTable.profileId, alicePrimary),
    ));
    const legacyPathOnlyDownload = await request(aliceSession, objectPath.replace('/objects/', '/api/storage/objects/'));
    assert.equal(
      legacyPathOnlyDownload.status,
      404,
      'legacy evidence without a binding still cannot bypass profile-scoped download authorization',
    );
    await db.insert(privateUploadBindingsTable).values({
      objectId: physicalObject.id, profileId: alicePrimary, userId: users.alice,
    });
    const crossProfileDownload = await request(aliceSession, `/api/profiles/${aliceSecondary}/evidence/${evidenceId}/download`);
    assert.equal(crossProfileDownload.status, 404, 'a second profile cannot read the first profile’s evidence');
    const crossUserRegistration = await request(bobSession, `/api/profiles/${bobProfile}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'guessed.txt',
        objectPath,
        mimeType: 'text/plain',
        evidenceType: 'document',
      }),
    });
    assert.equal(crossUserRegistration.status, 404, 'an opaque path is not an ownership claim');

    const secondaryUpload = await upload(aliceSession, aliceSecondary, duplicateContent);
    assert.equal(secondaryUpload.status, 200);
    assert.equal(secondaryUpload.body.objectPath, objectPath, 'the same user can reuse bytes through a separate profile binding');
    const secondaryRegistration = await request(aliceSession, `/api/profiles/${aliceSecondary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'secondary-receipt.txt',
        objectPath,
        mimeType: 'text/plain',
        evidenceType: 'document',
      }),
    });
    assert.equal(secondaryRegistration.status, 201);
    assert.notEqual(secondaryRegistration.body.id, evidenceId, 'a profile receives its own document identity');

    const confirmationKey = randomUUID();
    const confirmationPayload = {
      idempotencyKey: confirmationKey,
      date: '2025-06-01',
      description: 'Paper and ink',
      amount: 18.5,
      category: 'office',
      taxTreatment: 'deductible',
      allowablePercentage: 100,
    };
    const confirmations = await Promise.all([
      request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationPayload),
      }),
      request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationPayload),
      }),
    ]);
    assert.ok(confirmations.every((response) => response.status === 200 || response.status === 201));
    const [confirmed] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.id, confirmationKey), eq(transactionsTable.profileId, alicePrimary)));
    assert.ok(confirmed);
    assert.equal(confirmed.evidenceId, null, 'workflow-2 uses the bridge relationship instead of the legacy column');
    assert.equal(
      (await db.select().from(evidenceTransactionLinksTable).where(and(
        eq(evidenceTransactionLinksTable.evidenceId, evidenceId),
        eq(evidenceTransactionLinksTable.transactionId, confirmed.id),
      ))).length,
      1,
      'confirmation creates one idempotent bridge link',
    );
    const [reloadedEvidence, reloadedUnmatchedEvidence, reloadedFinancialMemory] = await Promise.all([
      request(aliceSession, `/api/profiles/${alicePrimary}/evidence`),
      request(aliceSession, `/api/profiles/${alicePrimary}/evidence/unmatched`),
      request(aliceSession, `/api/profiles/${alicePrimary}/transactions`),
    ]);
    assert.equal(reloadedEvidence.status, 200);
    const reloadedDocument = reloadedEvidence.body.find((item: { id: string }) => item.id === evidenceId);
    assert.equal(reloadedDocument?.status, 'processed', 'a confirmed document reloads in its terminal state');
    assert.equal(reloadedDocument?.reviewState, 'confirmed', 'a confirmed document cannot be mistaken for a saved review');
    assert.equal(reloadedUnmatchedEvidence.status, 200);
    assert.deepEqual(
      reloadedUnmatchedEvidence.body.map((item: { id: string }) => item.id),
      [pendingEvidenceId],
      'only the genuinely pending document remains in the reloaded review queue',
    );
    assert.equal(
      reloadedFinancialMemory.body.length,
      1,
      'reload still shows exactly one Financial Memory record',
    );
    assert.equal(
      reloadedFinancialMemory.body[0]?.id,
      confirmationKey,
      'the single reloaded Financial Memory record is the confirmed document transaction',
    );

    const [manual] = await db.insert(transactionsTable).values({
      profileId: alicePrimary,
      date: '2025-06-02',
      description: 'Existing manual record',
      amount: -9,
      recordType: 'expense',
      category: 'office',
      taxTreatment: 'deductible',
      source: 'manual',
      evidenceTier: 4,
    }).returning();
    const linkBefore = await request(aliceSession, `/api/profiles/${alicePrimary}/position`);
    const attached = await request(aliceSession, `/api/profiles/${alicePrimary}/transactions/${manual.id}/attach-evidence`, {
      method: 'PATCH', body: JSON.stringify({ evidenceId }),
    });
    assert.equal(attached.status, 200);
    const replayedAttach = await request(aliceSession, `/api/profiles/${alicePrimary}/transactions/${manual.id}/attach-evidence`, {
      method: 'PATCH', body: JSON.stringify({ evidenceId }),
    });
    assert.equal(replayedAttach.status, 200);
    const linkedDocuments = await request(aliceSession, `/api/profiles/${alicePrimary}/transactions/${manual.id}/evidence-links`);
    assert.equal(linkedDocuments.status, 200);
    assert.ok(
      linkedDocuments.body.some((link: { evidenceId: string }) => link.evidenceId === evidenceId),
      'linked documents can be read only through their profile-scoped financial record',
    );
    const afterAttach = await request(aliceSession, `/api/profiles/${alicePrimary}/position`);
    assert.deepEqual(immutableFinancialSnapshot(afterAttach.body), immutableFinancialSnapshot(linkBefore.body));
    assert.equal(
      (await db.select().from(evidenceTransactionLinksTable).where(and(
        eq(evidenceTransactionLinksTable.evidenceId, evidenceId),
        eq(evidenceTransactionLinksTable.transactionId, manual.id),
      ))).length,
      1,
      'one document can link to multiple records without duplicate links',
    );
    const detached = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/links/${manual.id}`, {
      method: 'DELETE',
    });
    assert.equal(detached.status, 204);
    const afterDetach = await request(aliceSession, `/api/profiles/${alicePrimary}/position`);
    assert.deepEqual(immutableFinancialSnapshot(afterDetach.body), immutableFinancialSnapshot(afterAttach.body));

    const replacementUpload = await upload(aliceSession, alicePrimary, 'replacement receipt bytes');
    const replacement = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${evidenceId}/replace`, {
      method: 'POST',
      body: JSON.stringify({
        objectPath: replacementUpload.body.objectPath,
        filename: 'replacement.txt',
        mimeType: 'text/plain',
      }),
    });
    assert.equal(replacement.status, 201);
    const [replacedOriginal] = await db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.id, evidenceId));
    assert.equal(replacedOriginal.documentLifecycle, 'replaced');
    assert.equal(replacement.body.replacementOfEvidenceId, evidenceId);
    const afterReplacement = await request(aliceSession, `/api/profiles/${alicePrimary}/position`);
    assert.deepEqual(immutableFinancialSnapshot(afterReplacement.body), immutableFinancialSnapshot(afterDetach.body));

    const tombstoned = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${replacement.body.id}/tombstone`, {
      method: 'POST',
    });
    assert.equal(tombstoned.status, 200);
    const afterTombstone = await request(aliceSession, `/api/profiles/${alicePrimary}/position`);
    assert.deepEqual(immutableFinancialSnapshot(afterTombstone.body), immutableFinancialSnapshot(afterReplacement.body));

    const [legacyEvidence] = await db.insert(evidenceItemsTable).values({
      profileId: alicePrimary,
      filename: 'legacy.pdf',
      objectPath: '/objects/uploads/legacy-proof',
      mimeType: 'application/pdf',
      evidenceType: 'document',
      workflowVersion: 1,
      status: 'processed',
    }).returning();
    const [legacyTransaction] = await db.insert(transactionsTable).values({
      profileId: alicePrimary,
      date: '2025-05-31',
      description: 'Legacy extracted expense',
      amount: -22,
      recordType: 'expense',
      category: 'office',
      taxTreatment: 'deductible',
      source: 'extracted',
      evidenceId: legacyEvidence.id,
      evidenceTier: 1,
      allowableAmount: -22,
    }).returning();
    const legacyBefore = {
      amount: legacyTransaction.amount,
      taxTreatment: legacyTransaction.taxTreatment,
      evidenceId: legacyTransaction.evidenceId,
    };
    const [legacyAfter] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, legacyTransaction.id));
    assert.deepEqual({
      amount: legacyAfter.amount,
      taxTreatment: legacyAfter.taxTreatment,
      evidenceId: legacyAfter.evidenceId,
    }, legacyBefore, 'M9 writes do not recreate or reclassify legacy workflow-1 transactions');

    const sharedDiscard = await request(aliceSession, `/api/profiles/${aliceSecondary}/evidence/${secondaryRegistration.body.id}`, {
      method: 'DELETE',
    });
    assert.equal(sharedDiscard.status, 200);
    const [stillReusable] = await db.select().from(privateUploadObjectsTable)
      .where(eq(privateUploadObjectsTable.objectPath, objectPath));
    assert.ok(stillReusable, 'discarding one logical document keeps shared physical bytes for the other profile');
    const primaryEvidence = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`);
    assert.equal(primaryEvidence.status, 200);
    assert.ok(primaryEvidence.body.some((item: { id: string }) => item.id === evidenceId));

    const maximumExcelRow = 1_048_576;
    const boundarySheet = {
      A1: { v: 'Date', t: 's' },
      B1: { v: 'Amount', t: 's' },
      C1: { v: 'Description', t: 's' },
      [`A${maximumExcelRow}`]: { v: '2025-06-03', t: 's' },
      [`B${maximumExcelRow}`]: { v: '42.50', t: 's' },
      [`C${maximumExcelRow}`]: { v: 'Maximum row movement', t: 's' },
      '!ref': `A1:C${maximumExcelRow}`,
    } as XLSX.WorkSheet;
    const adjacentSheet = {
      A1: { v: 'Date', t: 's' },
      B1: { v: 'Amount', t: 's' },
      C1: { v: 'Description', t: 's' },
      A2: { v: '2025-06-04', t: 's' },
      B2: { v: '17.25', t: 's' },
      C2: { v: 'Adjacent sheet movement', t: 's' },
      '!ref': 'A1:C2',
    } as XLSX.WorkSheet;
    const boundaryWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(boundaryWorkbook, boundarySheet, 'Maximum rows');
    XLSX.utils.book_append_sheet(boundaryWorkbook, adjacentSheet, 'Adjacent sheet');
    spreadsheetBuffer = XLSX.write(boundaryWorkbook, { type: 'buffer', bookType: 'xlsx' });

    const spreadsheetUpload = await upload(aliceSession, alicePrimary, 'boundary workbook bytes');
    assert.equal(spreadsheetUpload.status, 200);
    const spreadsheetRegistration = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'boundary-workbook.xlsx',
        objectPath: spreadsheetUpload.body.objectPath,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        evidenceType: 'ledger',
      }),
    });
    assert.equal(spreadsheetRegistration.status, 201);
    const spreadsheetEvidenceId = spreadsheetRegistration.body.id as string;
    const boundaryMapping = {
      headerRow: 0,
      columns: { date: 0, amount: 1, description: 2 },
    };
    const boundaryConfirmation = {
      confirmation: true,
      selectedSheetIds: ['sheet_1', 'sheet_2'],
      sheetMappings: { sheet_1: boundaryMapping, sheet_2: boundaryMapping },
      filingScope: ['2025-2026'],
      excludedRowRefs: [],
      preTradingStartMode: 'exclude',
      outsideScopeMode: 'exclude',
    };

    // Seed the second sheet's identity so the first sheet can be inserted
    // before the route encounters the deliberate conflict. The route must
    // roll back that first insert rather than leave a partially imported file.
    const conflictingSourceRowIndex = 1_100_000 + 2;
    const [conflictingTransaction] = await db.insert(transactionsTable).values({
      profileId: alicePrimary,
      evidenceId: spreadsheetEvidenceId,
      sourceRowIndex: conflictingSourceRowIndex,
      rawRowData: { sheetId: 'sheet_2', sourceRow: 2 },
      date: '2025-06-04',
      description: 'Intentional source identity conflict',
      amount: 17.25,
      recordType: 'unknown',
      category: 'expense',
      taxTreatment: 'unclear',
      source: 'extracted',
      evidenceTier: 3,
      accountingCategory: 'other',
      allowablePercentage: 0,
      allowableAmount: 0,
      accountingClassification: 'unknown',
      classificationConfidence: 0,
    }).returning();

    const conflictedConfirmation = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${spreadsheetEvidenceId}/confirm-spreadsheet`,
      { method: 'POST', body: JSON.stringify(boundaryConfirmation) },
    );
    assert.equal(conflictedConfirmation.status, 409);
    assert.equal(conflictedConfirmation.body.code, 'source_row_conflict');
    assert.equal(conflictedConfirmation.body.rolledBack, true);
    assert.deepEqual(conflictedConfirmation.body.conflict, {
      sheetId: 'sheet_2',
      worksheet: 'Adjacent sheet',
      rowNumber: 2,
    });
    assert.match(conflictedConfirmation.body.error, /No rows from this confirmation were added/);
    const afterConflictRows = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.profileId, alicePrimary),
      eq(transactionsTable.evidenceId, spreadsheetEvidenceId),
    ));
    assert.deepEqual(
      afterConflictRows.map((transaction) => transaction.id),
      [conflictingTransaction.id],
      'a source identity conflict rolls back all earlier rows in the workbook',
    );
    const [erroredSpreadsheet] = await db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.id, spreadsheetEvidenceId));
    assert.equal(erroredSpreadsheet.importStatus, 'error');

    assert.deepEqual(
      (erroredSpreadsheet.mappingSchema as { lastImportError?: { conflict?: unknown } } | null)?.lastImportError?.conflict,
      conflictedConfirmation.body.conflict,
      'the saved review retains the affected worksheet and row after a reload',
    );

    const spreadsheetReplacementUpload = await upload(aliceSession, alicePrimary, 'replacement workbook bytes');
    assert.equal(spreadsheetReplacementUpload.status, 200);
    const spreadsheetReplacement = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${spreadsheetEvidenceId}/replace-spreadsheet`,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: 'corrected-boundary-workbook.xlsx',
          objectPath: spreadsheetReplacementUpload.body.objectPath,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      },
    );
    assert.equal(spreadsheetReplacement.status, 200);
    assert.equal(spreadsheetReplacement.body.id, spreadsheetEvidenceId,
      'a replacement keeps the same source-row identity fence');
    assert.equal(spreadsheetReplacement.body.importStatus, 'idle');

    await db.delete(transactionsTable).where(eq(transactionsTable.id, conflictingTransaction.id));
    const confirmedBoundary = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${spreadsheetEvidenceId}/confirm-spreadsheet`,
      { method: 'POST', body: JSON.stringify(boundaryConfirmation) },
    );
    assert.equal(confirmedBoundary.status, 200);
    assert.equal(confirmedBoundary.body.importedRows, 2);
    const persistedBoundaryRows = await db.select().from(transactionsTable)
      .where(and(
        eq(transactionsTable.profileId, alicePrimary),
        eq(transactionsTable.evidenceId, spreadsheetEvidenceId),
      ));
    assert.equal(persistedBoundaryRows.length, 2);
    const persistedBoundaryOutcomes = await db.select().from(spreadsheetRowOutcomesTable)
      .where(and(
        eq(spreadsheetRowOutcomesTable.profileId, alicePrimary),
        eq(spreadsheetRowOutcomesTable.evidenceId, spreadsheetEvidenceId),
      ));
    assert.equal(persistedBoundaryOutcomes.length, 4,
      'every actual worksheet source row, including headers, receives one durable disposition');
    assert.deepEqual(
      persistedBoundaryOutcomes.map((row) => row.primaryDisposition).sort(),
      ['header', 'header', 'imported', 'imported'],
      'final source dispositions reconcile exactly to the inspected source population',
    );
    assert.deepEqual(
      persistedBoundaryRows
        .map((transaction) => ({
          sourceRowIndex: transaction.sourceRowIndex,
          sheetId: (transaction.rawRowData as { sheetId: string }).sheetId,
          sourceRow: (transaction.rawRowData as { sourceRow: number }).sourceRow,
        }))
        .sort((left, right) => left.sourceRowIndex! - right.sourceRowIndex!),
      [
        { sourceRowIndex: maximumExcelRow, sheetId: 'sheet_1', sourceRow: maximumExcelRow },
        { sourceRowIndex: 1_100_002, sheetId: 'sheet_2', sourceRow: 2 },
      ],
      'maximum-row and adjacent-sheet movements retain distinct source identities',
    );

    const blockedCompletedReplacement = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${spreadsheetEvidenceId}/replace-spreadsheet`,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: 'must-not-replace-completed.xlsx',
          objectPath: spreadsheetReplacementUpload.body.objectPath,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      },
    );
    assert.equal(blockedCompletedReplacement.status, 409,
      'only a failed spreadsheet import may be replaced');
    const [completedSpreadsheet] = await db.select().from(evidenceItemsTable)
      .where(eq(evidenceItemsTable.id, spreadsheetEvidenceId));
    assert.equal(completedSpreadsheet.importStatus, 'done');
    assert.equal(completedSpreadsheet.objectPath, spreadsheetReplacementUpload.body.objectPath);
    assert.equal(
      (await db.select().from(transactionsTable).where(and(
        eq(transactionsTable.profileId, alicePrimary),
        eq(transactionsTable.evidenceId, spreadsheetEvidenceId),
      ))).length,
      2,
      'a blocked replacement leaves completed movements untouched',
    );

    const replayedBoundary = await request(
      aliceSession,
      `/api/profiles/${alicePrimary}/evidence/${spreadsheetEvidenceId}/confirm-spreadsheet`,
      { method: 'POST', body: JSON.stringify(boundaryConfirmation) },
    );
    assert.equal(replayedBoundary.status, 200);
    assert.equal(replayedBoundary.body.importedRows, 2);
    assert.equal(
      (await db.select().from(transactionsTable).where(and(
        eq(transactionsTable.profileId, alicePrimary),
        eq(transactionsTable.evidenceId, spreadsheetEvidenceId),
      ))).length,
      2,
      'repeating the confirmed mapping returns the prior outcome without duplicates',
    );

    spreadsheetBuffer = Buffer.from([
      'Date,Description,Amount',
      '06/04/2025,Prior imported movement,19.25',
    ].join('\n'));
    const firstDuplicateUpload = await upload(aliceSession, alicePrimary, 'first duplicate workbook bytes');
    assert.equal(firstDuplicateUpload.status, 200);
    const firstDuplicateEvidence = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'first-duplicate.csv', objectPath: firstDuplicateUpload.body.objectPath, mimeType: 'text/csv', evidenceType: 'ledger' }),
    });
    const duplicateConfirmation = {
      confirmation: true,
      selectedSheetIds: ['sheet_1'],
      sheetMappings: { sheet_1: { headerRow: 0, columns: { date: 0, description: 1, amount: 2 } } },
      filingScope: ['2025-2026'],
      excludedRowRefs: [],
      preTradingStartMode: 'exclude',
      outsideScopeMode: 'exclude',
    };
    assert.equal((await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${firstDuplicateEvidence.body.id}/confirm-spreadsheet`, {
      method: 'POST', body: JSON.stringify(duplicateConfirmation),
    })).status, 200);
    const secondDuplicateUpload = await upload(aliceSession, alicePrimary, 'second duplicate workbook bytes');
    const secondDuplicateEvidence = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'second-duplicate.csv', objectPath: secondDuplicateUpload.body.objectPath, mimeType: 'text/csv', evidenceType: 'ledger' }),
    });
    const secondDuplicateConfirmation = await request(aliceSession, `/api/profiles/${alicePrimary}/evidence/${secondDuplicateEvidence.body.id}/confirm-spreadsheet`, {
      method: 'POST', body: JSON.stringify(duplicateConfirmation),
    });
    assert.equal(secondDuplicateConfirmation.status, 200);
    assert.equal(secondDuplicateConfirmation.body.importedRows, 0,
      'matching movements in a prior spreadsheet are not silently written twice');
    const [duplicateOutcome] = await db.select().from(spreadsheetRowOutcomesTable).where(and(
      eq(spreadsheetRowOutcomesTable.evidenceId, secondDuplicateEvidence.body.id),
      eq(spreadsheetRowOutcomesTable.primaryDisposition, 'duplicate'),
    ));
    assert.deepEqual(duplicateOutcome.secondaryFindings, ['prior_profile_record']);
  } finally {
    ObjectStorageService.prototype.saveContent = originalSaveContent;
    ObjectStorageService.prototype.getObjectEntityFile = originalGetFile;
    ObjectStorageService.prototype.downloadObject = originalDownload;
    ObjectStorageService.prototype.getObjectEntityUploadURL = originalUploadUrl;
    if (server) await closeServer(server);
    if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    if (profileIds.length) await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(users)));
    await pool.end();
  }
});