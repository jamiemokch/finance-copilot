import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthUser } from './api.js';

test('getAuthUser bypasses the browser cache and returns the authenticated user', async () => {
  const authenticatedUser = { id: 'user-1', name: 'Test User', email: 'test@example.com', picture: null };
  let capturedUrl;
  let capturedInit;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: authenticatedUser }),
    };
  };

  try {
    const result = await getAuthUser();

    assert.deepEqual(result, authenticatedUser);
    assert.equal(capturedUrl, '/api/auth/user');
    assert.equal(capturedInit.credentials, 'include');
    assert.equal(capturedInit.cache, 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
