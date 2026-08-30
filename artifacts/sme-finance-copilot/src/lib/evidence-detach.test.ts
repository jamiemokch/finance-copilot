import assert from 'node:assert/strict';
import test from 'node:test';
import { detachEvidenceAndRefresh } from './evidence-detach.js';
import type { APIEvidenceLink } from './api.js';

const otherActiveLink: APIEvidenceLink = {
  id: 'link-2', evidenceId: 'evidence-2', linkedAt: '2026-01-01T00:00:00.000Z',
  filename: 'other-receipt.pdf', mimeType: 'application/pdf', documentLifecycle: 'active',
};

test('final-link detach refreshes authoritative evidence links and global state without a manual reload', async () => {
  let fetchLinksCalls = 0;
  let refreshCalls = 0;
  const result = await detachEvidenceAndRefresh({
    detach: async () => undefined,
    fetchLinks: async () => { fetchLinksCalls += 1; return []; },
    refreshGlobalState: async () => { refreshCalls += 1; },
  });
  assert.deepEqual(result, { outcome: 'detached', linkedEvidence: [] });
  assert.equal(fetchLinksCalls, 1, 'the authoritative evidence-links list is re-fetched after a successful detach');
  assert.equal(refreshCalls, 1, 'global store state (unmatched/review queue, transactions) is refreshed after a successful detach');
});

test('non-final detach keeps whatever active link the server still reports, not a false empty state', async () => {
  const result = await detachEvidenceAndRefresh({
    detach: async () => undefined,
    fetchLinks: async () => [otherActiveLink],
    refreshGlobalState: async () => undefined,
  });
  assert.deepEqual(result, { outcome: 'detached', linkedEvidence: [otherActiveLink] });
});

test('a failed detach call is reported as detach_failed and never triggers a refresh', async () => {
  let fetchLinksCalls = 0;
  let refreshCalls = 0;
  const result = await detachEvidenceAndRefresh({
    detach: async () => { throw new Error('network error'); },
    fetchLinks: async () => { fetchLinksCalls += 1; return []; },
    refreshGlobalState: async () => { refreshCalls += 1; },
  });
  assert.deepEqual(result, { outcome: 'detach_failed' });
  assert.equal(fetchLinksCalls, 0, 'a failed detach must not optimistically mutate refreshed state');
  assert.equal(refreshCalls, 0, 'a failed detach must not optimistically mutate refreshed state');
});

test('a successful detach followed by a failed refresh is reported distinctly from a failed detach', async () => {
  const result = await detachEvidenceAndRefresh({
    detach: async () => undefined,
    fetchLinks: async () => { throw new Error('network error'); },
    refreshGlobalState: async () => undefined,
  });
  assert.deepEqual(result, { outcome: 'refresh_failed' });
});
