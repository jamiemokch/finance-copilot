import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  decisionMemoryTable,
  evidenceItemsTable,
  financialAccountsTable,
  inboxItemsTable,
  pool,
  privateUploadDeletionJobsTable,
  privateUploadObjectsTable,
  profilesTable,
  saChecklistItemsTable,
  selfAssessmentIdentityTable,
  selfAssessmentSa100ContextsTable,
  selfAssessmentSa103sContextsTable,
  sessionsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession } from "../lib/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

if (process.env.UAT_FRESH_USER_RESET_TEST !== "1") {
  throw new Error("UAT fresh-user reset tests require an explicitly marked disposable test database.");
}
const databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  throw new Error("UAT fresh-user reset tests require DATABASE_URL to point to a dedicated test database.");
}

let testPort = 0;

async function request(sid: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${sid}`);
  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as unknown : null };
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("development UAT fresh-user reset is isolated, empty, and does not seed demo data", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const users = {
    alice: `uat-alice-${suffix}`,
    bob: `uat-bob-${suffix}`,
    charlie: `uat-charlie-${suffix}`,
    dana: `uat-dana-${suffix}`,
  };
  const sessionIds: string[] = [];
  const deletedObjectPaths: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;
  const originalDeleteObject = ObjectStorageService.prototype.deleteObjectEntity;
  const originalSaveContent = ObjectStorageService.prototype.saveContent;
  ObjectStorageService.prototype.deleteObjectEntity = async (objectPath: string) => {
    if (objectPath.endsWith("-alice")) {
      const remainingProfiles = await db.select().from(profilesTable)
        .where(eq(profilesTable.userId, users.alice));
      assert.equal(
        remainingProfiles.length,
        0,
        "physical upload deletion only begins after the profile reset transaction commits",
      );
    }
    deletedObjectPaths.push(objectPath);
  };

  async function createProfile(userId: string, name: string): Promise<string> {
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name,
      type: "sole_trader",
      taxYear: "2025/26",
      accountingBasis: "cash",
    }).returning({ id: profilesTable.id });
    return profile.id;
  }

  async function createSessionFor(userId: string): Promise<string> {
    const sid = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: "UAT",
        lastName: "Reset",
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
      firstName: "UAT",
      lastName: "Reset",
    })));
    const [aliceProfile, bobProfile] = await Promise.all([
      createProfile(users.alice, "Alice UAT business"),
      createProfile(users.bob, "Bob control business"),
    ]);
    const [aliceSession, bobSession] = await Promise.all([
      createSessionFor(users.alice),
      createSessionFor(users.bob),
    ]);

    await Promise.all([
      db.insert(transactionsTable).values([
        { profileId: aliceProfile, date: "2025-04-10", description: "Alice record", amount: 100, recordType: "income", category: "income", taxTreatment: "income" },
        { profileId: bobProfile, date: "2025-04-10", description: "Bob control record", amount: 200, recordType: "income", category: "income", taxTreatment: "income" },
      ]),
      db.insert(evidenceItemsTable).values([
        { profileId: aliceProfile, filename: "alice-receipt.pdf", objectPath: "/objects/uploads/uat-alice" },
        { profileId: bobProfile, filename: "bob-receipt.pdf", objectPath: "/objects/uploads/uat-bob" },
      ]),
      db.insert(inboxItemsTable).values([
        { profileId: aliceProfile, date: "2025-04-10", description: "Alice review" },
        { profileId: bobProfile, date: "2025-04-10", description: "Bob review" },
      ]),
      db.insert(decisionMemoryTable).values([
        { profileId: aliceProfile, ideaId: "alice-idea", ideaTitle: "Alice idea", ideaCategory: "growth", date: "2025-04-10", userDecision: "commit" },
        { profileId: bobProfile, ideaId: "bob-idea", ideaTitle: "Bob idea", ideaCategory: "growth", date: "2025-04-10", userDecision: "commit" },
      ]),
      db.insert(saChecklistItemsTable).values([
        { profileId: aliceProfile, checkId: "alice-check", label: "Alice checklist" },
        { profileId: bobProfile, checkId: "bob-check", label: "Bob checklist" },
      ]),
      db.insert(financialAccountsTable).values([
        { profileId: aliceProfile, displayName: "Alice bank" },
        { profileId: bobProfile, displayName: "Bob bank" },
      ]),
      db.insert(selfAssessmentSa103sContextsTable).values([
        { profileId: aliceProfile, taxYear: "2025/26" },
        { profileId: bobProfile, taxYear: "2025/26" },
      ]),
      db.insert(privateUploadObjectsTable).values([
        { userId: users.alice, objectPath: `/objects/uploads/uat-${suffix}-alice` },
        { userId: users.bob, objectPath: `/objects/uploads/uat-${suffix}-bob` },
      ]),
      db.insert(selfAssessmentIdentityTable).values([
        { userId: users.alice },
        { userId: users.bob },
      ]),
      db.insert(selfAssessmentSa100ContextsTable).values([
        { userId: users.alice, taxYear: "2025/26", otherTaxableIncome: 100 },
        { userId: users.bob, taxYear: "2025/26", otherTaxableIncome: 200 },
      ]),
    ]);

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    testPort = (server.address() as AddressInfo).port;

    const retiredPresigned = await request(aliceSession, "/api/storage/uploads/request-url", {
      method: "POST",
      body: JSON.stringify({ name: "late-upload.txt", size: 12, contentType: "text/plain" }),
    });
    assert.equal(retiredPresigned.status, 410, "reset-safe uploads cannot mint a delayed direct-to-storage URL");

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const unavailableInProduction = await request(aliceSession, "/api/uat/fresh-user-reset", { method: "POST" });
    assert.equal(unavailableInProduction.status, 404, "the server route is unavailable in production mode");
    process.env.NODE_ENV = originalNodeEnv;

    const reset = await request(aliceSession, "/api/uat/fresh-user-reset", { method: "POST" });
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body, {
      success: true,
      deletedProfiles: 1,
      cleanupPending: false,
      message: "UAT fresh-user reset complete. The next app entry will start onboarding.",
    });
    assert.deepEqual(deletedObjectPaths, [`/objects/uploads/uat-${suffix}-alice`]);
    assert.equal(
      (await db.select().from(privateUploadDeletionJobsTable)
        .where(eq(privateUploadDeletionJobsTable.userId, users.alice))).length,
      0,
      "the durable cleanup intent is removed after physical object deletion succeeds",
    );

    const onboardingProfiles = await request(aliceSession, "/api/profiles");
    assert.equal(onboardingProfiles.status, 200);
    assert.deepEqual(onboardingProfiles.body, [], "an authenticated reset user has no profiles, which is the onboarding state");

    const aliceProfileRecords = await Promise.all([
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, aliceProfile)),
      db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.profileId, aliceProfile)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, aliceProfile)),
      db.select().from(decisionMemoryTable).where(eq(decisionMemoryTable.profileId, aliceProfile)),
      db.select().from(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, aliceProfile)),
      db.select().from(financialAccountsTable).where(eq(financialAccountsTable.profileId, aliceProfile)),
      db.select().from(selfAssessmentSa103sContextsTable).where(eq(selfAssessmentSa103sContextsTable.profileId, aliceProfile)),
      db.select().from(privateUploadObjectsTable).where(eq(privateUploadObjectsTable.userId, users.alice)),
      db.select().from(selfAssessmentIdentityTable).where(eq(selfAssessmentIdentityTable.userId, users.alice)),
      db.select().from(selfAssessmentSa100ContextsTable).where(eq(selfAssessmentSa100ContextsTable.userId, users.alice)),
    ]);
    for (const rows of aliceProfileRecords) {
      assert.equal(rows.length, 0, "the reset deletes current-user Finance Copilot records without reseeding");
    }

    const bobProfileRecords = await Promise.all([
      db.select().from(profilesTable).where(eq(profilesTable.id, bobProfile)),
      db.select().from(transactionsTable).where(eq(transactionsTable.profileId, bobProfile)),
      db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.profileId, bobProfile)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.profileId, bobProfile)),
      db.select().from(decisionMemoryTable).where(eq(decisionMemoryTable.profileId, bobProfile)),
      db.select().from(saChecklistItemsTable).where(eq(saChecklistItemsTable.profileId, bobProfile)),
      db.select().from(financialAccountsTable).where(eq(financialAccountsTable.profileId, bobProfile)),
      db.select().from(selfAssessmentSa103sContextsTable).where(eq(selfAssessmentSa103sContextsTable.profileId, bobProfile)),
      db.select().from(privateUploadObjectsTable).where(eq(privateUploadObjectsTable.userId, users.bob)),
      db.select().from(selfAssessmentIdentityTable).where(eq(selfAssessmentIdentityTable.userId, users.bob)),
      db.select().from(selfAssessmentSa100ContextsTable).where(eq(selfAssessmentSa100ContextsTable.userId, users.bob)),
    ]);
    for (const rows of bobProfileRecords) {
      assert.equal(rows.length, 1, "the reset does not alter a different user's data");
    }

    const bobProfiles = await request(bobSession, "/api/profiles");
    assert.equal(bobProfiles.status, 200);
    assert.equal((bobProfiles.body as Array<unknown>).length, 1, "the control user remains signed in with their profile");

    const danaProfile = await createProfile(users.dana, "Dana in-flight upload business");
    const danaSession = await createSessionFor(users.dana);
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { signalUploadStarted = resolve; });
    let allowUploadToFinish!: () => void;
    const allowUpload = new Promise<void>((resolve) => { allowUploadToFinish = resolve; });
    ObjectStorageService.prototype.saveContent = async () => {
      signalUploadStarted();
      await allowUpload;
      return `/objects/uploads/uat-${suffix}-dana`;
    };
    const directUpload = request(danaSession, "/api/storage/uploads/direct", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-content-type": "text/plain",
        "x-profile-id": danaProfile,
      },
      body: "Dana's in-flight receipt",
    });
    await uploadStarted;
    const danaReset = request(danaSession, "/api/uat/fresh-user-reset", { method: "POST" });
    let resetSettled = false;
    void danaReset.then(() => { resetSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(resetSettled, false, "the reset waits for the in-flight upload's user lock");
    allowUploadToFinish();
    const [directUploadResult, danaResetResult] = await Promise.all([directUpload, danaReset]);
    assert.equal(directUploadResult.status, 200);
    assert.equal(danaResetResult.status, 200);
    assert.ok(
      deletedObjectPaths.includes(`/objects/uploads/uat-${suffix}-dana`),
      "the reset captures the upload that completed while it was waiting",
    );
    assert.equal(
      (await db.select().from(profilesTable).where(eq(profilesTable.id, danaProfile))).length,
      0,
      "the interleaved upload cannot leave a profile behind",
    );
    assert.equal(
      (await db.select().from(privateUploadObjectsTable)
        .where(eq(privateUploadObjectsTable.userId, users.dana))).length,
      0,
      "the interleaved upload's ownership metadata is removed by the reset",
    );
    assert.equal(
      (await db.select().from(privateUploadDeletionJobsTable)
        .where(eq(privateUploadDeletionJobsTable.userId, users.dana))).length,
      0,
      "the interleaved upload's durable cleanup intent completes successfully",
    );
    ObjectStorageService.prototype.saveContent = originalSaveContent;

    const charlieProfile = await createProfile(users.charlie, "Charlie cleanup-retry business");
    const charlieSession = await createSessionFor(users.charlie);
    await db.insert(privateUploadObjectsTable).values({
      userId: users.charlie,
      objectPath: `/objects/uploads/uat-${suffix}-charlie`,
    });
    ObjectStorageService.prototype.deleteObjectEntity = async (objectPath: string) => {
      if (objectPath.endsWith("-charlie")) {
        throw new Error("simulated storage outage");
      }
      deletedObjectPaths.push(objectPath);
    };
    const queuedCleanup = await request(charlieSession, "/api/uat/fresh-user-reset", { method: "POST" });
    assert.deepEqual(queuedCleanup, {
      status: 202,
      body: {
        success: true,
        deletedProfiles: 1,
        cleanupPending: true,
        message: "UAT profile reset is complete. Private upload cleanup is queued for retry; onboarding can begin now.",
      },
    });
    const charlieProfiles = await request(charlieSession, "/api/profiles");
    assert.deepEqual(charlieProfiles.body, [], "a storage cleanup retry never blocks first-time onboarding");
    assert.equal(
      (await db.select().from(privateUploadObjectsTable)
        .where(eq(privateUploadObjectsTable.userId, users.charlie))).length,
      0,
      "no live ownership record remains after a reset commits",
    );
    const [charlieCleanupJob] = await db.select().from(privateUploadDeletionJobsTable)
      .where(eq(privateUploadDeletionJobsTable.userId, users.charlie));
    assert.equal(charlieCleanupJob.objectPath, `/objects/uploads/uat-${suffix}-charlie`);
    assert.equal(charlieCleanupJob.attempts, 1);
    assert.match(charlieCleanupJob.lastError ?? "", /simulated storage outage/);
    assert.equal(
      (await db.select().from(profilesTable).where(eq(profilesTable.id, charlieProfile))).length,
      0,
      "a failed physical cleanup cannot preserve an active profile that refers to reset data",
    );
  } finally {
    ObjectStorageService.prototype.deleteObjectEntity = originalDeleteObject;
    ObjectStorageService.prototype.saveContent = originalSaveContent;
    if (server) await closeServer(server);
    if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(users)));
    await pool.end();
  }
});