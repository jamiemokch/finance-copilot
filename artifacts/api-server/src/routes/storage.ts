import { createHash } from 'crypto';
import { Readable } from 'stream';
import express, { Router, type IRouter, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import {
  db,
  bankImportBatchesTable,
  evidenceItemsTable,
  privateUploadBindingsTable,
  privateUploadObjectsTable,
  profilesTable,
  usersTable,
} from '@workspace/db';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function hasAuthenticatedSession(
  req: Request,
): req is Request & { isAuthenticated: () => boolean; user: { id: string } } {
  if (
    !('isAuthenticated' in req) ||
    typeof req.isAuthenticated !== 'function'
  ) {
    return false;
  }

  return req.isAuthenticated();
}

/**
 * POST /storage/uploads/direct
 *
 * Upload file bytes directly through the API server (avoids browser→GCS CORS).
 * Body: raw bytes (application/octet-stream), size limit 25 MB.
 * Headers: X-Filename (URI-encoded), X-Content-Type (MIME type of the file).
 * Returns: { objectPath } — the normalised /objects/… path for DB storage.
 */
router.post(
  '/storage/uploads/direct',
  express.raw({ type: '*/*', limit: '25mb' }),
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Empty body' });
      return;
    }
    const profileId = req.headers['x-profile-id'];
    if (typeof profileId !== 'string' || !profileId) {
      res.status(400).json({ error: 'A profile binding is required' });
      return;
    }
    const contentType =
      (req.headers['x-content-type'] as string) || 'application/octet-stream';
    try {
      const contentHash = createHash('sha256').update(req.body).digest('hex');
      const upload = await db.transaction(async (tx) => {
        // A user-row lock serializes private-upload ownership writes with the
        // UAT fresh-user reset. A reset either captures this upload for durable
        // cleanup or finishes first and makes the profile unavailable here.
        await tx.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.id, req.user.id))
          .for('update');
        const [profile] = await tx.select({ id: profilesTable.id }).from(profilesTable)
          .where(and(eq(profilesTable.id, profileId), eq(profilesTable.userId, req.user.id)))
          .limit(1);
        if (!profile) return null;

        // Hash matching is scoped to the authenticated uploader. Reusing the
        // private object prevents file dedupe from becoming a cross-user oracle.
        const [reusable] = await tx.select({
          id: privateUploadObjectsTable.id,
          objectPath: privateUploadObjectsTable.objectPath,
        })
          .from(privateUploadObjectsTable)
          .where(and(
            eq(privateUploadObjectsTable.userId, req.user.id),
            eq(privateUploadObjectsTable.contentHash, contentHash),
          ));
        if (reusable) {
          await tx.insert(privateUploadBindingsTable).values({
            profileId: profile.id,
            objectId: reusable.id,
            userId: req.user.id,
          }).onConflictDoNothing();
          return reusable.objectPath;
        }

        const objectPath = await objectStorageService.saveContent(req.body, contentType);
        try {
          const [createdUpload] = await tx.insert(privateUploadObjectsTable).values({
            objectPath,
            userId: req.user.id,
            contentHash,
            objectSize: req.body.length,
          }).returning({ id: privateUploadObjectsTable.id });
          await tx.insert(privateUploadBindingsTable).values({
            profileId: profile.id,
            objectId: createdUpload.id,
            userId: req.user.id,
          }).onConflictDoNothing();
          return objectPath;
        } catch (err) {
          await objectStorageService.deleteObjectEntity(objectPath).catch(() => undefined);
          throw err;
        }
      });
      if (!upload) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ objectPath: upload });
    } catch (err) {
      req.log.error({ err }, 'Direct upload failed');
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 *
 * Retired: a directly writeable object-storage URL cannot be revoked when a
 * fresh-user reset completes. Active app uploads use the authenticated direct
 * endpoint above, which serializes ownership creation with that reset.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.status(410).json({
      error: 'Direct-to-storage uploads are retired. Upload through /storage/uploads/direct instead.',
    });
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const [bankBatch] = await db.select({ id: bankImportBatchesTable.id }).from(bankImportBatchesTable)
      .where(eq(bankImportBatchesTable.objectPath, objectPath))
      .limit(1);
    if (bankBatch) {
      // Bank CSVs are intentionally served only through their profile-scoped
      // endpoint, never through a path-only object URL.
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    const [uploaded] = await db.select({
      id: privateUploadObjectsTable.id,
      userId: privateUploadObjectsTable.userId,
    }).from(privateUploadObjectsTable)
      .where(eq(privateUploadObjectsTable.objectPath, objectPath))
      .limit(1);
    if (!uploaded || uploaded.userId !== req.user.id) {
      // Evidence and staged uploads are served only through routes that carry
      // the profile and evidence IDs. A path-only URL is never an ACL.
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    // Even an object owned by this user may be bound to several profiles. Do
    // not let this legacy path-only route become a cross-profile download
    // oracle; callers must use /profiles/:profileId/evidence/:evidenceId/download.
    const [binding] = await db.select({ id: privateUploadBindingsTable.id })
      .from(privateUploadBindingsTable)
      .where(eq(privateUploadBindingsTable.objectId, uploaded.id))
      .limit(1);
    // Legacy evidence predates private_upload_bindings but is still profile
    // scoped. Its bytes must never fall back to this path-only download route.
    const [evidence] = await db.select({ id: evidenceItemsTable.id })
      .from(evidenceItemsTable)
      .where(eq(evidenceItemsTable.objectPath, objectPath))
      .limit(1);
    if (binding || evidence) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
