import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  evidenceAuditEventsTable,
  evidenceItemsTable,
  evidenceTransactionLinksTable,
  privateUploadObjectsTable,
  privateUploadProfileBindingsTable,
  profilesTable,
  sessionsTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';

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
  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as ResponseBody : {} };
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('M9 evidence is profile-bound, review-only until confirmation, and lifecycle-safe', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const userIds = { alice: `m9-alice-${suffix}`, bob: `m9-bob-${suffix}` };
  const profileIds: string[] = [];
  const sessionIds: string[] = [];
  const uploadedPaths: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  async function createUser(id: string): Promise<void> {
    await db.insert(usersTable).values({
      id,
      email: `${id}@example.test`,
      firstName: 'M9',
      lastName: 'Safety',
    });
  }

  async function createProfile(userId: string, name: string): Promise<string> {
    const [profile] = await db.insert(profilesTable).values({
      userId, name, type: 'sole_trader', taxYear: '2025/26', accountingBasis: 'cash',
    }).returning({ id: profilesTable.id });
    profileIds.push(profile.id);
    return profile.id;
  }

  async function createSessionFor(userId: string): Promise<string> {
    const sid = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: 'M9',
        lastName: 'Safety',
        profileImageUrl: null,
      },
      access_token: `evidence-test-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionIds.push(sid);
    return sid;
  }

  async function seedUpload(userId: string, label: string, contentHash = `hash-${label}-${suffix}`): Promise<string> {
    const objectPath = `/objects/uploads/m9-${label}-${suffix}`;
    uploadedPaths.push(objectPath);
    await db.insert(privateUploadObjectsTable).values({
      objectPath, userId, contentHash, objectSize: 128,
    });
    return objectPath;
  }

  async function registerDocument(
    sid: string,
    profileId: string,
    objectPath: string,
    filename: string,
  ): Promise<ResponseBody> {
    const response = await request(sid, `/api/profiles/${profileId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename, objectPath, mimeType: 'image/jpeg', category: 'office_costs', evidenceType: 'document',
      }),
    });
    assert.ok(response.status === 200 || response.status === 201, `registration failed: ${JSON.stringify(response.body)}`);
    return response.body;
  }

  try {
    await Promise.all(Object.values(userIds).map(createUser));
    const [aliceProfile, aliceSecondProfile, bobProfile] = await Promise.all([
      createProfile(userIds.alice, 'Alice evidence one'),
      createProfile(userIds.alice, 'Alice evidence two'),
      createProfile(userIds.bob, 'Bob evidence'),
    ]);
    const [aliceSession, bobSession] = await Promise.all([
      createSessionFor(userIds.alice),
      createSessionFor(userIds.bob),
    ]);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    testPort = (server.address() as AddressInfo).port;

    const primaryPath = await seedUpload(userIds.alice, 'primary');
    const duplicateRegistrations = await Promise.all([
      registerDocument(aliceSession, aliceProfile, primaryPath, 'primary-receipt.jpg'),
      registerDocument(aliceSession, aliceProfile, primaryPath, 'primary-receipt.jpg'),
    ]);
    assert.equal(duplicateRegistrations[0].id, duplicateRegistrations[1].id, 'same-profile registration converges');
    const primaryEvidenceId = duplicateRegistrations[0].id as string;

    const [binding] = await db.select().from(privateUploadProfileBindingsTable).where(and(
      eq(privateUploadProfileBindingsTable.profileId, aliceProfile),
      eq(privateUploadProfileBindingsTable.objectPath, primaryPath),
      eq(privateUploadProfileBindingsTable.userId, userIds.alice),
    ));
    assert.ok(binding, 'registration creates an explicit profile/object binding');

    const crossProfileRead = await request(
      aliceSession,
      `/api/profiles/${aliceSecondProfile}/evidence/${primaryEvidenceId}/download`,
    );
    assert.equal(crossProfileRead.status, 404, 'a second owned profile cannot use another profile’s evidence id');
    const crossUserRead = await request(
      bobSession,
      `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/download`,
    );
    assert.equal(crossUserRead.status, 404, 'a different user cannot download private evidence');
    const pathOnlyRead = await request(aliceSession, `/api/storage/objects/uploads/m9-primary-${suffix}`);
    assert.equal(pathOnlyRead.status, 404, 'registered evidence rejects path-only private downloads');

    const crossUserRegister = await request(bobSession, `/api/profiles/${bobProfile}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'stolen.jpg', objectPath: primaryPath, mimeType: 'image/jpeg', evidenceType: 'document',
      }),
    });
    assert.equal(crossUserRegister.status, 404, 'object paths are not transferable across users');

    const bindingLossPath = await seedUpload(userIds.alice, 'binding-loss');
    const bindingLossEvidence = await registerDocument(
      aliceSession, aliceProfile, bindingLossPath, 'binding-loss.jpg',
    );
    await db.delete(privateUploadProfileBindingsTable).where(and(
      eq(privateUploadProfileBindingsTable.profileId, aliceProfile),
      eq(privateUploadProfileBindingsTable.objectPath, bindingLossPath),
    ));
    const unboundProcess = await request(
      aliceSession,
      `/api/profiles/${aliceProfile}/evidence/${bindingLossEvidence.id}/process`,
      { method: 'POST' },
    );
    assert.equal(unboundProcess.status, 404, 'M9 processing requires the profile/object binding');
    const unboundTombstone = await request(
      aliceSession,
      `/api/profiles/${aliceProfile}/evidence/${bindingLossEvidence.id}/tombstone`,
      { method: 'POST' },
    );
    assert.equal(unboundTombstone.status, 404, 'M9 lifecycle mutations require the profile/object binding');

    // Same bytes can be reused by a second owned profile only through a new,
    // explicit registration/binding rather than through the original evidence.
    const secondProfileEvidence = await registerDocument(
      aliceSession, aliceSecondProfile, primaryPath, 'second-profile-receipt.jpg',
    );
    assert.notEqual(secondProfileEvidence.id, primaryEvidenceId);
    const [secondBinding] = await db.select().from(privateUploadProfileBindingsTable).where(and(
      eq(privateUploadProfileBindingsTable.profileId, aliceSecondProfile),
      eq(privateUploadProfileBindingsTable.objectPath, primaryPath),
    ));
    assert.ok(secondBinding, 'physical reuse has a separate profile binding');

    await db.insert(transactionsTable).values({
      profileId: aliceProfile,
      date: '2025-07-01',
      description: 'Existing canonical income',
      amount: 1000,
      recordType: 'income',
      category: 'sales',
      taxTreatment: 'income',
      source: 'manual',
      accountingCategory: 'sales',
    });
    const [positionBefore, taxBefore, readinessBefore] = await Promise.all([
      request(aliceSession, `/api/profiles/${aliceProfile}/position`),
      request(aliceSession, `/api/profiles/${aliceProfile}/income-tax-estimate`),
      request(aliceSession, `/api/profiles/${aliceProfile}/self-assessment/readiness`),
    ]);
    assert.equal(positionBefore.status, 200);
    assert.equal(taxBefore.status, 200);
    assert.equal(readinessBefore.status, 200);

    const processed = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/process`, {
      method: 'POST',
    });
    assert.equal(processed.status, 200);
    assert.equal(processed.body.status, 'needs_review');
    assert.equal(processed.body.reviewState, 'review_required');
    const resumed = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/process`, {
      method: 'POST',
    });
    assert.equal(resumed.status, 200, 'a reload/resume returns the already reviewable document');
    assert.equal(resumed.body.id, primaryEvidenceId);
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, aliceProfile))).length,
      1,
      'M9 extraction cannot auto-post a canonical transaction',
    );

    const reviewed = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ category: 'professional_fees', extractedData: { supplier: 'Acme', amount: 125 } }),
    });
    assert.equal(reviewed.status, 200);
    const [positionAfterReview, taxAfterReview, readinessAfterReview] = await Promise.all([
      request(aliceSession, `/api/profiles/${aliceProfile}/position`),
      request(aliceSession, `/api/profiles/${aliceProfile}/income-tax-estimate`),
      request(aliceSession, `/api/profiles/${aliceProfile}/self-assessment/readiness`),
    ]);
    assert.deepEqual(positionAfterReview.body, positionBefore.body, 'review-only work cannot change P&L, cash, tax reserve, or readiness');
    assert.deepEqual(taxAfterReview.body, taxBefore.body, 'review-only work cannot change the income-tax estimate');
    assert.deepEqual(readinessAfterReview.body, readinessBefore.body, 'review-only work cannot change Self Assessment readiness');

    const unmatchedBeforeConfirm = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/unmatched`);
    assert.ok(unmatchedBeforeConfirm.body.some((item: ResponseBody) => item.id === primaryEvidenceId));
    const confirmationKey = randomUUID();
    const confirmationInput = {
      idempotencyKey: confirmationKey,
      date: '2025-07-02',
      description: 'Confirmed professional fee',
      amount: 125,
      category: 'professional_fees',
      taxTreatment: 'deductible',
      allowablePercentage: 100,
    };
    const confirmationResults = await Promise.all([
      request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationInput),
      }),
      request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${primaryEvidenceId}/confirm-transaction`, {
        method: 'POST', body: JSON.stringify(confirmationInput),
      }),
    ]);
    assert.ok(confirmationResults.every((result) => result.status === 200 || result.status === 201));
    const confirmedTransactions = await db.select().from(transactionsTable).where(eq(transactionsTable.id, confirmationKey));
    assert.equal(confirmedTransactions.length, 1, 'confirmation retries create one canonical record');
    assert.equal(confirmedTransactions[0].amount, -125, 'deductible confirmation retains the correct expense direction');
    assert.equal(confirmedTransactions[0].evidenceId, null, 'M9 uses the bridge link, not the legacy evidence column');
    const confirmationLinks = await db.select().from(evidenceTransactionLinksTable).where(and(
      eq(evidenceTransactionLinksTable.evidenceId, primaryEvidenceId),
      eq(evidenceTransactionLinksTable.transactionId, confirmationKey),
      eq(evidenceTransactionLinksTable.linkStatus, 'active'),
    ));
    assert.equal(confirmationLinks.length, 1, 'confirmation creates one active evidence bridge');
    const unmatchedAfterConfirm = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/unmatched`);
    assert.equal(unmatchedAfterConfirm.body.some((item: ResponseBody) => item.id === primaryEvidenceId), false);

    const supportingPath = await seedUpload(userIds.alice, 'supporting');
    const supportingEvidence = await registerDocument(aliceSession, aliceProfile, supportingPath, 'supporting-document.jpg');
    const [manualOne, manualTwo] = await db.insert(transactionsTable).values([
      {
        profileId: aliceProfile, date: '2025-07-03', description: 'Manual one', amount: 30,
        recordType: 'income', category: 'sales', taxTreatment: 'income', source: 'manual', accountingCategory: 'sales',
      },
      {
        profileId: aliceProfile, date: '2025-07-04', description: 'Manual two', amount: 40,
        recordType: 'income', category: 'sales', taxTreatment: 'income', source: 'manual', accountingCategory: 'sales',
      },
    ]).returning();
    for (const transaction of [manualOne, manualTwo]) {
      const attached = await request(aliceSession, `/api/profiles/${aliceProfile}/transactions/${transaction.id}/attach-evidence`, {
        method: 'PATCH', body: JSON.stringify({ evidenceId: supportingEvidence.id }),
      });
      assert.equal(attached.status, 200);
    }
    let supportingLinks = await db.select().from(evidenceTransactionLinksTable).where(and(
      eq(evidenceTransactionLinksTable.evidenceId, supportingEvidence.id),
      eq(evidenceTransactionLinksTable.linkStatus, 'active'),
    ));
    assert.equal(supportingLinks.length, 2, 'one document can support multiple transactions');
    const firstDetach = await request(
      aliceSession,
      `/api/profiles/${aliceProfile}/evidence/${supportingEvidence.id}/links/${manualOne.id}`,
      { method: 'DELETE' },
    );
    assert.equal(firstDetach.status, 204);
    assert.equal((await db.select().from(transactionsTable).where(eq(transactionsTable.id, manualOne.id))).length, 1,
      'detaching support cannot delete its transaction');
    const repeatDetach = await request(
      aliceSession,
      `/api/profiles/${aliceProfile}/evidence/${supportingEvidence.id}/links/${manualOne.id}`,
      { method: 'DELETE' },
    );
    assert.equal(repeatDetach.status, 404, 'detachment is repeat-safe');
    const secondDetach = await request(
      aliceSession,
      `/api/profiles/${aliceProfile}/evidence/${supportingEvidence.id}/links/${manualTwo.id}`,
      { method: 'DELETE' },
    );
    assert.equal(secondDetach.status, 204);
    const unmatchedAfterDetach = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/unmatched`);
    assert.ok(unmatchedAfterDetach.body.some((item: ResponseBody) => item.id === supportingEvidence.id));

    const replacementPath = await seedUpload(userIds.alice, 'replacement');
    const beforeReplacementLink = await request(aliceSession, `/api/profiles/${aliceProfile}/transactions/${manualOne.id}/attach-evidence`, {
      method: 'PATCH', body: JSON.stringify({ evidenceId: supportingEvidence.id }),
    });
    assert.equal(beforeReplacementLink.status, 200);
    const replaced = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${supportingEvidence.id}/replace`, {
      method: 'POST',
      body: JSON.stringify({ objectPath: replacementPath, filename: 'corrected-document.jpg', mimeType: 'image/jpeg' }),
    });
    assert.equal(replaced.status, 201);
    assert.equal(replaced.body.replacementOfEvidenceId, supportingEvidence.id);
    const oldLinkAfterReplacement = await db.select().from(evidenceTransactionLinksTable).where(and(
      eq(evidenceTransactionLinksTable.evidenceId, supportingEvidence.id),
      eq(evidenceTransactionLinksTable.transactionId, manualOne.id),
      eq(evidenceTransactionLinksTable.linkStatus, 'active'),
    ));
    assert.equal(oldLinkAfterReplacement.length, 1, 'replacement preserves provenance of existing links');
    const replacementBinding = await db.select().from(privateUploadProfileBindingsTable).where(and(
      eq(privateUploadProfileBindingsTable.profileId, aliceProfile),
      eq(privateUploadProfileBindingsTable.objectPath, replacementPath),
    ));
    assert.equal(replacementBinding.length, 1, 'replacement receives its own profile binding');
    const tombstonedReplacement = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${replaced.body.id}/tombstone`, {
      method: 'POST',
    });
    assert.equal(tombstonedReplacement.status, 200);

    const racePath = await seedUpload(userIds.alice, 'race');
    const raceEvidence = await registerDocument(aliceSession, aliceProfile, racePath, 'lifecycle-race.jpg');
    const [raceReview, raceTombstone] = await Promise.all([
      request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${raceEvidence.id}/review`, {
        method: 'PATCH', body: JSON.stringify({ category: 'office_costs' }),
      }),
      request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${raceEvidence.id}/tombstone`, { method: 'POST' }),
    ]);
    assert.ok([200, 404, 409].includes(raceReview.status));
    assert.equal(raceTombstone.status, 200);
    const [racedEvidence] = await db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.id, raceEvidence.id));
    assert.equal(racedEvidence.documentLifecycle, 'tombstoned', 'lifecycle race cannot reactivate a tombstoned document');

    const sharedPath = await seedUpload(userIds.alice, 'shared', `shared-${suffix}`);
    const sharedFirst = await registerDocument(aliceSession, aliceProfile, sharedPath, 'shared-one.jpg');
    const sharedSecond = await registerDocument(aliceSession, aliceSecondProfile, sharedPath, 'shared-two.jpg');
    const discardedShared = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${sharedFirst.id}`, { method: 'DELETE' });
    assert.equal(discardedShared.status, 200);
    assert.equal(discardedShared.body.tombstoned, true);
    const [stillStored] = await db.select().from(privateUploadObjectsTable)
      .where(eq(privateUploadObjectsTable.objectPath, sharedPath));
    const [stillActiveElsewhere] = await db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.id, sharedSecond.id));
    assert.ok(stillStored, 'discarding one logical document never deletes shared physical bytes');
    assert.equal(stillActiveElsewhere.documentLifecycle, 'active');

    const legacyPath = await seedUpload(userIds.alice, 'legacy');
    const [legacyEvidence] = await db.insert(evidenceItemsTable).values({
      profileId: aliceProfile, filename: 'legacy.csv', objectPath: legacyPath, mimeType: 'text/csv',
      evidenceType: 'ledger', workflowVersion: 1, status: 'processed',
    }).returning();
    const [legacyTransaction] = await db.insert(transactionsTable).values({
      profileId: aliceProfile, date: '2025-07-05', description: 'Legacy extracted income', amount: 75,
      recordType: 'income', category: 'sales', taxTreatment: 'income', source: 'extracted',
      evidenceId: legacyEvidence.id, evidenceTier: 3, accountingCategory: 'sales',
    }).returning();
    const legacySnapshot = {
      amount: legacyTransaction.amount,
      taxTreatment: legacyTransaction.taxTreatment,
      evidenceId: legacyTransaction.evidenceId,
      source: legacyTransaction.source,
    };
    const laterM9Path = await seedUpload(userIds.alice, 'later');
    const laterM9 = await registerDocument(aliceSession, aliceProfile, laterM9Path, 'later-review.jpg');
    const laterM9Process = await request(aliceSession, `/api/profiles/${aliceProfile}/evidence/${laterM9.id}/process`, { method: 'POST' });
    assert.equal(laterM9Process.status, 200);
    const [legacyAfterM9] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, legacyTransaction.id));
    assert.deepEqual(
      {
        amount: legacyAfterM9.amount,
        taxTreatment: legacyAfterM9.taxTreatment,
        evidenceId: legacyAfterM9.evidenceId,
        source: legacyAfterM9.source,
      },
      legacySnapshot,
      'legacy workflow-1 outcomes remain present, singular, and tax-classified after M9 activity',
    );
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.evidenceId, legacyEvidence.id))).length,
      1,
      'M9 cannot repost a legacy evidence transaction',
    );
    const auditEvents = await db.select().from(evidenceAuditEventsTable)
      .where(eq(evidenceAuditEventsTable.evidenceId, primaryEvidenceId));
    assert.ok(auditEvents.some((event) => event.eventType === 'financial_confirmation_created'));
  } finally {
    if (server) await closeServer(server);
    if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    if (profileIds.length) await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
    if (uploadedPaths.length) await db.delete(privateUploadObjectsTable)
      .where(inArray(privateUploadObjectsTable.objectPath, uploadedPaths));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(userIds)));
  }
});