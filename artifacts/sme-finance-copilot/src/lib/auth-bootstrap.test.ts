import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthUser } from './api.js';
import { getAuthSurface, getLoginUrl, getLogoutUrl } from './auth-routing.js';

test('callback session user is consumed and routes the app away from Welcome', async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;

  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({
      user: { id: 'user-after-callback', name: 'Signed-in user' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const user = await getAuthUser();

    assert.deepEqual(user, { id: 'user-after-callback', name: 'Signed-in user' });
    assert.equal(requestInit?.credentials, 'include');
    assert.equal(requestInit?.cache, 'no-store');
    assert.equal(
      getAuthSurface({
        location: '/',
        isLoading: false,
        isAuthenticated: user !== null,
        profilesCount: 1,
        profilesLoaded: true,
        profileLoadError: false,
      }),
      'dashboard',
    );
    assert.equal(
      getAuthSurface({
        location: '/memory',
        isLoading: false,
        isAuthenticated: user !== null,
        profilesCount: 1,
        profilesLoaded: true,
        profileLoadError: false,
      }),
      'app',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('logout uses the server session-clear route and unauthenticated routing returns to Welcome', () => {
  assert.equal(getLogoutUrl('/'), '/api/logout?returnTo=%2F');
  assert.equal(
    getAuthSurface({
      location: '/dashboard',
      isLoading: false,
      isAuthenticated: false,
      profilesCount: 0,
      profilesLoaded: false,
      profileLoadError: false,
    }),
    'welcome',
  );
});

test('logout → Welcome → Get Started → callback reload returns to the authenticated app', async () => {
  assert.equal(getLogoutUrl('/'), '/api/logout?returnTo=%2F');
  assert.equal(getLoginUrl('/'), '/api/login?returnTo=%2F');
  assert.equal(
    getAuthSurface({
      location: '/',
      isLoading: false,
      isAuthenticated: false,
      profilesCount: 0,
      profilesLoaded: false,
      profileLoadError: false,
    }),
    'welcome',
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    user: { id: 'user-after-login-return', name: 'Signed-in user' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const user = await getAuthUser();
    assert.equal(
      getAuthSurface({
        location: '/',
        isLoading: false,
        isAuthenticated: user !== null,
        profilesCount: 1,
        profilesLoaded: true,
        profileLoadError: false,
      }),
      'dashboard',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});