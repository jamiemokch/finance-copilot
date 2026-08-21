import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// GET /profiles — list authenticated user's profiles
router.get("/profiles", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const profiles = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, req.user.id));
    res.json(profiles);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list profiles" });
  }
});

// POST /profiles — create a new profile
router.post("/profiles", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = z
    .object({
      name: z.string().min(1),
      type: z.string().default("sole_trader"),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid input: name is required" });
    return;
  }
  try {
    const [profile] = await db
      .insert(profilesTable)
      .values({
        userId: req.user.id,
        name: body.data.name,
        type: body.data.type,
      })
      .returning();
    res.status(201).json(profile);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create profile" });
  }
});

// Helper exported for reuse in other routes
export async function requireProfile(profileId: string, userId: string) {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(
      and(eq(profilesTable.id, profileId), eq(profilesTable.userId, userId)),
    );
  return profile ?? null;
}

export default router;
