import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  pool,
  profilesTable,
  selfAssessmentIdentityTable,
  selfAssessmentSa100ContextsTable,
  selfAssessmentSa103sContextsTable,
  sessionsTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';

const TAX_YEAR = '2025/26';
const TAX_YEAR_PATH = encodeURIComponent(TAX_YEAR);

type ResponseBody = Record<string, any>;

if (process.env.SELF_ASSESSMENT_TEST_DATABASE !== '1') {
  throw new Error(
    'Self Assessment route tests require an explicitly marked disposable test database.',
  );
}
const routeTestDatabaseName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(routeTestDatabaseName)) {
  throw new Error(
    'Self Assessment route tests require DATABASE_URL to point to a dedicated test database.',
  );
}

async function request(
  sid: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ResponseBody }> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${sid}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, { ...init, headers });
  return { status: response.status, body: await response.json() as ResponseBody };
}

let testPort = 0;

function assertPayloadDoesNotContainRawIdentifiers(
  payload: unknown,
  ...identifiers: string[]
): void {
  const serialized = JSON.stringify(payload);
  for (const identifier of identifiers) {
    assert.equal(
      serialized.includes(identifier),
      false,
      `payload unexpectedly contained raw protected identifier ${identifier}`,
    );
  }
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('authenticated Self Assessment routes isolate users and retry failed legacy migration', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const userIds = {
    alice: `sa-route-alice-${suffix}`,
    bob: `sa-route-bob-${suffix}`,
    unanimous: `sa-route-unanimous-${suffix}`,
    conflict: `sa-route-conflict-${suffix}`,
    retry: `sa-route-retry-${suffix}`,
  };
  const rawIdentifiers = {
    aliceUtr: '1234567890',
    aliceNino: 'AB123456C',
    bobUtr: '0987654321',
    bobNino: 'CE654321D',
  };
  const profileIds: string[] = [];
  const sessionIds: string[] = [];
  let migrationTriggerCreated = false;
  const migrationTrigger = `sa_test_cleanup_trigger_${suffix}`;
  const migrationFunction = `sa_test_cleanup_function_${suffix}`;
  const migrationSequence = `sa_test_cleanup_sequence_${suffix}`;
  let server: ReturnType<typeof app.listen> | undefined;

  async function createUser(id: string, email: string) {
    await db.insert(usersTable).values({
      id,
      email,
      firstName: id,
      lastName: 'Self Assessment Test',
    });
  }

  async function createProfile(
    userId: string,
    name: string,
    legacyOtherTaxableIncome?: number,
  ): Promise<string> {
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name,
      type: 'sole_trader',
      taxYear: TAX_YEAR,
      otherTaxableIncome: legacyOtherTaxableIncome ?? null,
      otherTaxableIncomeTaxYear: legacyOtherTaxableIncome == null ? null : TAX_YEAR,
    }).returning({ id: profilesTable.id });
    profileIds.push(profile.id);
    return profile.id;
  }

  async function createTestSession(userId: string): Promise<string> {
    const sid = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: userId,
        lastName: 'Self Assessment Test',
        profileImageUrl: null,
      },
      access_token: `test-access-${userId}`,
    });
    sessionIds.push(sid);
    return sid;
  }

  async function cleanup() {
    if (migrationTriggerCreated) {
      await pool.query(`DROP TRIGGER IF EXISTS "${migrationTrigger}" ON profiles`);
      await pool.query(`DROP FUNCTION IF EXISTS "${migrationFunction}"()`);
      await pool.query(`DROP SEQUENCE IF EXISTS "${migrationSequence}"`);
    }
    await db.delete(selfAssessmentSa103sContextsTable).where(
      inArray(selfAssessmentSa103sContextsTable.profileId, profileIds),
    );
    await db.delete(selfAssessmentSa100ContextsTable).where(
      inArray(selfAssessmentSa100ContextsTable.userId, Object.values(userIds)),
    );
    await db.delete(selfAssessmentIdentityTable).where(
      inArray(selfAssessmentIdentityTable.userId, Object.values(userIds)),
    );
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(userIds)));
  }

  try {
    await Promise.all([
      createUser(userIds.alice, `alice-${suffix}@example.test`),
      createUser(userIds.bob, `bob-${suffix}@example.test`),
      createUser(userIds.unanimous, `unanimous-${suffix}@example.test`),
      createUser(userIds.conflict, `conflict-${suffix}@example.test`),
      createUser(userIds.retry, `retry-${suffix}@example.test`),
    ]);

    const aliceProfile = await createProfile(userIds.alice, 'Alice Design');
    const aliceSecondProfile = await createProfile(userIds.alice, 'Alice Training');
    const bobProfile = await createProfile(userIds.bob, 'Bob Consulting');
    const unanimousProfileOne = await createProfile(userIds.unanimous, 'Unanimous One', 2400);
    const unanimousProfileTwo = await createProfile(userIds.unanimous, 'Unanimous Two', 2400);
    const conflictProfileOne = await createProfile(userIds.conflict, 'Conflict One', 700);
    const conflictProfileTwo = await createProfile(userIds.conflict, 'Conflict Two', 900);
    const retryProfileOne = await createProfile(userIds.retry, 'Retry One', 1800);
    const retryProfileTwo = await createProfile(userIds.retry, 'Retry Two', 1800);

    await db.insert(transactionsTable).values([
      {
        profileId: aliceProfile,
        date: '2025-06-01',
        description: 'Alice income',
        amount: 18000,
        recordType: 'income',
        category: 'sales',
        taxTreatment: 'income',
      },
      {
        profileId: bobProfile,
        date: '2025-06-01',
        description: 'Bob income',
        amount: 42000,
        recordType: 'income',
        category: 'sales',
        taxTreatment: 'income',
      },
    ]);
    await db.insert(selfAssessmentSa100ContextsTable).values([
      {
        userId: userIds.alice,
        taxYear: TAX_YEAR,
        otherTaxableIncome: 321,
        allSelfEmploymentsDisclosed: true,
      },
      {
        userId: userIds.bob,
        taxYear: TAX_YEAR,
        otherTaxableIncome: 654,
        allSelfEmploymentsDisclosed: false,
      },
    ]);
    await db.insert(selfAssessmentSa103sContextsTable).values({
      profileId: aliceProfile,
      taxYear: TAX_YEAR,
      businessDescription: 'Alice private business',
      recordsCompleteConfirmed: true,
    });
    await db.insert(selfAssessmentSa103sContextsTable).values({
      profileId: bobProfile,
      taxYear: TAX_YEAR,
      businessDescription: 'Bob private business',
      recordsCompleteConfirmed: false,
    });

    const aliceSid = await createTestSession(userIds.alice);
    const bobSid = await createTestSession(userIds.bob);
    const unanimousSid = await createTestSession(userIds.unanimous);
    const conflictSid = await createTestSession(userIds.conflict);
    const retrySid = await createTestSession(userIds.retry);

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    testPort = (server.address() as AddressInfo).port;

    const aliceIdentityUpdate = await request(aliceSid, '/api/self-assessment/identity', {
      method: 'PATCH',
      body: JSON.stringify({
        utr: rawIdentifiers.aliceUtr,
        nationalInsuranceNumber: rawIdentifiers.aliceNino,
      }),
    });
    assert.equal(aliceIdentityUpdate.status, 200);
    assert.equal(aliceIdentityUpdate.body.utrMasked, '•••• 7890');
    assert.equal(aliceIdentityUpdate.body.nationalInsuranceNumberMasked, '•••• 456C');
    assertPayloadDoesNotContainRawIdentifiers(
      aliceIdentityUpdate.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const bobIdentityUpdate = await request(bobSid, '/api/self-assessment/identity', {
      method: 'PATCH',
      body: JSON.stringify({
        utr: rawIdentifiers.bobUtr,
        nationalInsuranceNumber: rawIdentifiers.bobNino,
      }),
    });
    assert.equal(bobIdentityUpdate.status, 200);
    assert.equal(bobIdentityUpdate.body.utrMasked, '•••• 4321');
    assert.equal(bobIdentityUpdate.body.nationalInsuranceNumberMasked, '•••• 321D');
    assertPayloadDoesNotContainRawIdentifiers(
      bobIdentityUpdate.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const aliceIdentity = await request(aliceSid, '/api/self-assessment/identity');
    assert.equal(aliceIdentity.status, 200);
    assert.equal(aliceIdentity.body.utrMasked, '•••• 7890');
    assert.equal(aliceIdentity.body.nationalInsuranceNumberMasked, '•••• 456C');
    assertPayloadDoesNotContainRawIdentifiers(
      aliceIdentity.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const invalidIdentity = await request(aliceSid, '/api/self-assessment/identity', {
      method: 'PATCH',
      body: JSON.stringify({ utr: rawIdentifiers.aliceUtr, nationalInsuranceNumber: 'not-a-nino' }),
    });
    assert.equal(invalidIdentity.status, 400);
    assertPayloadDoesNotContainRawIdentifiers(
      invalidIdentity.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const aliceSa100Before = await request(aliceSid, `/api/self-assessment/sa100/${TAX_YEAR_PATH}`);
    const bobSa100Before = await request(bobSid, `/api/self-assessment/sa100/${TAX_YEAR_PATH}`);
    assert.equal(aliceSa100Before.status, 200);
    assert.equal(aliceSa100Before.body.otherTaxableIncome, 321);
    assert.equal(bobSa100Before.status, 200);
    assert.equal(bobSa100Before.body.otherTaxableIncome, 654);

    const aliceSa100Update = await request(aliceSid, `/api/self-assessment/sa100/${TAX_YEAR_PATH}`, {
      method: 'PATCH',
      body: JSON.stringify({ otherTaxableIncome: 999, allSelfEmploymentsDisclosed: false }),
    });
    assert.equal(aliceSa100Update.status, 200);
    assert.equal(aliceSa100Update.body.otherTaxableIncome, 999);
    assert.equal(aliceSa100Update.body.allSelfEmploymentsDisclosed, false);

    const bobSa100AfterAliceUpdate = await request(bobSid, `/api/self-assessment/sa100/${TAX_YEAR_PATH}`);
    assert.equal(bobSa100AfterAliceUpdate.status, 200);
    assert.equal(bobSa100AfterAliceUpdate.body.otherTaxableIncome, 654);
    assert.equal(bobSa100AfterAliceUpdate.body.allSelfEmploymentsDisclosed, false);
    assertPayloadDoesNotContainRawIdentifiers(
      aliceSa100Update.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );
    assertPayloadDoesNotContainRawIdentifiers(
      bobSa100AfterAliceUpdate.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const crossUserSa103sUpdate = await request(
      aliceSid,
      `/api/profiles/${bobProfile}/self-assessment/sa103s`,
      {
        method: 'PATCH',
        body: JSON.stringify({ businessDescription: 'Alice should not write Bob' }),
      },
    );
    assert.equal(crossUserSa103sUpdate.status, 404);
    assert.equal(crossUserSa103sUpdate.body.error, 'Profile not found');

    const crossUserReadiness = await request(
      aliceSid,
      `/api/profiles/${bobProfile}/self-assessment/readiness`,
    );
    assert.equal(crossUserReadiness.status, 404);
    assert.equal(crossUserReadiness.body.error, 'Profile not found');

    const aliceReadiness = await request(
      aliceSid,
      `/api/profiles/${aliceProfile}/self-assessment/readiness`,
    );
    assert.equal(aliceReadiness.status, 200);
    assert.equal(aliceReadiness.body.sa100Context.otherTaxableIncome, 999);
    assert.equal(aliceReadiness.body.sa103sContext.businessDescription, 'Alice private business');
    assert.equal(aliceReadiness.body.readiness.returnStructure.activeBusinessProfileId, aliceProfile);
    assert.equal(aliceReadiness.body.readiness.returnStructure.businessSectionCount, 2);
    assert.deepEqual(
      aliceReadiness.body.readiness.returnStructure.businessSections.map(
        (section: { profileId: string }) => section.profileId,
      ).sort(),
      [aliceProfile, aliceSecondProfile].sort(),
    );
    assert.equal(JSON.stringify(aliceReadiness.body).includes('Bob Consulting'), false);
    assertPayloadDoesNotContainRawIdentifiers(
      aliceReadiness.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const bobReadiness = await request(
      bobSid,
      `/api/profiles/${bobProfile}/self-assessment/readiness`,
    );
    assert.equal(bobReadiness.status, 200);
    assert.equal(bobReadiness.body.sa100Context.otherTaxableIncome, 654);
    assert.equal(bobReadiness.body.sa103sContext.businessDescription, 'Bob private business');
    assert.equal(bobReadiness.body.readiness.returnStructure.activeBusinessProfileId, bobProfile);
    assert.equal(JSON.stringify(bobReadiness.body).includes('Alice Design'), false);
    assertPayloadDoesNotContainRawIdentifiers(
      bobReadiness.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const [bobBusinessAfterCrossUserUpdate] = await db.select({
      businessDescription: selfAssessmentSa103sContextsTable.businessDescription,
    }).from(selfAssessmentSa103sContextsTable).where(
      and(
        eq(selfAssessmentSa103sContextsTable.profileId, bobProfile),
        eq(selfAssessmentSa103sContextsTable.taxYear, TAX_YEAR),
      ),
    );
    assert.equal(bobBusinessAfterCrossUserUpdate.businessDescription, 'Bob private business');

    const unanimousMigration = await request(
      unanimousSid,
      `/api/self-assessment/sa100/${TAX_YEAR_PATH}`,
    );
    assert.equal(unanimousMigration.status, 200);
    assert.equal(unanimousMigration.body.otherTaxableIncome, 2400);
    assert.equal(unanimousMigration.body.migrationConflict, false);
    const unanimousLegacyProfiles = await db.select({
      otherTaxableIncome: profilesTable.otherTaxableIncome,
      otherTaxableIncomeTaxYear: profilesTable.otherTaxableIncomeTaxYear,
    }).from(profilesTable).where(
      inArray(profilesTable.id, [unanimousProfileOne, unanimousProfileTwo]),
    );
    assert.deepEqual(unanimousLegacyProfiles, [
      { otherTaxableIncome: null, otherTaxableIncomeTaxYear: null },
      { otherTaxableIncome: null, otherTaxableIncomeTaxYear: null },
    ]);

    const conflictMigration = await request(
      conflictSid,
      `/api/self-assessment/sa100/${TAX_YEAR_PATH}`,
    );
    assert.equal(conflictMigration.status, 200);
    assert.equal(conflictMigration.body.otherTaxableIncome, null);
    assert.equal(conflictMigration.body.migrationConflict, true);
    const [conflictContext] = await db.select({
      otherTaxableIncome: selfAssessmentSa100ContextsTable.otherTaxableIncome,
      migrationConflict: selfAssessmentSa100ContextsTable.migrationConflict,
    }).from(selfAssessmentSa100ContextsTable).where(
      and(
        eq(selfAssessmentSa100ContextsTable.userId, userIds.conflict),
        eq(selfAssessmentSa100ContextsTable.taxYear, TAX_YEAR),
      ),
    );
    assert.deepEqual(conflictContext, { otherTaxableIncome: null, migrationConflict: true });
    const conflictLegacyProfiles = await db.select({
      otherTaxableIncome: profilesTable.otherTaxableIncome,
      otherTaxableIncomeTaxYear: profilesTable.otherTaxableIncomeTaxYear,
    }).from(profilesTable).where(
      inArray(profilesTable.id, [conflictProfileOne, conflictProfileTwo]),
    );
    assert.deepEqual(conflictLegacyProfiles, [
      { otherTaxableIncome: 700, otherTaxableIncomeTaxYear: TAX_YEAR },
      { otherTaxableIncome: 900, otherTaxableIncomeTaxYear: TAX_YEAR },
    ]);

    await pool.query(`CREATE SEQUENCE "${migrationSequence}"`);
    await pool.query(`
      CREATE FUNCTION "${migrationFunction}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('public.${migrationSequence}') = 1 THEN
          RAISE EXCEPTION 'intentional migration cleanup failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER "${migrationTrigger}"
      BEFORE UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION "${migrationFunction}"()
    `);
    migrationTriggerCreated = true;

    const failedMigrationRetry = await request(
      retrySid,
      `/api/self-assessment/sa100/${TAX_YEAR_PATH}`,
    );
    assert.equal(failedMigrationRetry.status, 500);
    assert.equal(failedMigrationRetry.body.error, 'Could not load Self Assessment return context');
    assertPayloadDoesNotContainRawIdentifiers(
      failedMigrationRetry.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );

    const successfulMigrationRetry = await request(
      retrySid,
      `/api/self-assessment/sa100/${TAX_YEAR_PATH}`,
    );
    assert.equal(successfulMigrationRetry.status, 200);
    assert.equal(successfulMigrationRetry.body.otherTaxableIncome, 1800);
    assert.equal(successfulMigrationRetry.body.migrationConflict, false);
    const retryLegacyProfiles = await db.select({
      otherTaxableIncome: profilesTable.otherTaxableIncome,
      otherTaxableIncomeTaxYear: profilesTable.otherTaxableIncomeTaxYear,
    }).from(profilesTable).where(
      inArray(profilesTable.id, [retryProfileOne, retryProfileTwo]),
    );
    assert.deepEqual(retryLegacyProfiles, [
      { otherTaxableIncome: null, otherTaxableIncomeTaxYear: null },
      { otherTaxableIncome: null, otherTaxableIncomeTaxYear: null },
    ]);
    assertPayloadDoesNotContainRawIdentifiers(
      successfulMigrationRetry.body,
      rawIdentifiers.aliceUtr,
      rawIdentifiers.aliceNino,
      rawIdentifiers.bobUtr,
      rawIdentifiers.bobNino,
    );
  } finally {
    if (server) await closeServer(server);
    await cleanup();
    await pool.end();
  }
});