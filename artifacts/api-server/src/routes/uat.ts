import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  privateUploadDeletionJobsTable,
  profilesTable,
  privateUploadObjectsTable,
  selfAssessmentIdentityTable,
  selfAssessmentSa100ContextsTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const storageService = new ObjectStorageService();

function isUatResetAvailable(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

async function drainUploadDeletionJobs(userId: string): Promise<number> {
  const pendingJobs = await db.select().from(privateUploadDeletionJobsTable)
    .where(eq(privateUploadDeletionJobsTable.userId, userId));
  let failedJobs = 0;

  for (const job of pendingJobs) {
    try {
      await storageService.deleteObjectEntity(job.objectPath);
      await db.delete(privateUploadDeletionJobsTable)
        .where(eq(privateUploadDeletionJobsTable.id, job.id));
    } catch (error) {
      failedJobs += 1;
      const message = error instanceof Error ? error.message : "Unknown object-storage deletion error";
      await db.update(privateUploadDeletionJobsTable).set({
        attempts: sql`${privateUploadDeletionJobsTable.attempts} + 1`,
        lastError: message.slice(0, 1_000),
      }).where(eq(privateUploadDeletionJobsTable.id, job.id));
    }
  }

  return failedJobs;
}

async function retryPendingUploadDeletionJobs(): Promise<void> {
  const pendingUsers = await db.selectDistinct({ userId: privateUploadDeletionJobsTable.userId })
    .from(privateUploadDeletionJobsTable);
  for (const { userId } of pendingUsers) {
    await drainUploadDeletionJobs(userId);
  }
}

if (isUatResetAvailable()) {
  const retryTimer = setInterval(() => {
    void retryPendingUploadDeletionJobs();
  }, 60_000);
  retryTimer.unref();
}

// POST /uat/fresh-user-reset — development/UAT-only, authenticated user reset
router.post("/uat/fresh-user-reset", async (req, res) => {
  if (!isUatResetAvailable()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userId = req.user.id;
    const result = await db.transaction(async (tx) => {
      // Serialize the snapshot with the only routes that create private upload
      // ownership rows. An in-flight upload finishes before this reset captures
      // it; a later upload rechecks profile ownership and is rejected.
      await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      const profiles = await tx.select({ id: profilesTable.id }).from(profilesTable)
        .where(eq(profilesTable.userId, userId));
      const uploadObjects = await tx.select({ objectPath: privateUploadObjectsTable.objectPath })
        .from(privateUploadObjectsTable)
        .where(eq(privateUploadObjectsTable.userId, userId));

      if (profiles.length > 0) {
        // Profile deletion cascades all profile-owned Finance Copilot records,
        // including transactions, evidence, imports, reconciliation, tasks,
        // decision memory, and profile-level Self Assessment context.
        await tx.delete(profilesTable).where(eq(profilesTable.userId, userId));
      }

      if (uploadObjects.length > 0) {
        await tx.insert(privateUploadDeletionJobsTable).values(
          uploadObjects.map((upload) => ({ userId, objectPath: upload.objectPath })),
        ).onConflictDoNothing();
      }

      // These records belong to the person rather than a business profile, but
      // are still Finance Copilot onboarding/SA state and must not survive a
      // true first-user reset.
      await tx.delete(selfAssessmentIdentityTable).where(eq(selfAssessmentIdentityTable.userId, userId));
      await tx.delete(selfAssessmentSa100ContextsTable).where(eq(selfAssessmentSa100ContextsTable.userId, userId));
      await tx.delete(privateUploadObjectsTable).where(eq(privateUploadObjectsTable.userId, userId));

      const [remainingProfiles] = await Promise.all([
        tx.select({ id: profilesTable.id }).from(profilesTable).where(eq(profilesTable.userId, userId)),
      ]);

      return {
        deletedProfiles: profiles.length,
        queuedUploadCleanup: uploadObjects.length,
        remainingProfiles: remainingProfiles.length,
      };
    });

    if (result.remainingProfiles !== 0) {
      throw new Error("Fresh-user reset did not reach an empty authenticated profile state");
    }

    const failedUploadCleanup = await drainUploadDeletionJobs(userId);
    req.log.info({ userId }, "UAT fresh-user reset completed");
    res.status(failedUploadCleanup > 0 ? 202 : 200).json({
      success: true,
      deletedProfiles: result.deletedProfiles,
      cleanupPending: failedUploadCleanup > 0,
      message: failedUploadCleanup > 0
        ? "UAT profile reset is complete. Private upload cleanup is queued for retry; onboarding can begin now."
        : "UAT fresh-user reset complete. The next app entry will start onboarding.",
    });
  } catch (err) {
    req.log.error(err, "Failed to perform UAT fresh-user reset");
    res.status(500).json({ error: "Failed to reset current user's Finance Copilot data" });
  }
});

export default router;