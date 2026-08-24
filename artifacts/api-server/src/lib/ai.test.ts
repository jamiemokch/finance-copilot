import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import { analyseSpreadsheet, inspectSpreadsheet } from './spreadsheet.js';
import { analyseSpreadsheetWithAI, providerCallWithTimeout } from './ai.js';

function failingClient(responses: Array<() => Promise<never>>): OpenAI {
  let index = 0;
  return {
    chat: {
      completions: {
        create: async () => responses[Math.min(index++, responses.length - 1)!](),
      },
    },
  } as unknown as OpenAI;
}

test('provider retry and timeout failures retain the actual attempt count', async () => {
  const client = failingClient([
    async () => {
      const error = new Error('service unavailable') as Error & { status?: number };
      error.status = 503;
      throw error;
    },
    async () => new Promise<never>(() => undefined),
  ]);

  await assert.rejects(
    () => providerCallWithTimeout(client, '{}', { timeoutMs: 5, retryDelayMs: 0 }),
    (error: unknown) => {
      assert.equal((error as { message?: string }).message, 'timeout');
      assert.equal((error as { providerCalls?: number }).providerCalls, 2);
      return true;
    },
  );
});

test('AI fallback telemetry reports both retry and timeout attempts', async () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,Consulting payment,125.00',
  ].join('\n')), 'text/csv', 'ledger.csv');
  const analysis = analyseSpreadsheet(workbook);
  const client = failingClient([
    async () => {
      const error = new Error('rate limited') as Error & { status?: number };
      error.status = 429;
      throw error;
    },
    async () => new Promise<never>(() => undefined),
  ]);

  const result = await analyseSpreadsheetWithAI(workbook, analysis, {
    client,
    timeoutMs: 5,
    retryDelayMs: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI analysis timed out.');
  assert.equal(result.providerCalls, 2);
});