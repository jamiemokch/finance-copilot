import { createHash } from 'crypto';
import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import express, { Router, type IRouter, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import {
  db,
  bankImportBatchesTable,
  evidenceItemsTable,
  privateUploadBindingsTable,
  privateUploadObjectsTable,
  profilesTable,
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
    const [profile] = await db.select({ id: profilesTable.id }).from(profilesTable)
      .where(and(eq(profilesTable.id, profileId), eq(profilesTable.userId, req.user.id)))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    const contentType =
      (req.headers['x-content-type'] as string) || 'application/octet-stream';
    try {
      const contentHash = createHash('sha256').update(req.body).digest('hex');
      // Hash matching is scoped to the authenticated uploader. Reusing the
      // private object prevents file dedupe from becoming a cross-user oracle.
      const [reusable] = await db.select({
        id: privateUploadObjectsTable.id,
        objectPath: privateUploadObjectsTable.objectPath,
      })
        .from(privateUploadObjectsTable)
        .where(and(
          eq(privateUploadObjectsTable.userId, req.user.id),
          eq(privateUploadObjectsTable.contentHash, contentHash),
        ));
      if (reusable) {
        await db.insert(privateUploadBindingsTable).values({
          profileId: profile.id,
          objectId: reusable.id,
          userId: req.user.id,
        }).onConflictDoNothing();
        res.json({ objectPath: reusable.objectPath });
        return;
      }
      const objectPath = await objectStorageService.saveContent(
        req.body,
        contentType,
      );
      try {
        const [createdUpload] = await db.insert(privateUploadObjectsTable).values({
          objectPath,
          userId: req.user.id,
          contentHash,
          objectSize: req.body.length,
        }).returning({ id: privateUploadObjectsTable.id });
        await db.insert(privateUploadBindingsTable).values({
          profileId: profile.id,
          objectId: createdUpload.id,
          userId: req.user.id,
        }).onConflictDoNothing();
      } catch (err) {
        await objectStorageService.getObjectEntityFile(objectPath)
          .then((file) => file.delete())
          .catch(() => undefined);
        const dbError = err as { cause?: { code?: string } };
        if (dbError.cause?.code === '23505') {
          const [winner] = await db.select({ objectPath: privateUploadObjectsTable.objectPath })
            .from(privateUploadObjectsTable)
            .where(and(
              eq(privateUploadObjectsTable.userId, req.user.id),
              eq(privateUploadObjectsTable.contentHash, contentHash),
            ));
          if (winner) {
            const [winnerUpload] = await db.select({ id: privateUploadObjectsTable.id })
              .from(privateUploadObjectsTable)
              .where(eq(privateUploadObjectsTable.objectPath, winner.objectPath))
              .limit(1);
            if (winnerUpload) {
              await db.insert(privateUploadBindingsTable).values({
                profileId: profile.id,
                objectId: winnerUpload.id,
                userId: req.user.id,
              }).onConflictDoNothing();
            }
            res.json({ objectPath: winner.objectPath });
            return;
          }
        }
        throw err;
      }
      res.json({ objectPath });
    } catch (err) {
      req.log.error({ err }, 'Direct upload failed');
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });

      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }
    const profileId = req.headers['x-profile-id'];
    if (typeof profileId !== 'string' || !profileId) {
      res.status(400).json({ error: 'A profile binding is required' });
      return;
    }
    const [profile] = await db.select({ id: profilesTable.id }).from(profilesTable)
      .where(and(eq(profilesTable.id, profileId), eq(profilesTable.userId, req.user.id)))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);
      const [upload] = await db.insert(privateUploadObjectsTable).values({
        objectPath,
        userId: req.user.id,
        objectSize: size,
      }).returning({ id: privateUploadObjectsTable.id });
      await db.insert(privateUploadBindingsTable).values({
        profileId: profile.id,
        objectId: upload.id,
        userId: req.user.id,
      }).onConflictDoNothing();

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
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
