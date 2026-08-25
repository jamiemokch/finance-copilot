import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthOrigin } from './auth-origin.js';

test('development OIDC callbacks use the browser-visible Replit preview origin', () => {
  assert.equal(
    getAuthOrigin(
      {
        host: 'internal-api:8080',
        'x-forwarded-host': 'internal-api:8080',
        'x-forwarded-proto': 'http',
      },
      {
        nodeEnv: 'development',
        previewDomain: 'preview.example.replit.dev',
      },
    ),
    'https://preview.example.replit.dev',
  );
});

test('production OIDC callbacks continue to use the public forwarded request origin', () => {
  assert.equal(
    getAuthOrigin(
      {
        host: 'internal-api:8080',
        'x-forwarded-host': 'app.example.com, internal-api:8080',
        'x-forwarded-proto': 'https, http',
      },
      {
        nodeEnv: 'production',
        previewDomain: 'preview.example.replit.dev',
      },
    ),
    'https://app.example.com',
  );
});