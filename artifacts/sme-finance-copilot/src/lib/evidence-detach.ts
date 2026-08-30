import type { APIEvidenceLink } from './api';

export interface DetachEvidenceDeps {
  detach: () => Promise<void>;
  fetchLinks: () => Promise<APIEvidenceLink[]>;
  refreshGlobalState: () => Promise<void>;
}

export type DetachEvidenceResult =
  | { outcome: 'detached'; linkedEvidence: APIEvidenceLink[] }
  | { outcome: 'detach_failed' }
  | { outcome: 'refresh_failed' };

// The detach endpoint returns 204 with no body, so the only way to learn the
// server's authoritative post-detach state (did this document return to the
// review queue, does the Financial Memory transaction still exist, is
// another active link still holding the document confirmed) is to re-fetch
// it. A refresh failure must never be reported as a detach failure — the
// detach already succeeded on the server by that point.
export async function detachEvidenceAndRefresh(
  deps: DetachEvidenceDeps,
): Promise<DetachEvidenceResult> {
  try {
    await deps.detach();
  } catch {
    return { outcome: 'detach_failed' };
  }
  try {
    const [linkedEvidence] = await Promise.all([deps.fetchLinks(), deps.refreshGlobalState()]);
    return { outcome: 'detached', linkedEvidence };
  } catch {
    return { outcome: 'refresh_failed' };
  }
}
